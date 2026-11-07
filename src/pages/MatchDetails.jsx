import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ArrowLeft,
  CalendarDays,
  CheckCircle2,
  Check,
  Clock,
  Copy,
  Footprints,
  History,
  Link2,
  Loader2,
  Lock,
  MapPin,
  Minus,
  Palette,
  Plus,
  RotateCcw,
  Shuffle,
  Star,
  Trash2,
  Trophy,
  Users,
  UserCheck,
  UserPlus,
  UserRound,
  Volleyball,
  XCircle,
} from 'lucide-react'
import PageHeader from '../components/layout/PageHeader'
import Badge from '../components/ui/Badge'
import Card from '../components/ui/Card'
import EmptyState from '../components/ui/EmptyState'
import { useAuth } from '../context/AuthContext'
import { useMatchRealtime } from '../hooks/useRealtimeMatches'
import { supabase } from '../lib/supabase'
import { toArabicError } from '../lib/errorMessages'

const MATCH_COLUMNS =
  'id,kickoff_at,registration_open_at,registration_close_at,local_date,venue,address,notes,capacity,team_size,formation,status,registration_locked,teams_generated_at,teams_seed,teams_stale'

const STATUS_LABELS = {
  scheduled: 'مقررة',
  registration_open: 'التسجيل مفتوح',
  registration_closed: 'أُغلق التسجيل',
  teams_published: 'تم توزيع الفرق',
  completed: 'اكتملت',
  cancelled: 'أُلغيت',
  draft: 'مسودة',
}

const TEAM_COLOR_PRESETS = [
  { label: 'أصفر', value: '#ffd60a' },
  { label: 'أزرق', value: '#2f7bff' },
  { label: 'أخضر', value: '#d2ff4d' },
  { label: 'أحمر', value: '#ff4d4d' },
  { label: 'أبيض', value: '#f5f3ea' },
  { label: 'برتقالي', value: '#ff9500' },
  { label: 'بنفسجي', value: '#a78bfa' },
]

function formatDateTime(value) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return new Intl.DateTimeFormat('ar', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'Asia/Jerusalem',
  }).format(date)
}

function formatDate(value) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return new Intl.DateTimeFormat('ar', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'Asia/Jerusalem',
  }).format(date)
}

function formatTime(value) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return new Intl.DateTimeFormat('ar', {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'Asia/Jerusalem',
  }).format(date)
}

function roleLabel(role) {
  if (role === 'gk') return 'حارس مرمى'
  if (role === 'outfield') return 'لاعب ميدان'
  return '—'
}

function ratingColor(rating) {
  const value = Number(rating)
  if (Number.isNaN(value)) return '#9ca3af'
  if (value >= 7.5) return '#22c55e'
  if (value >= 6.5) return '#f59e0b'
  return '#ef4444'
}

function formatRating(rating) {
  const value = Number(rating)
  return Number.isNaN(value) ? rating : value.toFixed(1)
}

function Avatar({ player, size = 40 }) {
  const initial = player?.full_name?.trim()?.charAt(0) || '؟'
  return (
    <span
      className="relative grid shrink-0 place-items-center overflow-hidden rounded-full bg-brand-400/15 text-sm font-black text-brand-300"
      style={{ width: size, height: size }}
    >
      {initial}
      {player?.avatar_url ? (
        <img
          src={player.avatar_url}
          alt=""
          loading="lazy"
          decoding="async"
          className="absolute inset-0 size-full object-cover"
          onError={(event) => {
            event.currentTarget.style.display = 'none'
          }}
        />
      ) : null}
    </span>
  )
}

function InfoItem({ icon: Icon, label, value, dir }) {
  return (
    <div className="min-w-0">
      <dt className="flex items-center gap-1.5 text-[11px] font-bold text-white/40">
        <Icon className="size-3.5 text-brand-400/70" />
        {label}
      </dt>
      <dd className="mt-1.5 break-words text-sm font-bold leading-6 text-sand-100" dir={dir}>
        {value}
      </dd>
    </div>
  )
}

function RegistrationPlayerRow({
  registration,
  directoryById,
  positionByCode,
  showDelete = false,
  deleting = false,
  onDelete,
}) {
  const player = directoryById.get(registration.player_id)
  const name = player?.full_name ?? 'لاعب'
  const details = []

  if (player?.jersey_number) details.push(`رقم ${player.jersey_number}`)
  if (registration.roster_role) details.push(roleLabel(registration.roster_role))
  if (registration.status === 'waitlisted') details.push(`الترتيب ${registration.queue_position}`)
  if (registration.status === 'confirmed') details.push(`رقم التسجيل ${registration.queue_position}`)

  return (
    <div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.03] p-3">
      <Avatar player={player} size={40} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-extrabold text-sand-100">{name}</p>
        <p className="mt-0.5 truncate text-[11px] text-white/45">{details.join(' · ') || '—'}</p>
      </div>
      <Badge variant={registration.status === 'confirmed' ? 'brand' : 'warning'}>
        {registration.status === 'confirmed' ? 'مؤكد' : 'انتظار'}
      </Badge>
      {showDelete ? (
        <button
          type="button"
          onClick={() => onDelete?.(registration)}
          disabled={deleting}
          aria-label={`حذف ${name} من التسجيل`}
          title={`حذف ${name} من التسجيل`}
          className="grid min-h-11 min-w-11 place-items-center rounded-xl border border-red-400/25 text-red-300 transition-colors hover:bg-red-400/10 disabled:opacity-60"
        >
          {deleting ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
        </button>
      ) : null}
    </div>
  )
}

function AssignmentRow({ assignment, directoryById, positionByCode }) {
  const player = directoryById.get(assignment.player_id)
  const position = positionByCode.get(assignment.assigned_position_code)
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.03] p-3">
      <Avatar player={player} size={38} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-extrabold text-sand-100">{player?.full_name ?? 'لاعب'}</p>
        <p className="mt-0.5 truncate text-[11px] text-white/45">
          {position?.name_ar ?? assignment.assigned_position_code}
          {assignment.is_out_of_position ? ' · خارج مركزه' : ''}
        </p>
      </div>
      {player?.jersey_number ? (
        <span className="rounded-full bg-white/5 px-2.5 py-1 text-[11px] font-black text-white/60">
          {player.jersey_number}
        </span>
      ) : null}
    </div>
  )
}

function PitchPlayerButton({
  player,
  subLabel,
  averageRating,
  myRating,
  jerseyNumber,
  goals,
  assists,
  showExternalRing,
  selected,
  dropActive,
  draggable,
  onSelect,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
}) {
  const initial = player?.full_name?.trim()?.charAt(0) || '؟'
  const goalsCount = Number(goals ?? 0)
  const assistsCount = Number(assists ?? 0)
  return (
    <div className="flex min-w-0 flex-col items-center gap-1.5">
      <button
        type="button"
        onClick={onSelect}
        draggable={draggable}
        onDragStart={onDragStart}
        onDragOver={onDragOver}
        onDrop={onDrop}
        onDragEnd={onDragEnd}
        aria-label={player?.full_name ? `فتح تقييم ${player.full_name}` : 'فتح تقييم اللاعب'}
        className={`relative grid size-12 place-items-center overflow-visible rounded-full border transition-all ${dropActive ? 'scale-110 border-amber-300 text-amber-200 ring-4 ring-amber-300/40' : showExternalRing ? 'border-red-400 text-red-300 ring-4 ring-red-500/50' : selected ? 'border-brand-300 text-brand-300 ring-4 ring-brand-400/20' : 'border-white/20 bg-white/10 text-brand-200 hover:border-brand-400/50 hover:bg-white/15'} ${draggable ? 'cursor-grab active:cursor-grabbing' : ''}`}
      >
        {initial}
        {player?.avatar_url ? (
          <img
            src={player.avatar_url}
            alt=""
            loading="lazy"
            decoding="async"
            draggable={false}
            className="absolute inset-0 size-full rounded-full object-cover"
            onError={(event) => {
              event.currentTarget.style.display = 'none'
            }}
          />
        ) : null}
        {goalsCount > 0 || assistsCount > 0 ? (
          <span className="absolute -top-1.5 -left-2 z-10 flex items-center gap-0.5" aria-hidden="true">
            {goalsCount > 0 ? (
              <span
                title={`${goalsCount} هدف`}
                className="flex size-5 items-center justify-center gap-px rounded-full bg-white text-pitch-950 shadow"
              >
                <Volleyball className="size-2.5" />
                <span className="text-[8px] leading-none font-black">{goalsCount}</span>
              </span>
            ) : null}
            {assistsCount > 0 ? (
              <span
                title={`${assistsCount} تمريرة`}
                className="flex size-5 items-center justify-center gap-px rounded-full bg-brand-300 text-pitch-950 shadow"
              >
                <Footprints className="size-2.5" />
                <span className="text-[8px] leading-none font-black">{assistsCount}</span>
              </span>
            ) : null}
          </span>
        ) : null}
        {jerseyNumber ? (
          <span className="absolute -top-1.5 -right-1.5 z-10 grid size-5 place-items-center rounded-full bg-white text-[9px] leading-none font-black text-pitch-950 shadow" aria-hidden="true">
            {jerseyNumber}
          </span>
        ) : null}
        {averageRating ? (
          <span
            className="absolute -right-2 -bottom-1.5 z-10 rounded-full px-1.5 py-0.5 text-[9px] leading-none font-black text-white shadow"
            style={{ backgroundColor: ratingColor(averageRating) }}
            aria-hidden="true"
          >
            {formatRating(averageRating)}
          </span>
        ) : null}
      </button>
      <span className="max-w-24 truncate text-center text-[10px] leading-4 font-bold text-sand-100">
        {player?.full_name ?? 'لاعب'}
      </span>
      <span className="max-w-24 truncate text-center text-[9px] leading-4 text-white/45">
        {subLabel || (myRating ? `قيّمتك ${myRating}` : 'اضغط للتقييم')}
      </span>
    </div>
  )
}

