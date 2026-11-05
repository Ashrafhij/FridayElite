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

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null)
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const mountedRef = useRef(true)

  const applySession = useCallback(async (nextSession) => {
    if (!mountedRef.current) return

    setSession(nextSession)

    if (!nextSession?.user) {
      setProfile(null)
      setError('')
      setLoading(false)
      return
    }

    setLoading(true)

    try {
      const nextProfile = await fetchProfile(nextSession.user.id)
      if (!mountedRef.current) return
      setProfile(nextProfile)
      setError(nextProfile ? '' : 'تعذر العثور على الملف الشخصي المرتبط بالحساب.')
    } catch (profileError) {
      if (!mountedRef.current) return
      setProfile(null)
      setError(toArabicError(profileError, 'تعذر تحميل الملف الشخصي.'))
    } finally {
      if (mountedRef.current) setLoading(false)
    }
  }, [])

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
    setError(nextProfile ? '' : 'تعذر العثور على الملف الشخصي المرتبط بالحساب.')
    return nextProfile
  }, [])

  const signOut = useCallback(async () => {
    const { error: signOutError } = await supabase.auth.signOut()

    if (signOutError && !/session missing/i.test(signOutError.message)) {
      throw signOutError
    }

    setSession(null)
    setProfile(null)
    setError('')
  }, [])

  const value = useMemo(() => {
    const isApproved = profile?.status === 'approved'
    const isAdmin = isApproved && profile?.role === 'admin'
    const canManageProfile = profile?.status === 'pending' || isApproved

    return {
      session,
      user: session?.user ?? null,
      profile,
      loading,
      error,
      isApproved,
      isAdmin,
      canManageProfile,
      refreshProfile,
      syncSession,
      signOut,
    }
  }, [error, loading, profile, refreshProfile, session, signOut, syncSession])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

// -------------------------------------------------
// Helper: quick login with phone + password
// -------------------------------------------------
export const loginWithPhone = async (phone, password) => {
  const { data, error } = await supabase.functions.invoke('loginPhone', {
    body: { phone, password },
  })
  if (error) throw error
  if (!data || !data.success) throw new Error('Login failed')
  await supabase.auth.setSession({
    access_token: data.access_token,
    refresh_token: data.refresh_token,
  })
}

export function useAuth() {
  const context = useContext(AuthContext)

  if (!context) {
    throw new Error('useAuth must be used inside AuthProvider')
  }

  return context
}
