import { Link } from 'react-router-dom'
import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  ArrowLeft,
  CalendarDays,
  Clock,
  Footprints,
  History,
  Lock,
  MapPin,
  Sparkles,
  Trophy,
  Volleyball,
} from 'lucide-react'
import Badge from '../components/ui/Badge'
import Card from '../components/ui/Card'
import EmptyState from '../components/ui/EmptyState'
import { useAuth } from '../context/AuthContext'
import { useMatches } from '../hooks/useMatches'
import { useRegistrationWindow } from '../hooks/useRegistrationWindow'
import { formatRegistrationDateTime } from '../lib/registrationWindow'
import { supabase } from '../lib/supabase'
import { toArabicError } from '../lib/errorMessages'

function LeaderAvatar({ player, size = 44 }) {
  const initial = player?.full_name?.trim()?.charAt(0) || '؟'
  return (
    <span
      className="relative grid shrink-0 place-items-center overflow-hidden rounded-full bg-brand-400/10 font-black text-brand-300"
      style={{ width: size, height: size, fontSize: size * 0.36 }}
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

export default function Dashboard() {
  const { profile } = useAuth()
  const registrationWindow = useRegistrationWindow()
  const registrationOpen = registrationWindow.isOpen
  const { activeMatch, pastMatches } = useMatches()
  const completedMatchIds = useMemo(
    () => pastMatches.filter((match) => match.status === 'completed').map((match) => match.id),
    [pastMatches],
  )
  const activeMatchDate = activeMatch?.local_date
    ? new Intl.DateTimeFormat('ar', {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        timeZone: 'Asia/Jerusalem',
      }).format(new Date(`${activeMatch.local_date}T12:00:00Z`))
    : 'الجمعة · ٦ نوفمبر'

  const allTimeStatsQuery = useQuery({
    queryKey: ['dashboard-all-time-stats'],
    queryFn: async () => {
      try {
        const { data, error } = await supabase
          .from('player_all_time_stats')
          .select('player_id,total_goals,total_assists,matches_with_stats,average_goals,average_assists')
        if (error) throw error
        return data ?? []
      } catch {
        return []
      }
    },
    staleTime: 60_000,
  })

  const gamesPlayedQuery = useQuery({
    queryKey: ['dashboard-games-played', completedMatchIds.join('|')],
    enabled: completedMatchIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('registrations')
        .select('player_id')
        .eq('status', 'confirmed')
        .in('match_id', completedMatchIds)
      if (error) throw error
      return data ?? []
    },
    staleTime: 60_000,
  })

  const gamesPlayedByPlayer = useMemo(() => {
    const counts = new Map()
    for (const row of gamesPlayedQuery.data ?? []) {
      counts.set(row.player_id, (counts.get(row.player_id) ?? 0) + 1)
    }
    return counts
  }, [gamesPlayedQuery.data])

  const allTimePlayerIds = useMemo(
    () => [
      ...new Set([
        ...(allTimeStatsQuery.data ?? []).map((item) => item.player_id),
        ...gamesPlayedByPlayer.keys(),
      ]),
    ],
    [allTimeStatsQuery.data, gamesPlayedByPlayer],
  )

  const allTimePlayersQuery = useQuery({
    queryKey: ['dashboard-all-time-players', allTimePlayerIds.join('|')],
    enabled: allTimePlayerIds.length > 0,
    queryFn: async () => {
      try {
        const { data, error } = await supabase
          .from('player_directory')
          .select('id,full_name,avatar_url,jersey_number')
          .in('id', allTimePlayerIds)
        if (error) throw error
        return data ?? []
      } catch {
        return []
      }
    },
    staleTime: 60_000,
  })

  const leaders = useMemo(() => {
    const directoryById = new Map((allTimePlayersQuery.data ?? []).map((player) => [player.id, player]))
    const statsRows = allTimeStatsQuery.data ?? []
    const statsByPlayer = new Map(statsRows.map((item) => [item.player_id, item]))

    const byGoals = [...statsRows].sort(
      (a, b) => b.total_goals - a.total_goals || b.total_assists - a.total_assists,
    )
    const byAssists = [...statsRows].sort(
      (a, b) => b.total_assists - a.total_assists || b.total_goals - a.total_goals,
    )
    const byGames = [...gamesPlayedByPlayer.entries()]
      .map(([playerId, games]) => ({ playerId, games }))
      .sort((a, b) => b.games - a.games)

    const topScorer = byGoals[0]?.total_goals > 0 ? byGoals[0] : null
    const topAssister = byAssists[0]?.total_assists > 0 ? byAssists[0] : null
    const mostGames = byGames[0]?.games > 0 ? byGames[0] : null

    const topScorers = byGoals.filter((item) => item.total_goals > 0)
    const topAssisters = byAssists.filter((item) => item.total_assists > 0)
    const topByGames = byGames.filter((item) => item.games > 0)

    return { directoryById, statsByPlayer, topScorer, topAssister, mostGames, topScorers, topAssisters, topByGames }
  }, [allTimeStatsQuery.data, allTimePlayersQuery.data, gamesPlayedByPlayer])

  const hasAllTimeStats = Boolean(leaders.topScorer || leaders.topAssister || leaders.mostGames)
  const [leadersTab, setLeadersTab] = useState('goals')

  const activeRanking =
    leadersTab === 'assists'
      ? leaders.topAssisters
      : leadersTab === 'games'
        ? leaders.topByGames
        : leaders.topScorers

  return (
    <div className="space-y-6 lg:space-y-8">
      {/* Next match hero */}
      <section className="relative overflow-hidden rounded-[2rem] border border-white/10 bg-pitch-900/70 p-6 sm:p-8 lg:p-10">
        <div className="bg-turf pointer-events-none absolute inset-0 opacity-70" aria-hidden="true" />
        <div
          className="pointer-events-none absolute inset-0 bg-gradient-to-l from-pitch-950/95 via-pitch-900/50 to-transparent"
          aria-hidden="true"
        />
        {/* Pitch markings */}
        <div className="pointer-events-none absolute inset-y-0 left-0 hidden w-2/5 sm:block" aria-hidden="true">
          <div className="absolute left-6 top-1/2 size-64 -translate-y-1/2 rounded-full border border-white/10" />
          <div className="absolute left-6 top-1/2 size-3 -translate-y-1/2 rounded-full bg-white/15" />
          <div className="absolute inset-y-0 left-6 w-px bg-white/10" />
          <div className="absolute left-6 top-1/2 h-40 w-16 -translate-y-1/2 rounded-e-md border border-white/10" />
        </div>

        <div className="relative max-w-xl">
          <Badge variant="brand">
            <Sparkles className="size-3.5" />
            الموسم الأول
          </Badge>

          <p className="mt-6 text-sm font-semibold text-white/55">
            أهلًا، {profile?.full_name || 'لاعب فرايدي إيليت'}
          </p>
          <p className="mt-1 text-sm font-semibold text-white/45">المباراة القادمة</p>
          <h2 className="mt-2 text-3xl font-black leading-[1.25] tracking-tight text-sand-100 sm:text-4xl">
            الجمعة <span className="text-brand-400">٢٠:٠٠</span>
            <br />
            كرة القدم الأسبوعية
          </h2>

          <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-white/60">
            <span className="inline-flex items-center gap-2">
              <CalendarDays className="size-4 text-brand-400/80" />
              {activeMatchDate}
            </span>
            <span className="inline-flex items-center gap-2">
              <MapPin className="size-4 text-brand-400/80" />
              {activeMatch?.venue ?? 'ملعب وحيد — العشب الصناعي'}
            </span>
          </div>

          <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center">
            {registrationOpen ? (
              <Link
                to={activeMatch ? `/matches/${activeMatch.id}` : '/matches'}
                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-2xl bg-brand-400 px-5 py-3 text-sm font-extrabold text-pitch-950 transition-colors hover:bg-brand-300"
              >
                <Clock className="size-4" />
                التسجيل مفتوح الآن
              </Link>
            ) : (
              <button
                type="button"
                disabled
                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-2xl bg-brand-400 px-5 py-3 text-sm font-extrabold text-pitch-950 opacity-60"
              >
                <Lock className="size-4" />
                التسجيل لم يفتح بعد
              </button>
            )}
            <Link
              to={activeMatch ? `/matches/${activeMatch.id}` : '/matches'}
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-5 py-3 text-sm font-bold text-white/75 transition-colors hover:border-white/20 hover:text-white"
            >
              تفاصيل المباراة
              <ArrowLeft className="size-4" />
            </Link>
          </div>

          <p className="mt-5 inline-flex items-center gap-2 rounded-full border border-white/10 bg-pitch-950/50 px-3 py-1.5 text-[11px] font-semibold text-white/50">
            <Clock className="size-3.5 text-brand-400/80" />
            {registrationOpen && registrationWindow.currentWindow
              ? `التسجيل مفتوح الآن — يغلق ${formatRegistrationDateTime(registrationWindow.currentWindow.closeAt)}`
              : `يفتح التسجيل ${formatRegistrationDateTime(registrationWindow.nextWindow.openAt)}`}
          </p>
        </div>
      </section>

      {/* All-time leaders */}
      {hasAllTimeStats ? (
        <section aria-label="إحصائيات اللاعبين التاريخية">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <h2 className="flex items-center gap-2 text-lg font-extrabold text-sand-100">
                <Trophy className="size-5 text-brand-300" />
                زعماء الإحصائيات
              </h2>
              <p className="mt-1 text-sm text-white/45">أبرز اللاعبين عبر كل المباريات السابقة.</p>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            {leaders.topScorer ? (
              <Card className="border-brand-400/20 p-5">
                <span className="grid size-10 place-items-center rounded-2xl bg-brand-400/10 text-brand-300">
                  <Volleyball className="size-5" />
                </span>
                <p className="mt-3 text-[11px] font-bold text-white/45">الهداف التاريخي</p>
                <div className="mt-1.5 flex items-center gap-2.5">
                  <LeaderAvatar player={leaders.directoryById.get(leaders.topScorer.player_id)} size={40} />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-extrabold text-sand-100">
                      {leaders.directoryById.get(leaders.topScorer.player_id)?.full_name ?? 'لاعب'}
                    </p>
                    <p className="mt-0.5 text-[11px] text-white/45">
                      <span className="font-black text-brand-200">{leaders.topScorer.total_goals}</span> هدف
                      {leaders.topScorer.total_assists ? ` · ${leaders.topScorer.total_assists} تمريرة` : ''}
                    </p>
                  </div>
                </div>
              </Card>
            ) : null}

            {leaders.topAssister ? (
              <Card className="border-brand-400/20 p-5">
                <span className="grid size-10 place-items-center rounded-2xl bg-brand-400/10 text-brand-300">
                  <Footprints className="size-5" />
                </span>
                <p className="mt-3 text-[11px] font-bold text-white/45">صانع الألعاب التاريخي</p>
                <div className="mt-1.5 flex items-center gap-2.5">
                  <LeaderAvatar player={leaders.directoryById.get(leaders.topAssister.player_id)} size={40} />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-extrabold text-sand-100">
                      {leaders.directoryById.get(leaders.topAssister.player_id)?.full_name ?? 'لاعب'}
                    </p>
                    <p className="mt-0.5 text-[11px] text-white/45">
                      <span className="font-black text-brand-200">{leaders.topAssister.total_assists}</span> تمريرة
                      {leaders.topAssister.total_goals ? ` · ${leaders.topAssister.total_goals} هدف` : ''}
                    </p>
                  </div>
                </div>
              </Card>
            ) : null}

            {leaders.mostGames ? (
              <Card className="border-brand-400/20 p-5">
                <span className="grid size-10 place-items-center rounded-2xl bg-brand-400/10 text-brand-300">
                  <History className="size-5" />
                </span>
                <p className="mt-3 text-[11px] font-bold text-white/45">الأكثر مشاركة</p>
                <div className="mt-1.5 flex items-center gap-2.5">
                  <LeaderAvatar player={leaders.directoryById.get(leaders.mostGames.playerId)} size={40} />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-extrabold text-sand-100">
                      {leaders.directoryById.get(leaders.mostGames.playerId)?.full_name ?? 'لاعب'}
                    </p>
                    <p className="mt-0.5 text-[11px] text-white/45">
                      <span className="font-black text-brand-200">{leaders.mostGames.games}</span> مباراة
                    </p>
                  </div>
                </div>
              </Card>
            ) : null}
          </div>

          {activeRanking.length ? (
            <Card className="mt-4 p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h3 className="flex items-center gap-2 text-sm font-extrabold text-sand-100">
                  <Trophy className="size-4 text-brand-300" />
                  {leadersTab === 'assists'
                    ? 'قائمة صناع الألعاب التاريخيين'
                    : leadersTab === 'games'
                      ? 'قائمة الأكثر مشاركة'
                      : 'قائمة الهدافين التاريخيين'}
                </h3>
                <div className="grid grid-cols-3 gap-1 rounded-2xl border border-white/10 bg-pitch-950/50 p-1" role="tablist" aria-label="ترتيب الإحصائيات">
                  {[
                    { key: 'goals', label: 'أهداف', icon: Volleyball },
                    { key: 'assists', label: 'تمريرات', icon: Footprints },
                    { key: 'games', label: 'مباريات', icon: History },
                  ].map(({ key, label, icon: Icon }) => (
                    <button
                      key={key}
                      type="button"
                      role="tab"
                      aria-selected={leadersTab === key}
                      onClick={() => setLeadersTab(key)}
                      className={`inline-flex min-h-10 items-center justify-center gap-1.5 rounded-xl px-3 py-2 text-[11px] font-extrabold transition-colors ${leadersTab === key ? 'bg-brand-400 text-pitch-950' : 'text-white/50 hover:text-white'}`}
                    >
                      <Icon className="size-3.5" />
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="mt-3 max-h-[480px] space-y-2 overflow-y-auto pe-1">
                {activeRanking.map((row, index) => {
                  const playerId = row.player_id ?? row.playerId
                  const stat = leaders.statsByPlayer.get(playerId)
                  const games = row.games ?? gamesPlayedByPlayer.get(playerId) ?? stat?.matches_with_stats ?? 0
                  const player = leaders.directoryById.get(playerId)
                  const goals = stat?.total_goals ?? 0
                  const assists = stat?.total_assists ?? 0
                  return (
                    <div key={playerId} className="flex items-center gap-3 rounded-2xl border border-white/[0.07] bg-white/[0.02] px-3 py-2">
                      <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-white/5 text-xs font-black text-white/55">
                        {index + 1}
                      </span>
                      <LeaderAvatar player={player} size={34} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-xs font-extrabold text-sand-100">{player?.full_name ?? 'لاعب'}</p>
                        <p className="mt-0.5 text-[10px] text-white/40">
                          {leadersTab === 'goals'
                            ? `${goals} هدف · ${games} مباراة`
                            : leadersTab === 'assists'
                              ? `${assists} تمريرة · ${games} مباراة`
                              : `${games} مباراة · ${goals} هدف · ${assists} تمريرة`}
                        </p>
                      </div>
                      <span className="flex shrink-0 items-center gap-1">
                        {leadersTab !== 'assists' && goals ? (
                          <span
                            title={`${goals} هدف`}
                            className={`flex h-5 items-center gap-0.5 rounded-full px-1.5 text-[10px] font-black text-pitch-950 ${leadersTab === 'goals' ? 'bg-white ring-2 ring-brand-400/60' : 'bg-white/85'}`}
                          >
                            <Volleyball className="size-2.5" />
                            {goals}
                          </span>
                        ) : null}
                        {leadersTab !== 'goals' && assists ? (
                          <span
                            title={`${assists} تمريرة`}
                            className={`flex h-5 items-center gap-0.5 rounded-full px-1.5 text-[10px] font-black text-pitch-950 ${leadersTab === 'assists' ? 'bg-brand-300 ring-2 ring-white/40' : 'bg-brand-300/85'}`}
                          >
                            <Footprints className="size-2.5" />
                            {assists}
                          </span>
                        ) : null}
                        <span
                          title={`${games} مباراة`}
                          className={`flex h-5 items-center gap-0.5 rounded-full px-1.5 text-[10px] font-black ${
                            leadersTab === 'games'
                              ? 'bg-brand-400 text-pitch-950 ring-2 ring-white/40'
                              : 'bg-white/10 text-white/60'
                          }`}
                        >
                          <History className="size-2.5" />
                          {games}
                        </span>
                      </span>
                    </div>
                  )
                })}
              </div>
            </Card>
          ) : null}
        </section>
      ) : null}
    </div>
  )
}