export default function MatchDetails() {
  const { matchId } = useParams()
  const [searchParams] = useSearchParams()
  const isRateMode = searchParams.get('rate') === '1'
  const { isAdmin, profile } = useAuth()
  const queryClient = useQueryClient()
  const pitchRef = useRef(null)
  const [generating, setGenerating] = useState(false)
  const [generateError, setGenerateError] = useState('')
  const [generateSuccess, setGenerateSuccess] = useState('')
  const [resultFormOpen, setResultFormOpen] = useState(false)
  const [teamAScore, setTeamAScore] = useState('')
  const [teamBScore, setTeamBScore] = useState('')
  const [resultNotes, setResultNotes] = useState('')
  const [scorersDraft, setScorersDraft] = useState([{ player_id: '', goals: '1', assists: '0' }])
  const [resultBusy, setResultBusy] = useState(false)
  const [resultError, setResultError] = useState('')
  const [resultSuccess, setResultSuccess] = useState('')
  const [ratingBusyPlayerId, setRatingBusyPlayerId] = useState(null)
  const [ratingError, setRatingError] = useState('')
  const [ratingSuccess, setRatingSuccess] = useState('')
  const [ratingTarget, setRatingTarget] = useState(null)
  const [externalName, setExternalName] = useState('')
  const [externalPosition, setExternalPosition] = useState('')
  const [externalBusy, setExternalBusy] = useState(false)
  const [externalError, setExternalError] = useState('')
  const [externalSuccess, setExternalSuccess] = useState('')
  const [swapPlayerA, setSwapPlayerA] = useState('')
  const [swapPlayerB, setSwapPlayerB] = useState('')
  const [swapBusy, setSwapBusy] = useState(false)
  const [swapError, setSwapError] = useState('')
  const [swapSuccess, setSwapSuccess] = useState('')
  const [cancelRegistrationId, setCancelRegistrationId] = useState(null)
  const [registrationError, setRegistrationError] = useState('')
  const [registrationSuccess, setRegistrationSuccess] = useState('')
  const [teamColorA, setTeamColorA] = useState('')
  const [teamColorB, setTeamColorB] = useState('')
  const [colorBusy, setColorBusy] = useState(false)
  const [colorError, setColorError] = useState('')
  const [colorSuccess, setColorSuccess] = useState('')
  const [statsGoals, setStatsGoals] = useState(0)
  const [statsAssists, setStatsAssists] = useState(0)
  const [statsBusy, setStatsBusy] = useState(false)
  const [statsError, setStatsError] = useState('')
  const [statsSuccess, setStatsSuccess] = useState('')
  const [ratingLinkCopied, setRatingLinkCopied] = useState(false)
  const [swapMode, setSwapMode] = useState(false)
  const [pitchSwapFirstId, setPitchSwapFirstId] = useState(null)
  const [pitchSwapBusy, setPitchSwapBusy] = useState(false)
  const [pitchNotice, setPitchNotice] = useState(null)
  const [dragTargetId, setDragTargetId] = useState(null)
  const [modalSwapTarget, setModalSwapTarget] = useState('')
  const [modalSwapBusy, setModalSwapBusy] = useState(false)
  const [modalSwapError, setModalSwapError] = useState('')
  const [modalPosition, setModalPosition] = useState('')
  const [modalPositionBusy, setModalPositionBusy] = useState(false)
  const [modalPositionError, setModalPositionError] = useState('')
  const [modalPositionSuccess, setModalPositionSuccess] = useState('')

  useMatchRealtime(matchId)

  const matchQuery = useQuery({
    queryKey: ['match-details', matchId],
    enabled: Boolean(matchId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('matches')
        .select(MATCH_COLUMNS)
        .eq('id', matchId)
        .maybeSingle()
      if (error) throw error
      if (!data) throw new Error('MATCH_NOT_FOUND')
      return data
    },
    staleTime: 15_000,
    refetchInterval: 30_000,
  })

  const registrationsQuery = useQuery({
    queryKey: ['match-registrations', matchId],
    enabled: Boolean(matchQuery.data),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('registrations')
        .select('id,player_id,status,roster_role,queue_position,registered_at,created_at')
        .eq('match_id', matchId)
        .order('queue_position', { ascending: true })
      if (error) throw error
      return data ?? []
    },
    staleTime: 5_000,
    refetchInterval: 5_000,
  })

  const statsQuery = useQuery({
    queryKey: ['match-history-stats', matchId],
    enabled: Boolean(matchQuery.data),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('match_history_stats')
        .select('*')
        .eq('match_id', matchId)
        .maybeSingle()
      if (error) {
        console.debug('match_history_stats unavailable', error)
        return null
      }
      return data ?? null
    },
    staleTime: 5_000,
    refetchInterval: 5_000,
  })

  const teamsQuery = useQuery({
    queryKey: ['match-teams', matchId],
    enabled: Boolean(matchQuery.data),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('match_teams')
        .select('*')
        .eq('match_id', matchId)
        .order('side', { ascending: true })
      if (error) throw error
      return data ?? []
    },
    staleTime: 15_000,
    refetchInterval: 30_000,
  })

  const assignmentsQuery = useQuery({
    queryKey: ['team-assignments', matchId],
    enabled: Boolean(matchQuery.data),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('team_assignments')
        .select('id,team_id,player_id,assigned_position_code,slot_index,is_out_of_position')
        .eq('match_id', matchId)
        .order('slot_index', { ascending: true })
      if (error) throw error
      return data ?? []
    },
    staleTime: 15_000,
    refetchInterval: 30_000,
  })

  const positionsQuery = useQuery({
    queryKey: ['positions'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('positions')
        .select('code,name_ar,category,sort_order')
        .eq('is_active', true)
        .order('sort_order', { ascending: true })
      if (error) throw error
      return data ?? []
    },
    staleTime: 10 * 60 * 1000,
  })

  const resultQuery = useQuery({
    queryKey: ['match-result', matchId],
    enabled: Boolean(matchQuery.data),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('match_results')
        .select('match_id,team_a_score,team_b_score,notes,created_at,updated_at')
        .eq('match_id', matchId)
        .maybeSingle()
      if (error) {
        console.debug('match_results unavailable', error)
        return null
      }
      return data ?? null
    },
    staleTime: 15_000,
    refetchInterval: 30_000,
  })

  const scorersQuery = useQuery({
    queryKey: ['match-scorers', matchId],
    enabled: Boolean(matchQuery.data),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('match_scorers')
        .select('id,player_id,team_id,goals,assists,created_at')
        .eq('match_id', matchId)
        .order('goals', { ascending: false })
        .order('assists', { ascending: false })
      if (error) {
        console.debug('match_scorers unavailable', error)
        return []
      }
      return data ?? []
    },
    staleTime: 15_000,
    refetchInterval: 30_000,
  })

  const myRatingsQuery = useQuery({
    queryKey: ['my-match-ratings', matchId, profile?.id],
    enabled: Boolean(matchQuery.data && profile?.id),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('player_ratings')
        .select('rated_player_id,rating,created_at,updated_at')
        .eq('match_id', matchId)
        .eq('rater_id', profile.id)
      if (error) {
        console.debug('player_ratings unavailable', error)
        return []
      }
      return data ?? []
    },
    staleTime: 15_000,
    refetchInterval: 30_000,
  })

  const ratingStatsQuery = useQuery({
    queryKey: ['match-rating-stats', matchId],
    enabled: Boolean(matchQuery.data),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('match_player_rating_stats')
        .select('player_id,average_rating,rating_count,updated_at')
        .eq('match_id', matchId)
        .order('average_rating', { ascending: false })
      if (error) {
        console.debug('match_player_rating_stats unavailable', error)
        return []
      }
      return data ?? []
    },
    staleTime: 15_000,
    refetchInterval: 30_000,
  })

  const registrations = registrationsQuery.data ?? []
  const assignments = assignmentsQuery.data ?? []

  const playerIds = useMemo(
    () => [...new Set([...registrations.map((item) => item.player_id), ...assignments.map((item) => item.player_id)])],
    [registrations, assignments],
  )

  const directoryQuery = useQuery({
    queryKey: ['match-player-directory', matchId, playerIds.join('|')],
    enabled: playerIds.length > 0,
    queryFn: async () => {
      const selectDirectory = async (columns) => {
        const { data, error } = await supabase
          .from('player_directory')
          .select(columns)
          .in('id', playerIds)
        if (error) throw error
        return data ?? []
      }
      // Migration 0014 adds is_external; fall back gracefully before it runs.
      try {
        return await selectDirectory('id,full_name,avatar_url,jersey_number,preferred_foot,is_external')
      } catch {
        return selectDirectory('id,full_name,avatar_url,jersey_number,preferred_foot')
      }
    },
    staleTime: 30_000,
  })

  const allTimeStatsQuery = useQuery({
    queryKey: ['match-player-all-time-stats', matchId, playerIds.join('|')],
    enabled: Boolean(matchQuery.data && playerIds.length > 0),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('player_all_time_stats')
        .select('player_id,total_goals,total_assists,matches_with_stats,average_goals,average_assists')
        .in('player_id', playerIds)
      if (error) {
        console.debug('player_all_time_stats unavailable', error)
        return []
      }
      return data ?? []
    },
    staleTime: 30_000,
    refetchInterval: 30_000,
  })

  const allPlayersQuery = useQuery({
    queryKey: ['all-players-directory'],
    enabled: Boolean(isAdmin && ratingTarget),
    queryFn: async () => {
      const selectAll = async (columns, filterExternal) => {
        let query = supabase.from('player_directory').select(columns)
        if (filterExternal) query = query.eq('is_external', false)
        const { data, error } = await query.order('full_name', { ascending: true })
        if (error) throw error
        return data ?? []
      }
      try {
        return await selectAll('id,full_name,avatar_url,jersey_number,is_external', true)
      } catch {
        // Migration 0014 not applied yet: fall back to the pre-0014 columns.
        return selectAll('id,full_name,avatar_url,jersey_number', false)
      }
    },
    staleTime: 60_000,
  })

  const directoryById = useMemo(
    () => new Map((directoryQuery.data ?? []).map((player) => [player.id, player])),
    [directoryQuery.data],
  )

  const positionByCode = useMemo(
    () => new Map((positionsQuery.data ?? []).map((position) => [position.code, position])),
    [positionsQuery.data],
  )

  const confirmedPlayers = useMemo(
    () => registrations.filter((item) => item.status === 'confirmed'),
    [registrations],
  )
  const waitlistedPlayers = useMemo(
    () => registrations.filter((item) => item.status === 'waitlisted'),
    [registrations],
  )
  const cancelledCount =
    statsQuery.data?.cancelled_count ?? registrations.filter((item) => item.status === 'cancelled').length
  const confirmedCount = statsQuery.data?.confirmed_count ?? confirmedPlayers.length
  const waitlistedCount = statsQuery.data?.waitlisted_count ?? waitlistedPlayers.length
  const totalRegistrationCount =
    statsQuery.data?.total_registration_count ?? registrations.length
  const match = matchQuery.data
  const result = resultQuery.data ?? null
  const matchScorers = scorersQuery.data ?? []
  const myRatingsByPlayer = new Map((myRatingsQuery.data ?? []).map((item) => [item.rated_player_id, item.rating]))
  const ratingStatsByPlayer = new Map((ratingStatsQuery.data ?? []).map((item) => [item.player_id, item]))
  const allTimeStatsByPlayer = new Map((allTimeStatsQuery.data ?? []).map((item) => [item.player_id, item]))
  const currentUserRegistration = confirmedPlayers.find((item) => item.player_id === profile?.id)
  const canRate = Boolean(match?.status === 'completed' && currentUserRegistration)
  const teams = teamsQuery.data ?? []
  const teamById = new Map(teams.map((team) => [team.id, team]))
  const scorerByPlayer = new Map(matchScorers.map((scorer) => [scorer.player_id, scorer]))
  const assignmentByPlayerId = new Map(assignments.map((assignment) => [assignment.player_id, assignment]))
  const allPlayersById = new Map((allPlayersQuery.data ?? []).map((player) => [player.id, player]))
  const assignedPlayerOptions = assignments.map((assignment) => ({
    assignment,
    player: directoryById.get(assignment.player_id),
    team: teamById.get(assignment.team_id),
  }))
  const canGenerateTeams = Boolean(
    isAdmin && match && confirmedCount === 18 && !['cancelled', 'completed'].includes(match.status),
  )

  // Keep the color pickers in sync with the generated teams.
  useEffect(() => {
    const teamA = teams.find((team) => team.side === 'A')
    const teamB = teams.find((team) => team.side === 'B')
    if (teamA?.color) setTeamColorA(teamA.color)
    if (teamB?.color) setTeamColorB(teamB.color)
  }, [teams])

  // Pre-fill the quick-stats editor when the admin opens a player.
  useEffect(() => {
    setStatsGoals(ratingTarget?.statsGoals ?? 0)
    setStatsAssists(ratingTarget?.statsAssists ?? 0)
    setStatsError('')
    setStatsSuccess('')
    setModalSwapTarget('')
    setModalSwapError('')
    setModalPosition(
      ratingTarget ? assignmentByPlayerId.get(ratingTarget.playerId)?.assigned_position_code ?? '' : '',
    )
    setModalPositionError('')
    setModalPositionSuccess('')
  }, [ratingTarget?.playerId])

  // Players arriving through the admin's rating link land on the pitch.
  useEffect(() => {
    if (isRateMode) {
      pitchRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
  }, [isRateMode])

  async function handleGenerateTeams() {
    if (!match || !canGenerateTeams) return
    setGenerating(true)
    setGenerateError('')
    setGenerateSuccess('')

    const { error } = await supabase.rpc('generate_teams', { p_match_id: match.id })
    if (error) {
      setGenerateError(toArabicError(error, 'تعذر توليد الفرق. تحقق من اكتمال اللاعبين وتركيبة المراكز.'))
      setGenerating(false)
      return
    }

    setGenerating(false)
    setGenerateSuccess('تم توليد توزيع الفريقين ونشره للاعبين.')
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['match-details', matchId] }),
      queryClient.invalidateQueries({ queryKey: ['match-history-stats', matchId] }),
      queryClient.invalidateQueries({ queryKey: ['match-teams', matchId] }),
      queryClient.invalidateQueries({ queryKey: ['team-assignments', matchId] }),
      queryClient.invalidateQueries({ queryKey: ['matches', 'schedule'] }),
    ])
  }

  async function handleSwapPlayers(event) {
    event.preventDefault()
    if (!match || !swapPlayerA || !swapPlayerB || swapPlayerA === swapPlayerB) {
      setSwapError('اختر لاعبين مختلفين للمبادلة.')
      return
    }
    setSwapBusy(true)
    setSwapError('')
    setSwapSuccess('')

    const { error } = await supabase.rpc('swap_team_players', {
      p_match_id: match.id,
      p_player_a: swapPlayerA,
      p_player_b: swapPlayerB,
    })
    setSwapBusy(false)

    if (error) {
      setSwapError(toArabicError(error, 'تعذر تنفيذ المبادلة.'))
      return
    }

    setSwapSuccess('تم تبديل اللاعبين وتحديث توزيع الفرق.')
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['match-details', matchId] }),
      queryClient.invalidateQueries({ queryKey: ['match-history-stats', matchId] }),
      queryClient.invalidateQueries({ queryKey: ['match-teams', matchId] }),
      queryClient.invalidateQueries({ queryKey: ['team-assignments', matchId] }),
      queryClient.invalidateQueries({ queryKey: ['matches', 'schedule'] }),
    ])
  }

  async function handleSetTeamColors(event) {
    event.preventDefault()
    if (!match || !teamColorA || !teamColorB) return
    setColorBusy(true)
    setColorError('')
    setColorSuccess('')

    const { error } = await supabase.rpc('set_match_team_colors', {
      p_match_id: match.id,
      p_team_a_color: teamColorA,
      p_team_b_color: teamColorB,
    })
    setColorBusy(false)

    if (error) {
      setColorError(toArabicError(error, 'تعذر حفظ ألوان الفريقين.'))
      return
    }

    setColorSuccess('تم حفظ ألوان الفريقين.')
    await queryClient.invalidateQueries({ queryKey: ['match-teams', matchId] })
  }

  async function handleSavePlayerStats(event) {
    event.preventDefault()
    if (!match || !ratingTarget) return
    setStatsBusy(true)
    setStatsError('')
    setStatsSuccess('')

    const { error } = await supabase.rpc('set_player_match_stats', {
      p_match_id: match.id,
      p_player_id: ratingTarget.playerId,
      p_goals: statsGoals,
      p_assists: statsAssists,
    })
    setStatsBusy(false)

    if (error) {
      setStatsError(toArabicError(error, 'تعذر حفظ إحصائيات اللاعب.'))
      return
    }

    setStatsSuccess(
      statsGoals === 0 && statsAssists === 0
        ? 'تمت إزالة إحصائيات هذا اللاعب.'
        : 'تم حفظ أهداف وتمريرات اللاعب وتحديث النتيجة.',
    )
    setRatingTarget((current) =>
      current ? { ...current, statsGoals, statsAssists } : current,
    )
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['match-scorers', matchId] }),
      queryClient.invalidateQueries({ queryKey: ['match-result', matchId] }),
      queryClient.invalidateQueries({ queryKey: ['match-details', matchId] }),
      queryClient.invalidateQueries({ queryKey: ['match-history-stats', matchId] }),
      queryClient.invalidateQueries({ queryKey: ['matches', 'schedule'] }),
    ])
  }

  // Reset pitch interactions when moving to another match.
  useEffect(() => {
    setSwapMode(false)
    setPitchSwapFirstId(null)
    setPitchSwapBusy(false)
    setPitchNotice(null)
    setDragTargetId(null)
  }, [matchId])

  async function swapPlayersByIds(playerAId, playerBId) {
    if (!match || pitchSwapBusy) return false
    setPitchSwapBusy(true)
    setPitchNotice(null)

    const { error } = await supabase.rpc('swap_team_players', {
      p_match_id: match.id,
      p_player_a: playerAId,
      p_player_b: playerBId,
    })
    setPitchSwapBusy(false)

    if (error) {
      setPitchNotice({ type: 'err', text: toArabicError(error, 'تعذر تنفيذ المبادلة.') })
      return false
    }

    const nameA = directoryById.get(playerAId)?.full_name ?? 'لاعب'
    const nameB = directoryById.get(playerBId)?.full_name ?? 'لاعب'
    setPitchNotice({ type: 'ok', text: `تم تبديل ${nameA} و${nameB}.` })
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['match-teams', matchId] }),
      queryClient.invalidateQueries({ queryKey: ['team-assignments', matchId] }),
      queryClient.invalidateQueries({ queryKey: ['match-details', matchId] }),
      queryClient.invalidateQueries({ queryKey: ['match-history-stats', matchId] }),
      queryClient.invalidateQueries({ queryKey: ['matches', 'schedule'] }),
    ])
    return true
  }

  async function handleModalSwap(event) {
    event.preventDefault()
    if (!match || !ratingTarget || !modalSwapTarget || modalSwapBusy) return
    const currentId = ratingTarget.playerId
    const targetId = modalSwapTarget
    const targetAssigned = assignmentByPlayerId.has(targetId)
    setModalSwapBusy(true)
    setModalSwapError('')

    const { error } = targetAssigned
      ? await supabase.rpc('swap_team_players', {
          p_match_id: match.id,
          p_player_a: currentId,
          p_player_b: targetId,
        })
      : await supabase.rpc('replace_match_player', {
          p_match_id: match.id,
          p_out_player_id: currentId,
          p_in_player_id: targetId,
        })
    setModalSwapBusy(false)

    if (error) {
      setModalSwapError(toArabicError(error, 'تعذر تنفيذ المبادلة.'))
      return
    }

    const nameA = directoryById.get(currentId)?.full_name ?? allPlayersById.get(currentId)?.full_name ?? 'لاعب'
    const nameB = directoryById.get(targetId)?.full_name ?? allPlayersById.get(targetId)?.full_name ?? 'لاعب'
    setRatingTarget(null)
    setPitchNotice({
      type: 'ok',
      text: targetAssigned ? `تم تبديل ${nameA} و${nameB}.` : `تم استبدال ${nameA} بـ ${nameB} في الفريق.`,
    })
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['match-teams', matchId] }),
      queryClient.invalidateQueries({ queryKey: ['team-assignments', matchId] }),
      queryClient.invalidateQueries({ queryKey: ['match-details', matchId] }),
      queryClient.invalidateQueries({ queryKey: ['match-history-stats', matchId] }),
      queryClient.invalidateQueries({ queryKey: ['match-registrations', matchId] }),
      queryClient.invalidateQueries({ queryKey: ['match-player-directory', matchId] }),
      queryClient.invalidateQueries({ queryKey: ['all-players-directory'] }),
      queryClient.invalidateQueries({ queryKey: ['matches', 'schedule'] }),
    ])
  }

  async function handleSetPlayerPosition(event) {
    event.preventDefault()
    if (!match || !ratingTarget || !modalPosition || modalPositionBusy) return
    setModalPositionBusy(true)
    setModalPositionError('')
    setModalPositionSuccess('')

    const { error } = await supabase.rpc('set_player_match_position', {
      p_match_id: match.id,
      p_player_id: ratingTarget.playerId,
      p_position_code: modalPosition,
    })
    setModalPositionBusy(false)

    if (error) {
      setModalPositionError(toArabicError(error, 'تعذر تغيير مركز اللاعب.'))
      return
    }

    const positionName = positionByCode.get(modalPosition)?.name_ar ?? modalPosition
    setRatingTarget((current) => (current ? { ...current, positionLabel: positionName } : current))
    setModalPositionSuccess(`أصبح مركز اللاعب: ${positionName}.`)
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['team-assignments', matchId] }),
      queryClient.invalidateQueries({ queryKey: ['match-details', matchId] }),
      queryClient.invalidateQueries({ queryKey: ['match-history-stats', matchId] }),
    ])
  }

  async function handlePitchPlayerPick(playerId) {
    if (!swapMode || pitchSwapBusy) return
    if (!pitchSwapFirstId) {
      setPitchSwapFirstId(playerId)
      const name = directoryById.get(playerId)?.full_name ?? 'لاعب'
      setPitchNotice({ type: 'info', text: `اختر اللاعب الثاني للمبادلة مع ${name}.` })
      return
    }
    if (pitchSwapFirstId === playerId) {
      setPitchSwapFirstId(null)
      setPitchNotice({ type: 'info', text: 'أُلغيت المبادلة.' })
      return
    }
    const firstId = pitchSwapFirstId
    setPitchSwapFirstId(null)
    await swapPlayersByIds(firstId, playerId)
  }

  function handlePitchDragStart(event, playerId) {
    event.dataTransfer.setData('text/plain', playerId)
    event.dataTransfer.effectAllowed = 'move'
  }

  function handlePitchDragOver(event, playerId) {
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
    setDragTargetId((current) => (current === playerId ? current : playerId))
  }

  function handlePitchDrop(event, playerId) {
    event.preventDefault()
    const sourceId = event.dataTransfer.getData('text/plain')
    setDragTargetId(null)
    if (!sourceId || sourceId === playerId) return
    void swapPlayersByIds(sourceId, playerId)
  }

  async function handleSetSingleTeamColor(side, hex) {
    if (!match || colorBusy) return
    const otherSide = side === 'A' ? 'B' : 'A'
    const otherTeam = teams.find((team) => team.side === otherSide)
    const ownTeam = teams.find((team) => team.side === side)
    if (!otherTeam || !ownTeam) return

    const payload =
      side === 'A'
        ? { p_team_a_color: hex, p_team_b_color: otherTeam.color ?? '#f5f3ea' }
        : { p_team_a_color: otherTeam.color ?? '#d2ff4d', p_team_b_color: hex }

    setColorBusy(true)
    setPitchNotice(null)
    const { error } = await supabase.rpc('set_match_team_colors', {
      p_match_id: match.id,
      ...payload,
    })
    setColorBusy(false)

    if (error) {
      setPitchNotice({ type: 'err', text: toArabicError(error, 'تعذر حفظ لون الفريق.') })
      return
    }

    setPitchNotice({ type: 'ok', text: `أصبح ${ownTeam.name_ar} باللون الجديد.` })
    await queryClient.invalidateQueries({ queryKey: ['match-teams', matchId] })
  }

  function getRatingLink() {
    return `${window.location.origin}${window.location.pathname}#/matches/${matchId}?rate=1`
  }

  async function handleCopyRatingLink() {
    const link = getRatingLink()
    try {
      await navigator.clipboard.writeText(link)
    } catch {
      const textarea = document.createElement('textarea')
      textarea.value = link
      textarea.style.position = 'fixed'
      textarea.style.opacity = '0'
      document.body.appendChild(textarea)
      textarea.select()
      document.execCommand('copy')
      textarea.remove()
    }
    setRatingLinkCopied(true)
    window.setTimeout(() => setRatingLinkCopied(false), 2500)
  }

  async function handleAddExternalPlayer(event) {
    event.preventDefault()
    const name = externalName.trim()
    if (name.length < 2) {
      setExternalError('أدخل اسم اللاعب الخارجي (حرفان على الأقل).')
      return
    }
    setExternalBusy(true)
    setExternalError('')
    setExternalSuccess('')

    const { error } = await supabase.rpc('admin_add_external_player', {
      p_match_id: matchId,
      p_full_name: name,
      p_position_code: externalPosition || null,
    })
    setExternalBusy(false)

    if (error) {
      setExternalError(toArabicError(error, 'تعذر إضافة اللاعب الخارجي.'))
      return
    }

    setExternalName('')
    setExternalPosition('')
    setExternalSuccess('تمت إضافة اللاعب الخارجي إلى هذه المباراة.')
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['match-details', matchId] }),
      queryClient.invalidateQueries({ queryKey: ['match-registrations', matchId] }),
      queryClient.invalidateQueries({ queryKey: ['match-history-stats', matchId] }),
      queryClient.invalidateQueries({ queryKey: ['matches', 'schedule'] }),
    ])
  }

  async function handleCancelRegistration(registration) {
    if (!match || !registration) return false
    const player = directoryById.get(registration.player_id)
    const playerName = player?.full_name ?? 'هذا اللاعب'
    const wasConfirmed = registration.status === 'confirmed'
    if (!window.confirm(`سيتم حذف ${playerName} من قائمة المؤكدين.${wasConfirmed ? ' سيتم ترقية أول لاعب مناسب من قائمة الانتظار.' : ''} متابعة؟`)) return false

    setCancelRegistrationId(registration.id)
    setRegistrationError('')
    setRegistrationSuccess('')

    const { error } = await supabase.rpc('cancel_registration', {
      p_registration_id: registration.id,
    })
    setCancelRegistrationId(null)

    if (error) {
      setRegistrationError(toArabicError(error, 'تعذر حذف اللاعب من التسجيل.'))
      return false
    }

    setRegistrationSuccess('تم حذف اللاعب من التسجيل.')
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['match-registrations', matchId] }),
      queryClient.invalidateQueries({ queryKey: ['match-details', matchId] }),
      queryClient.invalidateQueries({ queryKey: ['match-history-stats', matchId] }),
      queryClient.invalidateQueries({ queryKey: ['match-teams', matchId] }),
      queryClient.invalidateQueries({ queryKey: ['team-assignments', matchId] }),
      queryClient.invalidateQueries({ queryKey: ['matches', 'schedule'] }),
    ])
    return true
  }

  function openResultForm() {
    setTeamAScore(result ? String(result.team_a_score) : '')
    setTeamBScore(result ? String(result.team_b_score) : '')
    setResultNotes(result?.notes ?? '')
    setScorersDraft(
      matchScorers.length
        ? matchScorers.map((scorer) => ({
            player_id: scorer.player_id,
            goals: String(scorer.goals),
            assists: String(scorer.assists ?? 0),
          }))
        : [{ player_id: '', goals: '1', assists: '0' }],
    )
    setResultError('')
    setResultSuccess('')
    setResultFormOpen(true)
  }

  function updateScorerDraft(index, field, value) {
    setScorersDraft((current) =>
      current.map((scorer, scorerIndex) =>
        scorerIndex === index ? { ...scorer, [field]: value } : scorer,
      ),
    )
  }

  async function handleSubmitResult(event) {
    event.preventDefault()
    if (!match) return
    setResultError('')
    setResultSuccess('')

    const scoreA = Number(teamAScore)
    const scoreB = Number(teamBScore)
    const scorerPayload = scorersDraft
      .filter((scorer) => scorer.player_id)
      .map((scorer) => ({
        player_id: scorer.player_id,
        goals: Number(scorer.goals),
        assists: Number(scorer.assists ?? 0),
      }))

    const playerIds = scorerPayload.map((scorer) => scorer.player_id)
    if (new Set(playerIds).size !== playerIds.length) {
      setResultError('لا يمكن تكرار اللاعب نفسه في قائمة الهدافين.')
      return
    }
    if (
      !Number.isInteger(scoreA) ||
      !Number.isInteger(scoreB) ||
      scoreA < 0 ||
      scoreB < 0 ||
      scoreA > 99 ||
      scoreB > 99 ||
      scorerPayload.some(
        (scorer) =>
          scorer.goals < 0 ||
          scorer.goals > 30 ||
          scorer.assists < 0 ||
          scorer.assists > 30 ||
          (scorer.goals === 0 && scorer.assists === 0),
      )
    ) {
      setResultError('تحقق من النتيجة وعدد الأهداف/التمريرات.')
      return
    }

    const assignmentByPlayer = new Map(assignments.map((assignment) => [assignment.player_id, assignment]))
    let computedA = 0
    let computedB = 0
    for (const scorer of scorerPayload) {
      const assignment = assignmentByPlayer.get(scorer.player_id)
      const team = assignment ? teamById.get(assignment.team_id) : null
      if (team?.side === 'A') computedA += scorer.goals
      if (team?.side === 'B') computedB += scorer.goals
    }

    if (computedA !== scoreA || computedB !== scoreB) {
      setResultError('أهداف الهدافين لا تطابق النتيجة النهائية. راجع اللاعبين والفرق.')
      return
    }

    setResultBusy(true)
    const { error } = await supabase.rpc('set_match_result', {
      p_match_id: match.id,
      p_team_a_score: scoreA,
      p_team_b_score: scoreB,
      p_scorers: scorerPayload,
      p_notes: resultNotes.trim() || null,
    })
    setResultBusy(false)

    if (error) {
      setResultError(toArabicError(error, 'تعذر حفظ نتيجة المباراة.'))
      return
    }

    setResultSuccess('تم حفظ نتيجة المباراة والهدافين.')
    setResultFormOpen(false)
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['match-details', matchId] }),
      queryClient.invalidateQueries({ queryKey: ['match-result', matchId] }),
      queryClient.invalidateQueries({ queryKey: ['match-scorers', matchId] }),
      queryClient.invalidateQueries({ queryKey: ['match-history-stats', matchId] }),
      queryClient.invalidateQueries({ queryKey: ['matches', 'schedule'] }),
    ])
  }

  async function handleRatePlayer(ratedPlayerId, rating) {
    if (!match || !profile || ratedPlayerId === profile.id) return
    setRatingBusyPlayerId(ratedPlayerId)
    setRatingError('')
    setRatingSuccess('')

    const { error } = await supabase.rpc('rate_player', {
      p_match_id: match.id,
      p_rated_player_id: ratedPlayerId,
      p_rating: rating,
    })
    setRatingBusyPlayerId(null)

    if (error) {
      setRatingError(toArabicError(error, 'تعذر حفظ التقييم.'))
      return
    }

    setRatingSuccess('تم حفظ تقييمك.')
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['my-match-ratings', matchId] }),
      queryClient.invalidateQueries({ queryKey: ['match-rating-stats', matchId] }),
    ])
  }

  if (matchQuery.isLoading) {
    return (
      <div>
        <PageHeader eyebrow="تفاصيل المباراة" title="جارٍ التحميل…" />
        <EmptyState icon={Loader2} title="جارٍ تحميل بيانات المباراة" description="نجهّز القوائم والإحصائيات والفرق." />
      </div>
    )
  }

  if (matchQuery.error || !match) {
    return (
      <div>
        <PageHeader eyebrow="تفاصيل المباراة" title="تعذر تحميل المباراة" />
        <EmptyState
          icon={XCircle}
          title="المباراة غير متاحة"
          description={toArabicError(matchQuery.error ?? new Error('MATCH_NOT_FOUND'), 'لم يتم العثور على هذه المباراة.')}
          action={
            <Link to="/matches" className="inline-flex min-h-11 items-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-4 py-2.5 text-xs font-bold text-white/75">
              <ArrowLeft className="size-4" />
              العودة للجدول
            </Link>
          }
        />
      </div>
    )
  }

  return (
    <div>
      <PageHeader
        eyebrow="تفاصيل المباراة"
        title={formatDate(match.local_date)}
        description="كل بيانات هذه المباراة: الموعد، حالة التسجيل، اللاعبون المؤكدون، قائمة الانتظار، والفرق."
        actions={
          <Link to="/matches" className="inline-flex min-h-11 items-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-4 py-2.5 text-xs font-bold text-white/75 transition-colors hover:text-white">
            <ArrowLeft className="size-4" />
            كل المباريات
          </Link>
        }
      />

      <section className="relative overflow-hidden rounded-[2rem] border border-white/10 bg-pitch-900/70 p-6 sm:p-8">
        <div className="bg-turf pointer-events-none absolute inset-0 opacity-60" aria-hidden="true" />
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-l from-pitch-950/95 via-pitch-900/50 to-transparent" aria-hidden="true" />
        <div className="relative">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <Badge variant={match.status === 'registration_open' ? 'brand' : 'warning'}>
                {STATUS_LABELS[match.status] ?? match.status}
              </Badge>
              <h2 className="mt-3 text-2xl font-black text-sand-100 sm:text-3xl">
                {formatDateTime(match.kickoff_at)}
              </h2>
              <p className="mt-2 text-sm text-white/55">{match.venue}</p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-pitch-950/50 px-4 py-3 text-center">
              <p className="text-2xl font-black tabular-nums text-sand-100">{match.team_size * 2}</p>
              <p className="mt-1 text-[11px] text-white/45">لاعبًا في التوزيع</p>
            </div>
          </div>

          <dl className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <InfoItem icon={CalendarDays} label="يوم المباراة" value={formatDate(match.local_date)} />
            <InfoItem icon={Clock} label="وقت الانطلاق" value={formatTime(match.kickoff_at)} />
            <InfoItem icon={MapPin} label="الملعب" value={match.venue} />
            <InfoItem icon={Users} label="التشكيلة" value={match.formation} dir="ltr" />
            <InfoItem icon={CalendarDays} label="فتح التسجيل" value={formatDateTime(match.registration_open_at)} />
            <InfoItem icon={Clock} label="إغلاق التسجيل" value={formatDateTime(match.registration_close_at)} />
            <InfoItem icon={MapPin} label="العنوان" value={match.address ?? '—'} />
            <InfoItem icon={CheckCircle2} label="توزيع الفرق" value={match.teams_generated_at ? formatDateTime(match.teams_generated_at) : 'لم يُنشأ بعد'} />
          </dl>

          {match.notes ? (
            <p className="mt-5 rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-sm leading-7 text-white/55">{match.notes}</p>
          ) : null}
        </div>
      </section>

      <section className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4" aria-label="إحصائيات المباراة">
        <div className="rounded-3xl border border-white/10 bg-white/[0.035] p-4">
          <span className="grid size-9 place-items-center rounded-xl bg-brand-400/10 text-brand-300"><CheckCircle2 className="size-4" /></span>
          <p className="mt-3 text-2xl font-extrabold tabular-nums text-sand-100">{confirmedCount}</p>
          <p className="mt-1 text-xs text-white/45">مؤكدون</p>
        </div>
        <div className="rounded-3xl border border-white/10 bg-white/[0.035] p-4">
          <span className="grid size-9 place-items-center rounded-xl bg-amber-400/10 text-amber-300"><History className="size-4" /></span>
          <p className="mt-3 text-2xl font-extrabold tabular-nums text-sand-100">{waitlistedCount}</p>
          <p className="mt-1 text-xs text-white/45">قائمة الانتظار</p>
        </div>
        <div className="rounded-3xl border border-white/10 bg-white/[0.035] p-4">
          <span className="grid size-9 place-items-center rounded-xl bg-white/5 text-brand-300"><Users className="size-4" /></span>
          <p className="mt-3 text-2xl font-extrabold tabular-nums text-sand-100">{totalRegistrationCount}</p>
          <p className="mt-1 text-xs text-white/45">إجمالي التسجيلات</p>
        </div>
        <div className="rounded-3xl border border-white/10 bg-white/[0.035] p-4">
          <span className="grid size-9 place-items-center rounded-xl bg-white/5 text-white/60"><XCircle className="size-4" /></span>
          <p className="mt-3 text-2xl font-extrabold tabular-nums text-sand-100">{cancelledCount}</p>
          <p className="mt-1 text-xs text-white/45">ملغاة</p>
        </div>
      </section>

      {isAdmin ? (
        <Card className="mt-6 border-brand-400/20 p-5 sm:p-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <h2 className="flex items-center gap-2 text-base font-extrabold text-sand-100">
                <Shuffle className="size-5 text-brand-300" />
                توزيع الفريقين
              </h2>
              <p className="mt-1 text-xs leading-6 text-white/50">
                {teams.length
                  ? 'يمكنك إعادة التوزيع؛ سيُستبدل التوزيع السابق ويُرسل تحديث للاعبين.'
                  : `يُفعّل الزر عند اكتمال 18 لاعبًا مؤكدًا. الحالي ${confirmedCount}/18.`}
              </p>
              {generateError ? <p role="alert" className="mt-3 rounded-xl border border-red-400/20 bg-red-400/[0.06] px-3 py-2 text-xs font-bold leading-6 text-red-200">{generateError}</p> : null}
              {generateSuccess ? <p role="status" className="mt-3 rounded-xl border border-brand-400/20 bg-brand-400/[0.06] px-3 py-2 text-xs font-bold leading-6 text-brand-200">{generateSuccess}</p> : null}
            </div>
            <button
              type="button"
              onClick={() => void handleGenerateTeams()}
              disabled={!canGenerateTeams || generating}
              className="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-2xl bg-brand-400 px-5 py-3 text-sm font-extrabold text-pitch-950 transition-colors hover:bg-brand-300 disabled:opacity-60"
            >
              {generating ? <Loader2 className="size-4 animate-spin" /> : <Shuffle className="size-4" />}
              {teams.length ? 'إعادة توزيع الفريقين' : 'توليد توزيع الفريقين'}
            </button>
          </div>
        </Card>
      ) : null}

      {isAdmin && teams.length ? (
        <Card className="mt-4 border-white/10 p-5 sm:p-6">
          <div>
            <h2 className="flex items-center gap-2 text-base font-extrabold text-sand-100">
              <RotateCcw className="size-5 text-brand-300" />
              مبادلة لاعبين
            </h2>
            <p className="mt-1 text-xs leading-6 text-white/50">
              اختر لاعبين من نفس الفريق أو من فريقين مختلفين لتبديل فريقهم ومركزهم.
            </p>
          </div>

          <form onSubmit={handleSwapPlayers} className="mt-4 grid gap-4 md:grid-cols-[1fr_1fr_auto]">
            <div>
              <label htmlFor="swap-player-a" className="text-xs font-bold text-white/55">
                اللاعب الأول
              </label>
              <select
                id="swap-player-a"
                value={swapPlayerA}
                onChange={(event) => setSwapPlayerA(event.target.value)}
                disabled={swapBusy}
                required
                className="mt-2 min-h-11 w-full rounded-2xl border border-white/10 bg-pitch-950/60 px-4 py-3 text-sm font-semibold text-sand-100 outline-none transition-colors focus:border-brand-400/50"
              >
                <option value="">اختر لاعبًا</option>
                {assignments.map((assignment) => {
                  const player = directoryById.get(assignment.player_id)
                  const team = teamById.get(assignment.team_id)
                  const position = positionByCode.get(assignment.assigned_position_code)
                  return (
                    <option key={assignment.id} value={assignment.player_id}>
                      {player?.full_name ?? 'لاعب'} — {team?.name_ar ?? ''} · {position?.name_ar ?? assignment.assigned_position_code}
                    </option>
                  )
                })}
              </select>
            </div>

            <div>
              <label htmlFor="swap-player-b" className="text-xs font-bold text-white/55">
                اللاعب الثاني
              </label>
              <select
                id="swap-player-b"
                value={swapPlayerB}
                onChange={(event) => setSwapPlayerB(event.target.value)}
                disabled={swapBusy}
                required
                className="mt-2 min-h-11 w-full rounded-2xl border border-white/10 bg-pitch-950/60 px-4 py-3 text-sm font-semibold text-sand-100 outline-none transition-colors focus:border-brand-400/50"
              >
                <option value="">اختر لاعبًا</option>
                {assignments.map((assignment) => {
                  const player = directoryById.get(assignment.player_id)
                  const team = teamById.get(assignment.team_id)
                  const position = positionByCode.get(assignment.assigned_position_code)
                  return (
                    <option key={assignment.id} value={assignment.player_id}>
                      {player?.full_name ?? 'لاعب'} — {team?.name_ar ?? ''} · {position?.name_ar ?? assignment.assigned_position_code}
                    </option>
                  )
                })}
              </select>
            </div>

            <button
              type="submit"
              disabled={swapBusy || !swapPlayerA || !swapPlayerB}
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-2xl bg-brand-400 px-4 py-2.5 text-xs font-extrabold text-pitch-950 transition-colors hover:bg-brand-300 disabled:opacity-60 md:mt-7"
            >
              {swapBusy ? <Loader2 className="size-4 animate-spin" /> : <RotateCcw className="size-4" />}
              تنفيذ المبادلة
            </button>

            {swapError ? <p role="alert" className="rounded-2xl border border-red-400/20 bg-red-400/[0.06] px-4 py-3 text-[12px] leading-6 text-red-200 md:col-span-3">{swapError}</p> : null}
            {swapSuccess ? <p role="status" className="rounded-2xl border border-brand-400/20 bg-brand-400/[0.06] px-4 py-3 text-[12px] leading-6 text-brand-200 md:col-span-3">{swapSuccess}</p> : null}
          </form>
        </Card>
      ) : null}

      {isAdmin && teams.length ? (
        <Card className="mt-4 border-white/10 p-5 sm:p-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <h2 className="flex items-center gap-2 text-base font-extrabold text-sand-100">
                <Palette className="size-5 text-brand-300" />
                ألوان الفرق
              </h2>
              <p className="mt-1 text-xs leading-6 text-white/50">
                اختر لون كل فريق (مثلًا الفريق الأصفر والأزرق). يُطبَّق فورًا على هذه المباراة ويصبح اللون الافتراضي للمباريات القادمة.
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                setTeamColorA(teamColorB)
                setTeamColorB(teamColorA)
              }}
              disabled={colorBusy || !teamColorA || !teamColorB}
              className="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-4 py-2.5 text-xs font-bold text-white/70 transition-colors hover:text-white disabled:opacity-60"
            >
              <RotateCcw className="size-4" />
              تبديل الألوان
            </button>
          </div>

          <form onSubmit={handleSetTeamColors} className="mt-4 grid gap-4 md:grid-cols-[1fr_1fr_auto]">
            <div>
              <label htmlFor="team-color-a" className="flex items-center gap-2 text-xs font-bold text-white/55">
                <span className="size-3.5 rounded-full border border-white/20" style={{ backgroundColor: teamColorA || '#d2ff4d' }} aria-hidden="true" />
                لون {teams.find((team) => team.side === 'A')?.name_ar ?? 'الفريق أ'}
              </label>
              <select
                id="team-color-a"
                value={teamColorA}
                onChange={(event) => setTeamColorA(event.target.value)}
                disabled={colorBusy}
                required
                className="mt-2 min-h-11 w-full rounded-2xl border border-white/10 bg-pitch-950/60 px-4 py-3 text-sm font-semibold text-sand-100 outline-none transition-colors focus:border-brand-400/50"
              >
                {teamColorA && !TEAM_COLOR_PRESETS.some((preset) => preset.value === teamColorA) ? (
                  <option value={teamColorA}>اللون الحالي</option>
                ) : null}
                {TEAM_COLOR_PRESETS.map((preset) => (
                  <option key={preset.value} value={preset.value}>
                    {preset.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="team-color-b" className="flex items-center gap-2 text-xs font-bold text-white/55">
                <span className="size-3.5 rounded-full border border-white/20" style={{ backgroundColor: teamColorB || '#f5f3ea' }} aria-hidden="true" />
                لون {teams.find((team) => team.side === 'B')?.name_ar ?? 'الفريق ب'}
              </label>
              <select
                id="team-color-b"
                value={teamColorB}
                onChange={(event) => setTeamColorB(event.target.value)}
                disabled={colorBusy}
                required
                className="mt-2 min-h-11 w-full rounded-2xl border border-white/10 bg-pitch-950/60 px-4 py-3 text-sm font-semibold text-sand-100 outline-none transition-colors focus:border-brand-400/50"
              >
                {teamColorB && !TEAM_COLOR_PRESETS.some((preset) => preset.value === teamColorB) ? (
                  <option value={teamColorB}>اللون الحالي</option>
                ) : null}
                {TEAM_COLOR_PRESETS.map((preset) => (
                  <option key={preset.value} value={preset.value}>
                    {preset.label}
                  </option>
                ))}
              </select>
            </div>

            <button
              type="submit"
              disabled={colorBusy || !teamColorA || !teamColorB}
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-2xl bg-brand-400 px-4 py-2.5 text-xs font-extrabold text-pitch-950 transition-colors hover:bg-brand-300 disabled:opacity-60 md:mt-7"
            >
              {colorBusy ? <Loader2 className="size-4 animate-spin" /> : <Palette className="size-4" />}
              حفظ الألوان
            </button>

            {colorError ? <p role="alert" className="rounded-2xl border border-red-400/20 bg-red-400/[0.06] px-4 py-3 text-[12px] leading-6 text-red-200 md:col-span-3">{colorError}</p> : null}
            {colorSuccess ? <p role="status" className="rounded-2xl border border-brand-400/20 bg-brand-400/[0.06] px-4 py-3 text-[12px] leading-6 text-brand-200 md:col-span-3">{colorSuccess}</p> : null}
          </form>
        </Card>
      ) : null}

      {isAdmin ? (
        <Card className="mt-4 border-white/10 p-5 sm:p-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <h2 className="flex items-center gap-2 text-base font-extrabold text-sand-100">
                <Link2 className="size-5 text-brand-300" />
                رابط تقييم اللاعبين
              </h2>
              <p className="mt-1 text-xs leading-6 text-white/50">
                أرسل هذا الرابط للاعبين بعد نهاية المباراة؛ سيفتح صفحة التقييم مباشرة على الميدان. يجب أن يكون اللاعب مسجلًا دخوله ومشاركًا في المباراة.
              </p>
            </div>
            <button
              type="button"
              onClick={() => void handleCopyRatingLink()}
              className="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-2xl bg-brand-400 px-4 py-2.5 text-xs font-extrabold text-pitch-950 transition-colors hover:bg-brand-300"
            >
              {ratingLinkCopied ? <Check className="size-4" /> : <Copy className="size-4" />}
              {ratingLinkCopied ? 'تم نسخ الرابط' : 'نسخ رابط التقييم'}
            </button>
          </div>
          <p dir="ltr" className="mt-3 truncate rounded-xl border border-white/10 bg-pitch-950/50 px-3 py-2 text-[11px] text-white/45">
            {getRatingLink()}
          </p>
        </Card>
      ) : null}

      {isAdmin ? (
        <Card className="mt-4 border-white/10 p-5 sm:p-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div className="min-w-0 flex-1">
              <h2 className="flex items-center gap-2 text-base font-extrabold text-sand-100">
                <UserPlus className="size-5 text-brand-300" />
                إضافة لاعب خارجي
              </h2>
              <p className="mt-1 text-xs leading-6 text-white/50">
                لللاعبين خارج المجموعة في مباراة واحدة فقط؛ لا يحتاج حسابًا أو تسجيلًا مسبقًا.
              </p>
            </div>
          </div>

          <form onSubmit={handleAddExternalPlayer} className="mt-4 grid gap-4 md:grid-cols-[1fr_220px_auto]">
            <div>
              <label htmlFor="external-player-name" className="text-xs font-bold text-white/55">
                اسم اللاعب
              </label>
              <input
                id="external-player-name"
                type="text"
                value={externalName}
                onChange={(event) => setExternalName(event.target.value)}
                maxLength={80}
                required
                disabled={externalBusy}
                placeholder="اسم اللاعب الخارجي"
                className="mt-2 min-h-11 w-full rounded-2xl border border-white/10 bg-pitch-950/60 px-4 py-3 text-sm font-semibold text-sand-100 outline-none transition-colors placeholder:text-white/25 focus:border-brand-400/50"
              />
            </div>

            <div>
              <label htmlFor="external-player-position" className="text-xs font-bold text-white/55">
                المركز (اختياري)
              </label>
              <select
                id="external-player-position"
                value={externalPosition}
                onChange={(event) => setExternalPosition(event.target.value)}
                disabled={externalBusy}
                className="mt-2 min-h-11 w-full rounded-2xl border border-white/10 bg-pitch-950/60 px-4 py-3 text-sm font-semibold text-sand-100 outline-none transition-colors focus:border-brand-400/50"
              >
                <option value="">بدون مركز محدد</option>
                {(positionsQuery.data ?? []).map((position) => (
                  <option key={position.code} value={position.code}>
                    {position.name_ar}
                  </option>
                ))}
              </select>
            </div>

            <button
              type="submit"
              disabled={externalBusy}
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-2xl bg-brand-400 px-4 py-2.5 text-xs font-extrabold text-pitch-950 transition-colors hover:bg-brand-300 disabled:opacity-60 md:mt-7"
            >
              {externalBusy ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
              إضافة للمباراة
            </button>

            {externalError ? <p role="alert" className="rounded-2xl border border-red-400/20 bg-red-400/[0.06] px-4 py-3 text-[12px] leading-6 text-red-200 md:col-span-3">{externalError}</p> : null}
            {externalSuccess ? <p role="status" className="rounded-2xl border border-brand-400/20 bg-brand-400/[0.06] px-4 py-3 text-[12px] leading-6 text-brand-200 md:col-span-3">{externalSuccess}</p> : null}
          </form>
        </Card>
      ) : null}

      <section className="mt-8" aria-label="نتيجة المباراة">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-2 text-lg font-extrabold text-sand-100">
              <Trophy className="size-5 text-brand-300" />
              نتيجة المباراة
            </h2>
            <p className="mt-1 text-sm text-white/45">النتيجة النهائية وهدافو المباراة.</p>
          </div>
          <Badge variant={result ? 'brand' : 'neutral'}>{result ? 'منشورة' : 'غير منشورة'}</Badge>
        </div>

        {result ? (
          <Card className="overflow-hidden p-5 sm:p-6">
            <div className="grid items-center gap-5 md:grid-cols-[1fr_auto_1fr]">
              {['A', 'B'].map((side) => {
                const team = teams.find((item) => item.side === side)
                const score = side === 'A' ? result.team_a_score : result.team_b_score
                const teamScorers = matchScorers.filter((scorer) => scorer.team_id === team?.id)
                return (
                  <div key={side} className="min-w-0 text-center">
                    <div className="flex items-center justify-center gap-2">
                      <span className="size-3.5 rounded-full" style={{ backgroundColor: team?.color ?? '#d2ff4d' }} aria-hidden="true" />
                      <p className="text-sm font-extrabold text-sand-100">{team?.name_ar ?? (side === 'A' ? 'الفريق أ' : 'الفريق ب')}</p>
                    </div>
                    <p className="mt-3 text-5xl font-black tabular-nums text-sand-100">{score}</p>
                    <div className="mt-4 space-y-2">
                      {teamScorers.length ? (
                        teamScorers.map((scorer) => {
                          const player = directoryById.get(scorer.player_id)
                          return (
                            <div key={scorer.id} className="flex items-center justify-between gap-3 rounded-xl bg-white/[0.03] px-3 py-2 text-start">
                              <span className="min-w-0 truncate text-xs font-bold text-white/75">{player?.full_name ?? 'لاعب'}</span>
                              <span className="shrink-0 text-[11px] font-extrabold text-brand-200">
                                {[
                                  scorer.goals ? `${scorer.goals} هدف` : null,
                                  scorer.assists ? `${scorer.assists} تمريرة` : null,
                                ]
                                  .filter(Boolean)
                                  .join(' · ') || 'بدون إحصائيات'}
                              </span>
                            </div>
                          )
                        })
                      ) : (
                        <p className="text-[11px] text-white/35">لا يوجد هدافون مسجلون.</p>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
            {result.notes ? <p className="mt-5 rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-sm leading-7 text-white/55">{result.notes}</p> : null}
          </Card>
        ) : (
          <EmptyState icon={Trophy} title="لم تُنشر النتيجة بعد" description="ستظهر هنا النتيجة النهائية والهدافون بعد إدخال الإدارة لها." />
        )}

        {isAdmin ? (
          <Card className="mt-4 border-brand-400/20 p-5 sm:p-6">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h3 className="text-base font-extrabold text-sand-100">{result ? 'تعديل نتيجة المباراة' : 'إدخال نتيجة المباراة'}</h3>
                <p className="mt-1 text-xs leading-6 text-white/50">
                  {teams.length
                    ? 'أدخل النتيجة النهائية والهدافين لكل فريق؛ يجب أن يطابق مجموع الأهداف النتيجة.'
                    : 'أنشئ توزيع الفريقين أولًا لاختيار الهدافين حسب الفريق.'}
                </p>
              </div>
              <button
                type="button"
                onClick={openResultForm}
                disabled={!teams.length}
                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-2xl bg-brand-400 px-4 py-2.5 text-xs font-extrabold text-pitch-950 transition-colors hover:bg-brand-300 disabled:opacity-60"
              >
                <Trophy className="size-4" />
                {result ? 'تعديل النتيجة' : 'إدخال النتيجة'}
              </button>
            </div>

            {resultFormOpen ? (
              <form onSubmit={handleSubmitResult} className="mt-5 grid gap-4 md:grid-cols-2">
                <div>
                  <label htmlFor="result-score-a" className="text-xs font-bold text-white/55">أهداف {teams.find((team) => team.side === 'A')?.name_ar ?? 'الفريق أ'}</label>
                  <input id="result-score-a" type="number" min="0" max="99" value={teamAScore} onChange={(event) => setTeamAScore(event.target.value)} required disabled={resultBusy} className="mt-2 w-full rounded-2xl border border-white/10 bg-pitch-950/60 px-4 py-3 text-sm font-semibold text-sand-100 outline-none transition-colors placeholder:text-white/25 focus:border-brand-400/50" />
                </div>
                <div>
                  <label htmlFor="result-score-b" className="text-xs font-bold text-white/55">أهداف {teams.find((team) => team.side === 'B')?.name_ar ?? 'الفريق ب'}</label>
                  <input id="result-score-b" type="number" min="0" max="99" value={teamBScore} onChange={(event) => setTeamBScore(event.target.value)} required disabled={resultBusy} className="mt-2 w-full rounded-2xl border border-white/10 bg-pitch-950/60 px-4 py-3 text-sm font-semibold text-sand-100 outline-none transition-colors placeholder:text-white/25 focus:border-brand-400/50" />
                </div>

                <div className="md:col-span-2">
                  <label htmlFor="result-notes" className="text-xs font-bold text-white/55">ملاحظات النتيجة (اختياري)</label>
                  <textarea id="result-notes" value={resultNotes} onChange={(event) => setResultNotes(event.target.value)} rows={3} disabled={resultBusy} className="mt-2 w-full resize-none rounded-2xl border border-white/10 bg-pitch-950/60 px-4 py-3 text-sm font-semibold text-sand-100 outline-none transition-colors placeholder:text-white/25 focus:border-brand-400/50" />
                </div>

                <div className="md:col-span-2">
                  <p className="text-xs font-bold text-white/55">الهدافون</p>
                  <div className="mt-3 space-y-3">
                    {scorersDraft.map((scorer, index) => (
                      <div key={index} className="grid gap-3 rounded-2xl border border-white/10 bg-white/[0.025] p-3 md:grid-cols-[1fr_110px_110px_auto]">
                        <select
                          value={scorer.player_id}
                          onChange={(event) => updateScorerDraft(index, 'player_id', event.target.value)}
                          disabled={resultBusy}
                          required
                          className="w-full rounded-xl border border-white/10 bg-pitch-950/60 px-3 py-2.5 text-sm font-semibold text-sand-100 outline-none focus:border-brand-400/50"
                          aria-label="اللاعب الهداف"
                        >
                          <option value="">اختر لاعبًا</option>
                          {assignedPlayerOptions.map(({ assignment, player, team }) => (
                            <option key={assignment.id} value={assignment.player_id}>
                              {player?.full_name ?? 'لاعب'} — {team?.name_ar ?? ''}
                            </option>
                          ))}
                        </select>
                        <label className="grid gap-1 text-[11px] font-bold text-white/45">
                          أهداف
                          <input type="number" min="0" max="30" value={scorer.goals} onChange={(event) => updateScorerDraft(index, 'goals', event.target.value)} disabled={resultBusy} required className="w-full rounded-xl border border-white/10 bg-pitch-950/60 px-3 py-2.5 text-sm font-semibold text-sand-100 outline-none focus:border-brand-400/50" />
                        </label>
                        <label className="grid gap-1 text-[11px] font-bold text-white/45">
                          تمريرات
                          <input type="number" min="0" max="30" value={scorer.assists} onChange={(event) => updateScorerDraft(index, 'assists', event.target.value)} disabled={resultBusy} required className="w-full rounded-xl border border-white/10 bg-pitch-950/60 px-3 py-2.5 text-sm font-semibold text-sand-100 outline-none focus:border-brand-400/50" />
                        </label>
                        <button
                          type="button"
                          onClick={() => setScorersDraft((current) => current.filter((_, scorerIndex) => scorerIndex !== index))}
                          disabled={resultBusy}
                          className="grid min-h-11 min-w-11 place-items-center rounded-xl border border-red-400/25 text-red-300 transition-colors hover:bg-red-400/10 disabled:opacity-50"
                          aria-label="إزالة الهداف"
                        >
                          <Trash2 className="size-4" />
                        </button>
                      </div>
                    ))}
                  </div>
                  <button type="button" onClick={() => setScorersDraft((current) => [...current, { player_id: '', goals: '1', assists: '0' }])} disabled={resultBusy} className="mt-3 inline-flex min-h-11 items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-xs font-bold text-white/70 transition-colors hover:text-white disabled:opacity-60">
                    <Plus className="size-4" />
                    إضافة هداف
                  </button>
                </div>

                {resultError ? <p role="alert" className="rounded-2xl border border-red-400/20 bg-red-400/[0.06] px-4 py-3 text-[12px] leading-6 text-red-200 md:col-span-2">{resultError}</p> : null}
                {resultSuccess ? <p role="status" className="rounded-2xl border border-brand-400/20 bg-brand-400/[0.06] px-4 py-3 text-[12px] leading-6 text-brand-200 md:col-span-2">{resultSuccess}</p> : null}

                <div className="flex flex-wrap gap-2 md:col-span-2">
                  <button type="submit" disabled={resultBusy} className="inline-flex min-h-11 items-center gap-2 rounded-2xl bg-brand-400 px-4 py-2.5 text-xs font-extrabold text-pitch-950 transition-colors hover:bg-brand-300 disabled:opacity-60">
                    {resultBusy ? <Loader2 className="size-4 animate-spin" /> : <CheckCircle2 className="size-4" />}
                    حفظ النتيجة
                  </button>
                  <button type="button" onClick={() => setResultFormOpen(false)} disabled={resultBusy} className="inline-flex min-h-11 items-center rounded-2xl border border-white/10 bg-white/5 px-4 py-2.5 text-xs font-bold text-white/60 transition-colors hover:text-white disabled:opacity-60">
                    إلغاء
                  </button>
                </div>
              </form>
            ) : null}
          </Card>
        ) : null}
      </section>

      <section ref={pitchRef} className="mt-8 scroll-mt-24" aria-label="الميدان">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-2 text-lg font-extrabold text-sand-100">
              <Users className="size-5 text-brand-300" />
              الميدان
            </h2>
            <p className="mt-1 text-sm text-white/45">
              اضغط على أي لاعب لتقييمه من 1 إلى 10. الإدارة: اضغط على لاعب لإدخال أهدافه وتمريراته مباشرة.
            </p>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-2">
            <Badge variant={canRate ? 'brand' : 'neutral'}>
              {canRate ? 'يمكنك التقييم الآن' : 'التقييم غير متاح'}
            </Badge>
            {isAdmin && teams.length ? (
              <button
                type="button"
                onClick={() => {
                  setSwapMode((value) => !value)
                  setPitchSwapFirstId(null)
                  setPitchNotice(null)
                }}
                aria-pressed={swapMode}
                className={`inline-flex min-h-11 items-center gap-2 rounded-2xl border px-4 py-2.5 text-xs font-extrabold transition-colors ${swapMode ? 'border-brand-400/50 bg-brand-400/15 text-brand-200' : 'border-white/10 bg-white/5 text-white/70 hover:text-white'}`}
              >
                <Shuffle className="size-4" />
                {swapMode ? 'وضع المبادلة مفعّل — اضغط للإيقاف' : 'مبادلة اللاعبين'}
              </button>
            ) : null}
          </div>
        </div>

        {isAdmin && teams.length ? (
          <p className="mb-4 text-[11px] leading-5 text-white/40">
            للمبادلة: اسحب أي لاعب وأفلته على لاعب آخر، أو فعّل «مبادلة اللاعبين» ثم اضغط على لاعبين — يعمل في نفس الفريق وبين الفريقين.
          </p>
        ) : null}

        {swapMode && isAdmin && teams.length ? (
          <div role="status" className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-brand-400/25 bg-brand-400/[0.08] px-4 py-3 text-xs font-bold leading-6 text-brand-100">
            <span>
              {pitchSwapFirstId
                ? `اختر اللاعب الثاني للمبادلة مع ${directoryById.get(pitchSwapFirstId)?.full_name ?? 'لاعب'}.`
                : 'اضغط على لاعب، ثم على اللاعب الثاني — في نفس الفريق أو الفريق الآخر.'}
            </span>
            <button
              type="button"
              onClick={() => {
                setPitchSwapFirstId(null)
                setPitchNotice(null)
              }}
              className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-[11px] font-bold text-white/70 transition-colors hover:text-white"
            >
              <XCircle className="size-4" />
              إلغاء التحديد
            </button>
          </div>
        ) : null}

        {pitchNotice ? (
          <div
            role={pitchNotice.type === 'err' ? 'alert' : 'status'}
            className={`mb-4 rounded-2xl border px-4 py-3 text-xs font-bold leading-6 ${pitchNotice.type === 'err' ? 'border-red-400/20 bg-red-400/[0.06] text-red-200' : pitchNotice.type === 'ok' ? 'border-brand-400/20 bg-brand-400/[0.06] text-brand-200' : 'border-white/10 bg-white/[0.04] text-white/65'}`}
          >
            {pitchNotice.text}
          </div>
        ) : null}

        {isRateMode ? (
          <div role="status" className="mb-4 rounded-2xl border border-brand-400/25 bg-brand-400/[0.08] px-4 py-3 text-xs font-bold leading-6 text-brand-100">
            {canRate
              ? 'صفحة التقييم: اضغط على أي لاعب على الميدان لتقييمه من 1 إلى 10.'
              : match.status !== 'completed'
                ? 'وصلت إلى صفحة التقييم. سيبدأ التقييم بعد إدخال الإدارة لنتيجة المباراة.'
                : 'التقييم متاح للاعبين المشاركين في المباراة فقط.'}
          </div>
        ) : null}

        <div className="relative overflow-hidden rounded-[2rem] border border-emerald-300/15 bg-pitch-900/80 p-4 sm:p-6">
          <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,rgba(255,255,255,0.035)_0,rgba(255,255,255,0)_50%,rgba(255,255,255,0.035)_100%)]" aria-hidden="true" />
          <div className="pointer-events-none absolute inset-3 rounded-[1.5rem] border border-white/20" aria-hidden="true" />
          <div className="pointer-events-none absolute inset-x-3 top-1/2 h-px bg-white/25" aria-hidden="true" />
          <div className="pointer-events-none absolute left-1/2 top-1/2 size-28 -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/25" aria-hidden="true" />
          <div className="pointer-events-none absolute left-1/2 top-3 h-14 w-40 -translate-x-1/2 border border-white/20 border-t-0" aria-hidden="true" />
          <div className="pointer-events-none absolute bottom-3 left-1/2 h-14 w-40 -translate-x-1/2 border border-white/20 border-b-0" aria-hidden="true" />

          <div className="relative z-10">
            {registrationsQuery.isLoading ? (
              <Card className="flex items-center gap-3 p-5 text-sm text-white/45"><Loader2 className="size-4 animate-spin text-brand-300" /> جارٍ تحميل اللاعبين…</Card>
            ) : registrationsQuery.error ? (
              <Card className="p-5 text-sm text-red-300">{toArabicError(registrationsQuery.error)}</Card>
            ) : teams.length === 0 ? (
              confirmedPlayers.length ? (
                <div className="space-y-4">
                  <div className="text-center">
                    <p className="text-xs font-extrabold text-brand-200">قبل توزيع الفرق</p>
                    <p className="mt-1 text-[11px] text-white/45">{confirmedCount} لاعب مؤكد على الميدان</p>
                  </div>
                  {[
                    { label: 'حراسة المرمى', registrations: confirmedPlayers.filter((registration) => registration.roster_role === 'gk') },
                    { label: 'الدفاع', registrations: confirmedPlayers.filter((registration) => registration.roster_role !== 'gk').slice(0, 6) },
                    { label: 'الوسط', registrations: confirmedPlayers.filter((registration) => registration.roster_role !== 'gk').slice(6, 12) },
                    { label: 'الهجوم', registrations: confirmedPlayers.filter((registration) => registration.roster_role !== 'gk').slice(12, 16) },
                  ].map((group) => (
                    <div key={group.label} className="rounded-2xl bg-pitch-950/25 p-3">
                      <p className="mb-3 text-center text-[10px] font-bold uppercase tracking-[0.18em] text-white/35">{group.label}</p>
                      <div className="flex flex-wrap justify-center gap-x-4 gap-y-4 sm:gap-x-6">
                        {group.registrations.map((registration) => {
                          const player = directoryById.get(registration.player_id)
                          const stat = ratingStatsByPlayer.get(registration.player_id)
                          const allTime = allTimeStatsByPlayer.get(registration.player_id)
                          const allTimeLabel = allTime && (allTime.total_goals || allTime.total_assists)
                            ? `${allTime.total_goals} هدف · ${allTime.total_assists} تمريرة`
                            : null
                          return (
                            <PitchPlayerButton
                              key={registration.id}
                              player={player}
                              averageRating={stat?.average_rating}
                              myRating={myRatingsByPlayer.get(registration.player_id) ?? 0}
                              jerseyNumber={player?.jersey_number}
                              goals={scorerByPlayer.get(registration.player_id)?.goals ?? 0}
                              assists={scorerByPlayer.get(registration.player_id)?.assists ?? 0}
                              showExternalRing={isAdmin && Boolean(player?.is_external)}
                              subLabel={`${allTimeLabel ?? roleLabel(registration.roster_role)}${isAdmin && player?.is_external ? ' · ضيف' : ''}`}
                              selected={ratingTarget?.playerId === registration.player_id}
                              onSelect={() =>
                                setRatingTarget({
                                  playerId: registration.player_id,
                                  player,
                                  average: stat,
                                  myRating: myRatingsByPlayer.get(registration.player_id) ?? 0,
                                  positionLabel: roleLabel(registration.roster_role),
                                })
                              }
                            />
                          )
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <EmptyState icon={UserCheck} title="لا يوجد لاعبون مؤكدون بعد" description="ستظهر هنا أسماء اللاعبين فور اكتمال تسجيلهم." />
              )
            ) : (
              <div className="space-y-5">
                {teams.map((team) => {
                  const teamAssignments = assignments.filter((assignment) => assignment.team_id === team.id)
                  const groups = { gk: [], defense: [], midfield: [], attack: [] }
                  for (const assignment of teamAssignments) {
                    const position = positionByCode.get(assignment.assigned_position_code)
                    const category = position?.category ?? (assignment.assigned_position_code === 'GK' ? 'gk' : 'midfield')
                    groups[category]?.push(assignment)
                  }
                  const rows = team.side === 'A'
                    ? [groups.gk, groups.defense, groups.midfield, groups.attack]
                    : [groups.attack, groups.midfield, groups.defense, groups.gk]
                  return (
                    <div key={team.id} className="rounded-2xl bg-pitch-950/25 p-3">
                      <div className="mb-3 flex flex-col items-center gap-2">
                        <div className="flex items-center justify-center gap-2">
                          <span className="size-3.5 rounded-full border border-white/20" style={{ backgroundColor: team.color ?? '#d2ff4d' }} aria-hidden="true" />
                          <p className="text-xs font-extrabold text-sand-100">{team.name_ar}</p>
                          <span className="text-[10px] font-bold text-white/40">{teamAssignments.length}/9</span>
                        </div>
                        {isAdmin ? (
                          <div className="flex items-center gap-1.5" aria-label={`لون ${team.name_ar}`}>
                            {TEAM_COLOR_PRESETS.map((preset) => {
                              const active = (team.color ?? '').toLowerCase() === preset.value.toLowerCase()
                              return (
                                <button
                                  key={preset.value}
                                  type="button"
                                  title={preset.label}
                                  aria-label={`تعيين ${team.name_ar} باللون ${preset.label}`}
                                  disabled={colorBusy}
                                  onClick={() => void handleSetSingleTeamColor(team.side, preset.value)}
                                  className={`size-6 rounded-full border transition-all disabled:opacity-50 ${active ? 'scale-110 border-white ring-2 ring-white/40' : 'border-white/20 hover:scale-110'}`}
                                  style={{ backgroundColor: preset.value }}
                                />
                              )
                            })}
                          </div>
                        ) : null}
                      </div>
                      <div className="space-y-3">
                        {rows.map((row, rowIndex) => (
                          row.length ? (
                            <div key={`${team.id}-${rowIndex}`} className="flex flex-wrap items-start justify-center gap-x-4 gap-y-4 sm:gap-x-6">
                              {row.map((assignment) => {
                                const player = directoryById.get(assignment.player_id)
                                const position = positionByCode.get(assignment.assigned_position_code)
                                const stat = ratingStatsByPlayer.get(assignment.player_id)
                                const matchScorer = scorerByPlayer.get(assignment.player_id)
                                return (
                                  <PitchPlayerButton
                                    key={assignment.id}
                                    player={player}
                                    averageRating={stat?.average_rating}
                                    myRating={myRatingsByPlayer.get(assignment.player_id) ?? 0}
                                    jerseyNumber={player?.jersey_number}
                                    goals={matchScorer?.goals ?? 0}
                                    assists={matchScorer?.assists ?? 0}
                                    showExternalRing={isAdmin && Boolean(player?.is_external)}
                                    subLabel={`${position?.name_ar ?? assignment.assigned_position_code}${assignment.is_out_of_position ? ' · خارج مركزه' : ''}${isAdmin && player?.is_external ? ' · ضيف (مرة واحدة)' : ''}`}
                                    selected={ratingTarget?.playerId === assignment.player_id || pitchSwapFirstId === assignment.player_id}
                                    dropActive={dragTargetId === assignment.player_id}
                                    draggable={isAdmin && !pitchSwapBusy}
                                    onDragStart={(event) => handlePitchDragStart(event, assignment.player_id)}
                                    onDragOver={(event) => handlePitchDragOver(event, assignment.player_id)}
                                    onDrop={(event) => handlePitchDrop(event, assignment.player_id)}
                                    onDragEnd={() => setDragTargetId(null)}
                                    onSelect={() => {
                                      if (swapMode && isAdmin) {
                                        void handlePitchPlayerPick(assignment.player_id)
                                        return
                                      }
                                      setRatingTarget({
                                        playerId: assignment.player_id,
                                        player,
                                        average: stat,
                                        myRating: myRatingsByPlayer.get(assignment.player_id) ?? 0,
                                        positionLabel: position?.name_ar ?? assignment.assigned_position_code,
                                        statsGoals: matchScorer?.goals ?? 0,
                                        statsAssists: matchScorer?.assists ?? 0,
                                      })
                                    }}
                                  />
                                )
                              })}
                            </div>
                          ) : null
                        ))}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      </section>

      <section className="mt-8" aria-label="قائمة الانتظار">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="flex items-center gap-2 text-base font-extrabold text-sand-100">
            <History className="size-5 text-amber-300" />
            قائمة الانتظار
          </h2>
          <span className="text-xs font-bold text-white/35">{waitlistedCount} لاعب</span>
        </div>

          {waitlistedPlayers.length ? (
            <div className="space-y-2.5">
              {waitlistedPlayers.map((registration) => (
                <RegistrationPlayerRow key={registration.id} registration={registration} directoryById={directoryById} positionByCode={positionByCode} />
              ))}
            </div>
          ) : (
            <EmptyState icon={History} title="لا يوجد لاعبون في الانتظار" description="عند اكتمال السعة، سينتقل التسجيل الجديد إلى هنا حسب الترتيب." />
          )}
      </section>

      {ratingTarget ? (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-pitch-950/80 p-3 backdrop-blur-sm sm:items-center sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="rating-player-title"
          onClick={() => setRatingTarget(null)}
        >
          <div
            className="max-h-[92dvh] min-h-0 w-full max-w-md overflow-y-auto overscroll-contain rounded-[2rem] border border-white/10 bg-pitch-900/95 p-5 shadow-glow sm:p-6"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                <Avatar player={ratingTarget.player} size={48} />
                <div>
                  <h2 id="rating-player-title" className="text-base font-extrabold text-sand-100">
                    {ratingTarget.player?.full_name ?? 'لاعب'}
                  </h2>
                  <p className="mt-1 text-xs text-white/50">
                    {ratingTarget.average
                      ? `متوسط ${ratingTarget.average.average_rating} من 10 · ${ratingTarget.average.rating_count} تقييم`
                      : `لا توجد تقييمات بعد · ${ratingTarget.positionLabel ?? ''}`}
                  </p>
                  {isAdmin && ratingTarget.player?.is_external ? (
                    <span className="mt-1.5 inline-flex items-center gap-1 rounded-full border border-red-400/40 bg-red-400/10 px-2 py-0.5 text-[10px] font-extrabold text-red-200">
                      لاعب ضيف — مرة واحدة
                    </span>
                  ) : null}
                  {allTimeStatsByPlayer.get(ratingTarget.playerId) ? (
                    <p className="mt-1 text-[11px] text-white/45">
                      كل المباريات: {allTimeStatsByPlayer.get(ratingTarget.playerId).total_goals} هدف ·{' '}
                      {allTimeStatsByPlayer.get(ratingTarget.playerId).total_assists} تمريرة
                    </p>
                  ) : null}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setRatingTarget(null)}
                className="grid size-11 shrink-0 place-items-center rounded-xl text-white/45 transition-colors hover:text-white"
                aria-label="إغلاق التقييم"
              >
                <XCircle className="size-5" />
              </button>
            </div>

            {ratingTarget.playerId === profile?.id ? (
              <p className="mt-5 rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-xs leading-6 text-white/60">
                لا يمكنك تقييم نفسك. اضغط على لاعب آخر للتقييم.
              </p>
            ) : (
              <>
                {ratingTarget.myRating ? (
                  <p className="mt-5 text-xs font-bold text-brand-200">تقييمك الحالي: {ratingTarget.myRating}/10</p>
                ) : null}
                <div className="mt-4 grid grid-cols-5 gap-2" aria-label={`اختيار تقييم ${ratingTarget.player?.full_name ?? 'لاعب'}`}>
                  {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((value) => {
                    const active = value <= ratingTarget.myRating
                    const busy = ratingBusyPlayerId === ratingTarget.playerId
                    return (
                      <button
                        key={value}
                        type="button"
                        onClick={() => void handleRatePlayer(ratingTarget.playerId, value)}
                        disabled={busy || !canRate}
                        aria-label={`تقييم ${value} من 10`}
                        className={`grid min-h-11 place-items-center rounded-xl border text-sm font-black transition-colors disabled:opacity-60 ${active ? 'border-brand-400/40 bg-brand-400/15 text-brand-300' : 'border-white/10 bg-white/[0.03] text-white/40 hover:text-brand-200'}`}
                      >
                        {value}
                      </button>
                    )
                  })}
                </div>
                {!canRate ? (
                  <p className="mt-4 rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-xs leading-6 text-white/55">
                    {match.status !== 'completed'
                      ? 'التقييم يبدأ بعد نهاية المباراة.'
                      : 'التقييم للمشاركين المؤكدين فقط.'}
                  </p>
                ) : null}
              </>
            )}

            {isAdmin ? (
              <form onSubmit={handleSavePlayerStats} className="mt-5 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                <h3 className="flex items-center gap-2 text-sm font-extrabold text-sand-100">
                  <Trophy className="size-4 text-brand-300" />
                  أهداف وتمريرات هذه المباراة
                </h3>
                {assignmentByPlayerId.has(ratingTarget.playerId) ? (
                  <>
                    <div className="mt-3 grid grid-cols-2 gap-3">
                      {[
                        { label: 'أهداف', value: statsGoals, set: setStatsGoals },
                        { label: 'تمريرات', value: statsAssists, set: setStatsAssists },
                      ].map(({ label, value, set }) => (
                        <div key={label} className="rounded-2xl border border-white/10 bg-pitch-950/50 px-3 py-2.5">
                          <span className="text-[11px] font-bold text-white/50">{label}</span>
                          <div className="mt-1.5 flex items-center justify-between gap-2">
                            <button
                              type="button"
                              onClick={() => set(Math.max(0, value - 1))}
                              disabled={statsBusy || value <= 0}
                              aria-label={`إنقاص ${label}`}
                              className="grid size-10 place-items-center rounded-xl border border-white/10 text-white/70 transition-colors hover:text-white disabled:opacity-40"
                            >
                              <Minus className="size-4" />
                            </button>
                            <span className="text-xl font-black tabular-nums text-sand-100">{value}</span>
                            <button
                              type="button"
                              onClick={() => set(Math.min(30, value + 1))}
                              disabled={statsBusy || value >= 30}
                              aria-label={`زيادة ${label}`}
                              className="grid size-10 place-items-center rounded-xl border border-white/10 text-white/70 transition-colors hover:text-white disabled:opacity-40"
                            >
                              <Plus className="size-4" />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                    {statsError ? <p role="alert" className="mt-3 rounded-xl border border-red-400/20 bg-red-400/[0.06] px-3 py-2 text-xs font-bold leading-6 text-red-200">{statsError}</p> : null}
                    {statsSuccess ? <p role="status" className="mt-3 rounded-xl border border-brand-400/20 bg-brand-400/[0.06] px-3 py-2 text-xs font-bold leading-6 text-brand-200">{statsSuccess}</p> : null}
                    <button
                      type="submit"
                      disabled={statsBusy}
                      className="mt-3 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-2xl bg-brand-400 px-4 py-2.5 text-xs font-extrabold text-pitch-950 transition-colors hover:bg-brand-300 disabled:opacity-60"
                    >
                      {statsBusy ? <Loader2 className="size-4 animate-spin" /> : <CheckCircle2 className="size-4" />}
                      حفظ وتحديث النتيجة
                    </button>
                    <p className="mt-2 text-[11px] leading-5 text-white/40">
                      تُحدَّث النتيجة النهائية تلقائيًا وتُفتح التقييمات. حفظ 0 أهداف و0 تمريرات يزيل إحصائيات اللاعب.
                    </p>
                  </>
                ) : (
                  <p className="mt-3 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-xs leading-6 text-white/55">
                    أنشئ توزيع الفريقين أولًا لإدخال إحصائيات هذا اللاعب.
                  </p>
                )}
              </form>
            ) : null}

            {isAdmin && assignmentByPlayerId.has(ratingTarget.playerId) ? (
              <form onSubmit={handleModalSwap} className="mt-4 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                <h3 className="flex items-center gap-2 text-sm font-extrabold text-sand-100">
                  <Shuffle className="size-4 text-brand-300" />
                  مبادلة هذا اللاعب
                </h3>
                <label htmlFor="modal-swap-target" className="mt-3 block text-[11px] font-bold text-white/50">
                  مبادلة مع
                </label>
                <select
                  id="modal-swap-target"
                  value={modalSwapTarget}
                  onChange={(event) => setModalSwapTarget(event.target.value)}
                  disabled={modalSwapBusy}
                  required
                  className="mt-2 min-h-11 w-full rounded-2xl border border-white/10 bg-pitch-950/60 px-4 py-3 text-sm font-semibold text-sand-100 outline-none focus:border-brand-400/50"
                >
                  <option value="">اختر لاعبًا</option>
                  {(() => {
                    const others = assignments
                      .filter((assignment) => assignment.player_id !== ratingTarget.playerId)
                      .map((assignment) => ({
                        assignment,
                        player: directoryById.get(assignment.player_id),
                        team: teamById.get(assignment.team_id),
                        position: positionByCode.get(assignment.assigned_position_code),
                      }))
                    const regular = others.filter((item) => !item.player?.is_external)
                    const guests = others.filter((item) => item.player?.is_external)
                    const notRegistered = (allPlayersQuery.data ?? []).filter(
                      (candidate) =>
                        candidate.id !== ratingTarget.playerId &&
                        !assignmentByPlayerId.has(candidate.id) &&
                        !candidate.is_external,
                    )
                    const renderOption = ({ assignment, player, team, position }) => (
                      <option key={assignment.id} value={assignment.player_id}>
                        {player?.full_name ?? 'لاعب'} — {team?.name_ar ?? ''} · {position?.name_ar ?? assignment.assigned_position_code}
                      </option>
                    )
                    return (
                      <>
                        {regular.length ? <optgroup label="لاعبون مسجلون في الفرق">{regular.map(renderOption)}</optgroup> : null}
                        {guests.length ? <optgroup label="لاعبون ضيوف (مرة واحدة)">{guests.map(renderOption)}</optgroup> : null}
                        {allPlayersQuery.isLoading ? <option value="" disabled>جارٍ تحميل اللاعبين…</option> : null}
                        {notRegistered.length ? (
                          <optgroup label="لم يسجلوا في هذه المباراة">
                            {notRegistered.map((candidate) => (
                              <option key={candidate.id} value={candidate.id}>
                                {candidate.full_name}
                                {candidate.jersey_number ? ` — رق ${candidate.jersey_number}` : ''}
                              </option>
                            ))}
                          </optgroup>
                        ) : null}
                      </>
                    )
                  })()}
                </select>
                {modalSwapError ? <p role="alert" className="mt-3 rounded-xl border border-red-400/20 bg-red-400/[0.06] px-3 py-2 text-xs font-bold leading-6 text-red-200">{modalSwapError}</p> : null}
                <button
                  type="submit"
                  disabled={modalSwapBusy || !modalSwapTarget}
                  className="mt-3 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-2xl border border-brand-400/30 bg-brand-400/10 px-4 py-2.5 text-xs font-extrabold text-brand-200 transition-colors hover:bg-brand-400/20 disabled:opacity-60"
                >
                  {modalSwapBusy ? <Loader2 className="size-4 animate-spin" /> : <RotateCcw className="size-4" />}
                  تنفيذ المبادلة
                </button>
                <p className="mt-2 text-[11px] leading-5 text-white/40">
                  يعمل داخل نفس الفريق وبين الفريقين ومع اللاعبين الضيوف، أو يستبدل اللاعب بلاعب من الفريق لم يسجل في هذه المباراة. لا يمكن مبادلة حارس مرمى مع لاعب ميدان.
                </p>
              </form>
            ) : null}

            {isAdmin && assignmentByPlayerId.has(ratingTarget.playerId) ? (
              <form onSubmit={handleSetPlayerPosition} className="mt-4 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                <h3 className="flex items-center gap-2 text-sm font-extrabold text-sand-100">
                  <MapPin className="size-4 text-brand-300" />
                  تغيير مركز اللاعب
                </h3>
                <label htmlFor="modal-player-position" className="mt-3 block text-[11px] font-bold text-white/50">
                  المركز الجديد
                </label>
                <select
                  id="modal-player-position"
                  value={modalPosition}
                  onChange={(event) => setModalPosition(event.target.value)}
                  disabled={modalPositionBusy}
                  required
                  className="mt-2 min-h-11 w-full rounded-2xl border border-white/10 bg-pitch-950/60 px-4 py-3 text-sm font-semibold text-sand-100 outline-none focus:border-brand-400/50"
                >
                  <option value="">اختر مركزًا</option>
                  {(positionsQuery.data ?? []).map((position) => (
                    <option key={position.code} value={position.code}>
                      {position.name_ar}
                      {position.code === assignmentByPlayerId.get(ratingTarget.playerId)?.assigned_position_code ? ' — الحالي' : ''}
                    </option>
                  ))}
                </select>
                {modalPositionError ? <p role="alert" className="mt-3 rounded-xl border border-red-400/20 bg-red-400/[0.06] px-3 py-2 text-xs font-bold leading-6 text-red-200">{modalPositionError}</p> : null}
                {modalPositionSuccess ? <p role="status" className="mt-3 rounded-xl border border-brand-400/20 bg-brand-400/[0.06] px-3 py-2 text-xs font-bold leading-6 text-brand-200">{modalPositionSuccess}</p> : null}
                <button
                  type="submit"
                  disabled={modalPositionBusy || !modalPosition}
                  className="mt-3 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-2xl border border-brand-400/30 bg-brand-400/10 px-4 py-2.5 text-xs font-extrabold text-brand-200 transition-colors hover:bg-brand-400/20 disabled:opacity-60"
                >
                  {modalPositionBusy ? <Loader2 className="size-4 animate-spin" /> : <MapPin className="size-4" />}
                  تعيين المركز
                </button>
                <p className="mt-2 text-[11px] leading-5 text-white/40">
                  يمكن تعيين أي مركز حتى لو لم يكن من مراكز اللاعب المفضلة.
                </p>
              </form>
            ) : null}

            {isAdmin ? (
              <button
                type="button"
                onClick={async () => {
                  const registration = registrations.find((item) => item.player_id === ratingTarget.playerId)
                  if (!registration) return
                  const removed = await handleCancelRegistration(registration)
                  if (removed) setRatingTarget(null)
                }}
                disabled={cancelRegistrationId === registrations.find((item) => item.player_id === ratingTarget.playerId)?.id}
                className="mt-4 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-2xl border border-red-400/25 bg-red-400/[0.06] px-4 py-2.5 text-xs font-extrabold text-red-200 transition-colors hover:bg-red-400/10 disabled:opacity-60"
              >
                {cancelRegistrationId ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
                حذف من التسجيل
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

    </div>
  )
}
