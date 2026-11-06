import { useCallback, useEffect, useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { toArabicError } from '../lib/errorMessages'
import { useScheduleRealtime } from './useRealtimeMatches'

const MATCH_COLUMNS =
  'id,kickoff_at,registration_open_at,registration_close_at,local_date,venue,address,notes,capacity,team_size,status,registration_locked'

async function fetchSchedule() {
  // Idempotent catch-up: if pg_cron is unavailable or has not run yet, opening
  // the page also creates the upcoming Friday fixtures and advances statuses.
  try {
    const { error } = await supabase.rpc('ensure_weekly_matches')
    if (error) console.debug('ensure_weekly_matches unavailable', error)
  } catch (error) {
    console.debug('ensure_weekly_matches unavailable', error)
  }

  const { data: matches, error } = await supabase
    .from('matches')
    .select(MATCH_COLUMNS)
    .order('kickoff_at', { ascending: true })

  if (error) throw error

  const { data: stats, error: statsError } = await supabase
    .from('match_history_stats')
    .select('*')
    .order('kickoff_at', { ascending: false })
    .limit(52)

  if (statsError) {
    // Older deployments may not have migration 0004 yet; still show matches.
    console.debug('match_history_stats unavailable', statsError)
  }

  return {
    matches: matches ?? [],
    stats: stats ?? [],
  }
}

export function useMatches() {
  const { profile } = useAuth()
  const queryClient = useQueryClient()
  const [now, setNow] = useState(() => Date.now())
  const [actionBusy, setActionBusy] = useState(false)
  const [actionError, setActionError] = useState('')
  const [actionSuccess, setActionSuccess] = useState('')

  useScheduleRealtime()

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(timer)
  }, [])

  const scheduleQuery = useQuery({
    queryKey: ['matches', 'schedule'],
    queryFn: fetchSchedule,
    staleTime: 15_000,
    refetchInterval: 30_000,
  })

  const matches = scheduleQuery.data?.matches ?? []
  const stats = scheduleQuery.data?.stats ?? []

  const statsByMatchId = useMemo(
    () => new Map(stats.map((item) => [item.match_id, item])),
    [stats],
  )

  const activeMatch = useMemo(
    () => matches.find((match) => new Date(match.registration_close_at).getTime() > now) ?? null,
    [matches, now],
  )

  const pastMatches = useMemo(
    () =>
      matches
        .filter((match) => new Date(match.registration_close_at).getTime() <= now)
        .slice()
        .reverse(),
    [matches, now],
  )

  const myRegistrationQuery = useQuery({
    queryKey: ['my-registration', activeMatch?.id, profile?.id],
    enabled: Boolean(activeMatch?.id && profile?.id),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('registrations')
        .select('id,status,queue_position,registered_at,created_at')
        .eq('match_id', activeMatch.id)
        .eq('player_id', profile.id)
        .neq('status', 'cancelled')
        .maybeSingle()

      if (error) throw error
      return data ?? null
    },
    staleTime: 10_000,
    refetchInterval: 30_000,
  })

  const refresh = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: ['matches', 'schedule'] })
    if (activeMatch?.id) {
      await queryClient.invalidateQueries({ queryKey: ['my-registration', activeMatch.id] })
    }
  }, [activeMatch?.id, queryClient])

  const registerForActiveMatch = useCallback(async () => {
    if (!activeMatch) return false
    setActionBusy(true)
    setActionError('')
    setActionSuccess('')

    const { error } = await supabase.rpc('register_for_match', { p_match_id: activeMatch.id })
    if (error) {
      setActionError(toArabicError(error))
      setActionBusy(false)
      return false
    }

    setActionSuccess('تم تسجيلك في المباراة.')
    setActionBusy(false)
    await refresh()
    return true
  }, [activeMatch, refresh])

  const cancelMyRegistration = useCallback(async () => {
    const registrationId = myRegistrationQuery.data?.id
    if (!registrationId) return false
    setActionBusy(true)
    setActionError('')
    setActionSuccess('')

    const { error } = await supabase.rpc('cancel_registration', {
      p_registration_id: registrationId,
    })
    if (error) {
      setActionError(toArabicError(error))
      setActionBusy(false)
      return false
    }

    setActionSuccess('تم إلغاء تسجيلك في المباراة.')
    setActionBusy(false)
    await refresh()
    return true
  }, [myRegistrationQuery.data?.id, refresh])

  return {
    now,
    matches,
    stats,
    statsByMatchId,
    activeMatch,
    pastMatches,
    myRegistration: myRegistrationQuery.data ?? null,
    isLoading: scheduleQuery.isLoading,
    error: scheduleQuery.error,
    refetch: scheduleQuery.refetch,
    actionBusy,
    actionError,
    actionSuccess,
    registerForActiveMatch,
    cancelMyRegistration,
  }
}
