import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'

function logRealtimeStatus(topic, status, error) {
  if (error) console.debug(`[realtime:${topic}]`, status, error)
}

export function useScheduleRealtime() {
  const queryClient = useQueryClient()

  useEffect(() => {
    const channel = supabase
      .channel('friday-elite-matches-live')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'matches' },
        () => {
          void queryClient.invalidateQueries({ queryKey: ['matches', 'schedule'] })
          void queryClient.invalidateQueries({ queryKey: ['my-registration'] })
        },
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'registrations' },
        () => {
          void queryClient.invalidateQueries({ queryKey: ['matches', 'schedule'] })
          void queryClient.invalidateQueries({ queryKey: ['my-registration'] })
        },
      )
      .subscribe((status, error) => logRealtimeStatus('schedule', status, error))

    return () => {
      void supabase.removeChannel(channel)
    }
  }, [queryClient])
}

export function useMatchRealtime(matchId) {
  const queryClient = useQueryClient()

  useEffect(() => {
    if (!matchId) return undefined

    const invalidateMatch = () => {
      void queryClient.invalidateQueries({ queryKey: ['matches', 'schedule'] })
      void queryClient.invalidateQueries({ queryKey: ['match-details', matchId] })
      void queryClient.invalidateQueries({ queryKey: ['match-registrations', matchId] })
      void queryClient.invalidateQueries({ queryKey: ['match-history-stats', matchId] })
      void queryClient.invalidateQueries({ queryKey: ['match-teams', matchId] })
      void queryClient.invalidateQueries({ queryKey: ['team-assignments', matchId] })
      void queryClient.invalidateQueries({ queryKey: ['match-result', matchId] })
      void queryClient.invalidateQueries({ queryKey: ['match-scorers', matchId] })
      void queryClient.invalidateQueries({ queryKey: ['my-match-ratings', matchId] })
      void queryClient.invalidateQueries({ queryKey: ['match-rating-stats', matchId] })
      void queryClient.invalidateQueries({ queryKey: ['my-registration'] })
    }

    const channel = supabase
      .channel(`match-details-${matchId}-live`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'matches', filter: `id=eq.${matchId}` },
        invalidateMatch,
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'registrations', filter: `match_id=eq.${matchId}` },
        invalidateMatch,
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'match_teams', filter: `match_id=eq.${matchId}` },
        invalidateMatch,
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'team_assignments', filter: `match_id=eq.${matchId}` },
        invalidateMatch,
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'match_results', filter: `match_id=eq.${matchId}` },
        invalidateMatch,
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'match_scorers', filter: `match_id=eq.${matchId}` },
        invalidateMatch,
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'match_player_rating_stats', filter: `match_id=eq.${matchId}` },
        invalidateMatch,
      )
      .subscribe((status, error) => logRealtimeStatus('match-details', status, error))

    return () => {
      void supabase.removeChannel(channel)
    }
  }, [matchId, queryClient])
}
