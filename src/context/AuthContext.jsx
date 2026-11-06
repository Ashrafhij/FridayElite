import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { toArabicError } from '../lib/errorMessages'

const PROFILE_COLUMNS = [
  'id',
  'full_name',
  'phone',
  'avatar_url',
  'role',
  'status',
  'skill_level',
  'preferred_foot',
  'jersey_number',
  'approved_at',
  'rejection_reason',
  'created_at',
].join(', ')

const AuthContext = createContext(null)

async function fetchProfile(userId) {
  const { data, error } = await supabase
    .from('profiles')
    .select(PROFILE_COLUMNS)
    .eq('id', userId)
    .maybeSingle()

  if (error) throw error
  return data ?? null
}

async function fetchNotifications(userId) {
  const { data, error } = await supabase
    .from('notifications')
    .select('id,type,title_ar,body_ar,match_id,read_at,created_at')
    .eq('player_id', userId)
    .order('created_at', { ascending: false })
    .limit(12)

  if (error) throw error
  return data ?? []
}

function approvalNoticeFromNotifications(notifications) {
  const notification = (notifications ?? []).find(
    (item) => item.type === 'account_approved' && !item.read_at,
  )
  if (!notification) return null
  return {
    id: notification.id,
    title: notification.title_ar || 'تمت الموافقة على حسابك',
    body:
      notification.body_ar ||
      'يمكنك الآن التسجيل في المباريات واختيار مراكزك المفضلة.',
    createdAt: notification.created_at,
  }
}

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null)
  const [profile, setProfile] = useState(null)
  const [notifications, setNotifications] = useState([])
  const [approvalNotice, setApprovalNotice] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const mountedRef = useRef(true)

  const applyNotifications = useCallback(async (userId) => {
    try {
      const nextNotifications = await fetchNotifications(userId)
      if (!mountedRef.current) return nextNotifications
      setNotifications(nextNotifications)
      setApprovalNotice(approvalNoticeFromNotifications(nextNotifications))
      return nextNotifications
    } catch {
      if (mountedRef.current) {
        setNotifications([])
        setApprovalNotice(null)
      }
      return []
    }
  }, [])

  const applySession = useCallback(async (nextSession) => {
    if (!mountedRef.current) return

    setSession(nextSession)

    if (!nextSession?.user) {
      setProfile(null)
      setNotifications([])
      setApprovalNotice(null)
      setError('')
      setLoading(false)
      return
    }

    setLoading(true)

    try {
      const nextProfile = await fetchProfile(nextSession.user.id)
      if (!mountedRef.current) return
      setProfile(nextProfile)
      if (nextProfile) {
        await applyNotifications(nextProfile.id)
      } else {
        setNotifications([])
        setApprovalNotice(null)
      }
      setError(nextProfile ? '' : 'تعذر العثور على الملف الشخصي المرتبط بالحساب.')
    } catch (profileError) {
      if (!mountedRef.current) return
      setProfile(null)
      setNotifications([])
      setApprovalNotice(null)
      setError(toArabicError(profileError, 'تعذر تحميل الملف الشخصي.'))
    } finally {
      if (mountedRef.current) setLoading(false)
    }
  }, [applyNotifications])

  useEffect(() => {
    mountedRef.current = true

    supabase.auth
      .getSession()
      .then(({ data, error: sessionError }) => {
        if (!mountedRef.current) return
        if (sessionError) {
          setError(toArabicError(sessionError, 'تعذر استعادة الجلسة.'))
          setLoading(false)
          return
        }
        void applySession(data.session)
      })
      .catch((sessionError) => {
        if (!mountedRef.current) return
        setError(toArabicError(sessionError, 'تعذر استعادة الجلسة.'))
        setLoading(false)
      })

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, nextSession) => {
      if (!['SIGNED_IN', 'SIGNED_OUT', 'USER_UPDATED'].includes(event)) return

      // Supabase warns against running other Auth calls directly inside this
      // callback, so the profile fetch is deferred to the next task.
      setTimeout(() => {
        if (mountedRef.current) void applySession(nextSession)
      }, 0)
    })

    return () => {
      mountedRef.current = false
      subscription.unsubscribe()
    }
  }, [applySession])

  useEffect(() => {
    if (!profile?.id || profile.status !== 'pending') return undefined

    const timer = setInterval(async () => {
      try {
        const nextProfile = await fetchProfile(profile.id)
        if (!mountedRef.current || !nextProfile) return
        setProfile(nextProfile)
        if (nextProfile.status !== 'pending') {
          await applyNotifications(nextProfile.id)
        }
      } catch {
        // Keep the current profile visible; the next poll can recover.
      }
    }, 5_000)

    return () => clearInterval(timer)
  }, [profile?.id, profile?.status, applyNotifications])

  useEffect(() => {
    if (!profile?.id) return undefined
    const timer = setInterval(() => {
      void applyNotifications(profile.id)
    }, 15_000)
    return () => clearInterval(timer)
  }, [profile?.id, applyNotifications])

  const syncSession = useCallback(async () => {
    const {
      data: { session: currentSession },
      error: sessionError,
    } = await supabase.auth.getSession()

    if (sessionError) throw sessionError

    await applySession(currentSession)
    return currentSession
  }, [applySession])

  const refreshProfile = useCallback(async () => {
    const {
      data: { session: currentSession },
      error: sessionError,
    } = await supabase.auth.getSession()

    if (sessionError) throw sessionError

    if (!currentSession?.user) {
      setProfile(null)
      return null
    }

    const nextProfile = await fetchProfile(currentSession.user.id)
    setProfile(nextProfile)
    if (nextProfile) {
      await applyNotifications(nextProfile.id)
    } else {
      setNotifications([])
      setApprovalNotice(null)
    }
    setError(nextProfile ? '' : 'تعذر العثور على الملف الشخصي المرتبط بالحساب.')
    return nextProfile
  }, [applyNotifications])

  const refreshNotifications = useCallback(async () => {
    if (!profile?.id) return []
    return applyNotifications(profile.id)
  }, [profile?.id, applyNotifications])

  const markNotificationRead = useCallback(
    async (notificationId) => {
      if (!notificationId) return
      const readAt = new Date().toISOString()
      setNotifications((current) =>
        current.map((notification) =>
          notification.id === notificationId
            ? { ...notification, read_at: readAt }
            : notification,
        ),
      )
      if (approvalNotice?.id === notificationId) setApprovalNotice(null)

      try {
        await supabase.from('notifications').update({ read_at: readAt }).eq('id', notificationId)
      } catch {
        // Local state is already updated; ignore transient network failures.
      }
    },
    [approvalNotice?.id],
  )

  const dismissApprovalNotice = useCallback(() => {
    if (approvalNotice) {
      void markNotificationRead(approvalNotice.id)
    }
    setApprovalNotice(null)
  }, [approvalNotice, markNotificationRead])

  const signOut = useCallback(async () => {
    const { error: signOutError } = await supabase.auth.signOut()

    if (signOutError && !/session missing/i.test(signOutError.message)) {
      throw signOutError
    }

    setSession(null)
    setProfile(null)
    setNotifications([])
    setApprovalNotice(null)
    setError('')
  }, [])

  const value = useMemo(() => {
    const isApproved = profile?.status === 'approved'
    const isAdmin = isApproved && profile?.role === 'admin'
    const canManageProfile = profile?.status === 'pending' || isApproved
    const unreadNotificationCount = notifications.filter((notification) => !notification.read_at).length

    return {
      session,
      user: session?.user ?? null,
      profile,
      notifications,
      unreadNotificationCount,
      approvalNotice,
      loading,
      error,
      isApproved,
      isAdmin,
      canManageProfile,
      refreshProfile,
      refreshNotifications,
      markNotificationRead,
      dismissApprovalNotice,
      syncSession,
      signOut,
    }
  }, [
    approvalNotice,
    dismissApprovalNotice,
    error,
    loading,
    markNotificationRead,
    notifications,
    profile,
    refreshNotifications,
    refreshProfile,
    session,
    signOut,
    syncSession,
  ])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const context = useContext(AuthContext)

  if (!context) {
    throw new Error('useAuth must be used inside AuthProvider')
  }

  return context
}
