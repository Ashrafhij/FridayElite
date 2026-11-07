import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import {
  ArrowLeft,
  CalendarDays,
  Clock,
  Footprints,
  History,
  Loader2,
  Lock,
  MapPin,
  RotateCcw,
  Star,
  Trophy,
  UserMinus,
  UserPlus,
  Volleyball,
} from 'lucide-react'
import PageHeader from '../components/layout/PageHeader'
import Badge from '../components/ui/Badge'
import Card from '../components/ui/Card'
import EmptyState from '../components/ui/EmptyState'
import { useMatches } from '../hooks/useMatches'
import { supabase } from '../lib/supabase'
import { toArabicError } from '../lib/errorMessages'

const STATUS_LABELS = {
  scheduled: 'مقررة',
  registration_open: 'التسجيل مفتوح',
  registration_closed: 'أُغلق التسجيل',
  teams_published: 'تم توزيع الفرق',
  completed: 'اكتملت',
  cancelled: 'أُلغيت',
  draft: 'مسودة',
}

function formatMatchDateTime(value) {
  if (!value) return '—'
  return new Intl.DateTimeFormat('ar', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'Asia/Jerusalem',
  }).format(new Date(value))
}

function formatMatchDate(value) {
  if (!value) return '—'
  return new Intl.DateTimeFormat('ar', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'Asia/Jerusalem',
  }).format(new Date(value))
}

export default function Matches() {
  const {
    activeMatch,
    pastMatches,
    statsByMatchId,
    myRegistration,
    isLoading,
    error,
    refetch,
    actionBusy,
    actionError,
    actionSuccess,
    registerForActiveMatch,
    cancelMyRegistration,
  } = useMatches()

  const activeStats = activeMatch ? statsByMatchId.get(activeMatch.id) : undefined
  const activeRegistrationOpen = Boolean(
    activeMatch &&
      new Date(activeMatch.registration_open_at) <= new Date() &&
      new Date() < new Date(activeMatch.registration_close_at),
  )

  const resultMatchIds = pastMatches.map((match) => match.id)

  const pastResultsQuery = useQuery({
    queryKey: ['past-match-results', resultMatchIds.join('|')],
    enabled: resultMatchIds.length > 0,
    queryFn: async () => {
      try {
        const { data, error } = await supabase
          .from('match_results')
          .select('match_id,team_a_score,team_b_score')
          .in('match_id', resultMatchIds)
        if (error) throw error
        return data ?? []
      } catch {
        return []
      }
    },
    staleTime: 30_000,
  })

  const pastTeamsQuery = useQuery({
    queryKey: ['past-match-teams', resultMatchIds.join('|')],
    enabled: resultMatchIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('match_teams')
        .select('id,match_id,side,name_ar,color')
        .in('match_id', resultMatchIds)
      if (error) {
        console.debug('match_teams unavailable', error)
        return []
      }
      return data ?? []
    },
    staleTime: 30_000,
  })

  const pastScorersQuery = useQuery({
    queryKey: ['past-match-scorers', resultMatchIds.join('|')],
    enabled: resultMatchIds.length > 0,
    queryFn: async () => {
      try {
        const { data, error } = await supabase
          .from('match_scorers')
          .select('id,match_id,player_id,team_id,goals,assists')
          .in('match_id', resultMatchIds)
          .order('goals', { ascending: false })
        if (error) throw error
        return data ?? []
      } catch {
        return []
      }
    },
    staleTime: 30_000,
  })

  const pastRatingStatsQuery = useQuery({
    queryKey: ['past-match-rating-stats', resultMatchIds.join('|')],
    enabled: resultMatchIds.length > 0,
    queryFn: async () => {
      try {
        const { data, error } = await supabase
          .from('match_player_rating_stats')
          .select('match_id,player_id,average_rating,rating_count')
          .in('match_id', resultMatchIds)
        if (error) throw error
        return data ?? []
      } catch {
        return []
      }
    },
    staleTime: 30_000,
  })

  const scorerPlayerIds = [
    ...new Set([
      ...(pastScorersQuery.data ?? []).map((scorer) => scorer.player_id),
      ...(pastRatingStatsQuery.data ?? []).map((stat) => stat.player_id),
    ]),
  ]
  const scorerNamesQuery = useQuery({
    queryKey: ['past-scorer-names', scorerPlayerIds.join('|')],
    enabled: scorerPlayerIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('player_directory')
        .select('id,full_name')
        .in('id', scorerPlayerIds)
      if (error) throw error
      return data ?? []
    },
    staleTime: 60_000,
  })

  const resultByMatchId = new Map((pastResultsQuery.data ?? []).map((item) => [item.match_id, item]))
  const teamsByMatchId = new Map()
  for (const team of pastTeamsQuery.data ?? []) {
    if (!teamsByMatchId.has(team.match_id)) teamsByMatchId.set(team.match_id, [])
    teamsByMatchId.get(team.match_id).push(team)
  }
  const scorersByMatchId = new Map()
  for (const scorer of pastScorersQuery.data ?? []) {
    if (!scorersByMatchId.has(scorer.match_id)) scorersByMatchId.set(scorer.match_id, [])
    scorersByMatchId.get(scorer.match_id).push(scorer)
  }
  const scorerNameById = new Map((scorerNamesQuery.data ?? []).map((player) => [player.id, player.full_name]))

  const mvpByMatchId = new Map()
  for (const stat of pastRatingStatsQuery.data ?? []) {
    const best = mvpByMatchId.get(stat.match_id)
    if (
      !best ||
      Number(stat.average_rating) > Number(best.average_rating) ||
      (Number(stat.average_rating) === Number(best.average_rating) &&
        stat.rating_count > best.rating_count)
    ) {
      mvpByMatchId.set(stat.match_id, stat)
    }
  }

  return (
    <div>
      <PageHeader
        eyebrow="الموسم الأول"
        title="المباريات"
        description="جدول المباريات الأسبوعية وحالة التسجيل في كل موعد."
      />

      <div className="space-y-6">
          {isLoading ? (
            <EmptyState
              icon={Loader2}
              title="جارٍ تحميل المباريات…"
              description="نجهّز المباراة الأسبوعية الحالية وإحصائيات الأسابيع السابقة."
            />
          ) : error ? (
            <EmptyState
              icon={Lock}
              title="تعذر تحميل جدول المباريات"
              description={toArabicError(error, 'تحقق من اتصالك وحاول مرة أخرى.')}
              action={
                <button
                  type="button"
                  onClick={() => void refetch()}
                  className="inline-flex min-h-11 items-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-4 py-2.5 text-xs font-bold text-white/70 transition-colors hover:text-white"
                >
                  <RotateCcw className="size-4" />
                  إعادة المحاولة
                </button>
              }
            />
          ) : activeMatch ? (
            <Card className="overflow-hidden p-6">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-bold text-brand-300">المباراة الحالية / القادمة</p>
                  <h2 className="mt-2 text-xl font-extrabold text-sand-100">
                    {formatMatchDate(activeMatch.local_date)}
                  </h2>
                  <p className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-white/55">
                    <span className="inline-flex items-center gap-1.5">
                      <Clock className="size-4 text-brand-400/80" />
                      {formatMatchDateTime(activeMatch.kickoff_at)}
                    </span>
                    <span className="inline-flex items-center gap-1.5">
                      <MapPin className="size-4 text-brand-400/80" />
                      {activeMatch.venue}
                    </span>
                  </p>
                </div>
                <Badge variant={activeRegistrationOpen ? 'brand' : 'warning'}>
                  {STATUS_LABELS[activeMatch.status] ?? activeMatch.status}
                </Badge>
              </div>

              <div className="mt-5 grid grid-cols-3 gap-3">
                <div className="rounded-2xl bg-white/[0.03] p-3 text-center">
                  <p className="text-lg font-extrabold tabular-nums text-sand-100">{activeStats?.confirmed_count ?? 0}</p>
                  <p className="mt-0.5 text-[11px] text-white/45">مؤكدون</p>
                </div>
                <div className="rounded-2xl bg-white/[0.03] p-3 text-center">
                  <p className="text-lg font-extrabold tabular-nums text-sand-100">{activeStats?.waitlisted_count ?? 0}</p>
                  <p className="mt-0.5 text-[11px] text-white/45">انتظار</p>
                </div>
                <div className="rounded-2xl bg-white/[0.03] p-3 text-center">
                  <p className="text-lg font-extrabold tabular-nums text-sand-100">{activeMatch.capacity}</p>
                  <p className="mt-0.5 text-[11px] text-white/45">السعة</p>
                </div>
              </div>

              <div className="mt-5 flex flex-col gap-3 rounded-2xl border border-white/10 bg-white/[0.025] p-4">
                <p className="text-xs leading-6 text-white/50">
                  التسجيل يفتح {formatMatchDateTime(activeMatch.registration_open_at)} ويغلق {formatMatchDateTime(activeMatch.registration_close_at)}.
                </p>

                {actionError ? (
                  <p role="alert" className="rounded-xl border border-red-400/20 bg-red-400/[0.06] px-3 py-2 text-xs font-bold leading-6 text-red-200">
                    {actionError}
                  </p>
                ) : null}
                {actionSuccess ? (
                  <p role="status" className="rounded-xl border border-brand-400/20 bg-brand-400/[0.06] px-3 py-2 text-xs font-bold leading-6 text-brand-200">
                    {actionSuccess}
                  </p>
                ) : null}

                {myRegistration ? (
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <Badge variant={myRegistration.status === 'confirmed' ? 'brand' : 'warning'}>
                        {myRegistration.status === 'confirmed' ? 'مقعد مؤكد' : 'قائمة الانتظار'}
                      </Badge>
                      {myRegistration.status === 'waitlisted' ? (
                        <p className="mt-2 text-[11px] text-white/45">ترتيبك في الانتظار: {myRegistration.queue_position}</p>
                      ) : null}
                    </div>
                    <button
                      type="button"
                      onClick={() => void cancelMyRegistration()}
                      disabled={actionBusy || !activeRegistrationOpen}
                      className="inline-flex min-h-11 items-center justify-center gap-2 rounded-2xl border border-red-400/25 bg-red-400/[0.06] px-4 py-2.5 text-xs font-bold text-red-200 transition-colors hover:bg-red-400/10 disabled:opacity-60"
                    >
                      <UserMinus className="size-4" />
                      إلغاء التسجيل
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => void registerForActiveMatch()}
                    disabled={actionBusy || !activeRegistrationOpen}
                    className="inline-flex min-h-11 items-center justify-center gap-2 rounded-2xl bg-brand-400 px-4 py-3 text-sm font-extrabold text-pitch-950 transition-colors hover:bg-brand-300 disabled:opacity-60"
                  >
                    {actionBusy ? <Loader2 className="size-4 animate-spin" /> : activeRegistrationOpen ? <UserPlus className="size-4" /> : <Lock className="size-4" />}
                    {activeRegistrationOpen ? 'التسجيل في المباراة' : 'التسجيل مغلق الآن'}
                  </button>
                )}
                <Link
                  to={`/matches/${activeMatch.id}`}
                  className="inline-flex min-h-11 items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-bold text-white/75 transition-colors hover:border-white/20 hover:text-white"
                >
                  فتح تفاصيل المباراة
                  <ArrowLeft className="size-4" />
                </Link>
              </div>
            </Card>
          ) : (
            <EmptyState
              icon={CalendarDays}
              title="لا توجد مباريات منشورة بعد"
              description="تُنشأ المباراة الأسبوعية تلقائيًا كل خميس ١٠:٠٠ صباحًا، ويُغلق التسجيل الجمعة ٢٠:٠٠ مساءً. ستظهر هنا أول مباراة وأرشيف الأسابيع السابقة."
            />
          )}
      </div>

      <section className="mt-8" aria-label="إحصائيات الأسابيع السابقة">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-extrabold text-sand-100">إحصائيات الأسابيع السابقة</h2>
            <p className="mt-1 text-sm text-white/45">تبقى نتائج كل أسبوع محفوظة وقابلة للرجوع إليها.</p>
          </div>
          <span className="grid size-10 shrink-0 place-items-center rounded-2xl bg-brand-400/10 text-brand-300">
            <History className="size-5" />
          </span>
        </div>

        {pastMatches.length ? (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {pastMatches.map((match) => {
              const stats = statsByMatchId.get(match.id)
              const result = resultByMatchId.get(match.id)
              const matchTeams = teamsByMatchId.get(match.id) ?? []
              const matchScorers = scorersByMatchId.get(match.id) ?? []
              const teamA = matchTeams.find((team) => team.side === 'A')
              const teamB = matchTeams.find((team) => team.side === 'B')

              return (
                <Link
                  key={match.id}
                  to={result ? `/matches/${match.id}/result` : `/matches/${match.id}`}
                  className={`block overflow-hidden rounded-[2rem] transition-transform hover:-translate-y-0.5 ${result ? 'hover:ring-2 hover:ring-brand-400/40' : 'hover:ring-2 hover:ring-white/15'}`}
                  aria-label={`${result ? 'فتح النتيجة والتقييمات' : 'فتح تفاصيل المباراة'} — ${formatMatchDate(match.local_date)}`}
                >
                <Card className="h-full p-0">
                  <div className="p-5 pb-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <h3 className="truncate text-sm font-extrabold text-sand-100">{formatMatchDate(match.local_date)}</h3>
                        <p className="mt-1 flex items-center gap-1.5 text-[11px] text-white/45">
                          <MapPin className="size-3.5 shrink-0" />
                          <span className="truncate">{match.venue}</span>
                        </p>
                      </div>
                      <Badge variant={match.status === 'completed' ? 'brand' : match.status === 'cancelled' ? 'warning' : 'neutral'}>
                        {STATUS_LABELS[match.status] ?? match.status}
                      </Badge>
                    </div>

                    {result ? (
                      <>
                        <div className="relative mt-4 overflow-hidden rounded-3xl border border-white/10 bg-pitch-950/60 px-4 py-4">
                          <div className="pointer-events-none absolute inset-0" aria-hidden="true">
                            <div
                              className="absolute inset-y-0 start-0 w-1/2"
                              style={{ background: `linear-gradient(120deg, ${teamA?.color ?? '#d2ff4d'}2e, transparent 70%)` }}
                            />
                            <div
                              className="absolute inset-y-0 end-0 w-1/2"
                              style={{ background: `linear-gradient(-120deg, ${teamB?.color ?? '#f5f3ea'}2e, transparent 70%)` }}
                            />
                          </div>
                          <div className="relative">
                            <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
                              <div className="min-w-0 text-end">
                                <div className="flex items-center justify-end gap-1.5">
                                  <p className="truncate text-[11px] font-black text-sand-100">
                                    {teamA?.name_ar ?? 'الفريق أ'}
                                  </p>
                                  <span className="size-2.5 shrink-0 rounded-full border border-white/25" style={{ backgroundColor: teamA?.color ?? '#d2ff4d' }} aria-hidden="true" />
                                </div>
                                <p
                                  className="mt-0.5 text-4xl font-black tabular-nums"
                                  style={result.team_a_score > result.team_b_score ? { color: teamA?.color ?? '#d2ff4d' } : undefined}
                                >
                                  {result.team_a_score}
                                </p>
                              </div>
                              <div className="min-w-20 px-1 text-center">
                                {(() => {
                                  const winnerTeam =
                                    result.team_a_score > result.team_b_score
                                      ? teamA
                                      : result.team_a_score < result.team_b_score
                                        ? teamB
                                        : null
                                  return winnerTeam ? (
                                    <p
                                      className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[10px] font-black text-pitch-950"
                                      style={{ backgroundColor: winnerTeam.color ?? '#d2ff4d' }}
                                    >
                                      <Trophy className="size-3" />
                                      الفائز
                                    </p>
                                  ) : (
                                    <p className="inline-flex items-center rounded-full border border-white/15 bg-white/10 px-2.5 py-1 text-[10px] font-black text-white/65">
                                      تعادل
                                    </p>
                                  )
                                })()}
                              </div>
                              <div className="min-w-0 text-start">
                                <div className="flex items-center gap-1.5">
                                  <span className="size-2.5 shrink-0 rounded-full border border-white/25" style={{ backgroundColor: teamB?.color ?? '#f5f3ea' }} aria-hidden="true" />
                                  <p className="truncate text-[11px] font-black text-sand-100">
                                    {teamB?.name_ar ?? 'الفريق ب'}
                                  </p>
                                </div>
                                <p
                                  className="mt-0.5 text-4xl font-black tabular-nums"
                                  style={result.team_b_score > result.team_a_score ? { color: teamB?.color ?? '#f5f3ea' } : undefined}
                                >
                                  {result.team_b_score}
                                </p>
                              </div>
                            </div>

                            {matchScorers.length ? (
                              <div className="mt-4 grid gap-2 sm:grid-cols-2">
                                {[teamA, teamB].map((team, index) => {
                                  const teamScorers = matchScorers.filter((scorer) => scorer.team_id === team?.id)
                                  if (!teamScorers.length) return null
                                  return (
                                    <div key={team?.id ?? index} className="min-w-0">
                                      <p className="mb-1.5 flex items-center gap-1.5 text-[10px] font-extrabold text-white/45">
                                        <span className="size-2 rounded-full" style={{ backgroundColor: team?.color ?? '#d2ff4d' }} aria-hidden="true" />
                                        {team?.name_ar ?? (index === 0 ? 'الفريق أ' : 'الفريق ب')}
                                      </p>
                                      <div className="space-y-1">
                                        {teamScorers.map((scorer) => (
                                          <div key={scorer.id} className="flex items-center justify-between gap-2 rounded-lg bg-white/[0.04] px-2 py-1">
                                            <span className="min-w-0 truncate text-[11px] font-bold text-sand-100">
                                              {scorerNameById.get(scorer.player_id) ?? 'لاعب'}
                                            </span>
                                            <span className="flex shrink-0 items-center gap-1">
                                              {scorer.goals ? (
                                                <span title={`${scorer.goals} هدف`} className="flex h-4.5 items-center gap-0.5 rounded-full bg-white px-1.5 text-[9px] font-black text-pitch-950">
                                                  <Volleyball className="size-2" />
                                                  {scorer.goals}
                                                </span>
                                              ) : null}
                                              {scorer.assists ? (
                                                <span title={`${scorer.assists} تمريرة`} className="flex h-4.5 items-center gap-0.5 rounded-full bg-brand-300 px-1.5 text-[9px] font-black text-pitch-950">
                                                  <Footprints className="size-2" />
                                                  {scorer.assists}
                                                </span>
                                              ) : null}
                                            </span>
                                          </div>
                                        ))}
                                      </div>
                                    </div>
                                  )
                                })}
                              </div>
                            ) : null}
                          </div>
                        </div>

                        <div className="mt-3 flex items-center justify-center gap-4 text-[10px] text-white/40">
                          <span>
                            مؤكدون <span className="font-black text-white/65">{stats?.confirmed_count ?? 0}</span>
                          </span>
                          <span>
                            انتظار <span className="font-black text-white/65">{stats?.waitlisted_count ?? 0}</span>
                          </span>
                          {mvpByMatchId.has(match.id) ? (
                            <span className="inline-flex items-center gap-1 text-brand-200">
                              <Star className="size-3" />
                              نجم المباراة: <span className="font-black">{scorerNameById.get(mvpByMatchId.get(match.id).player_id) ?? 'لاعب'}</span>
                            </span>
                          ) : null}
                        </div>
                      </>
                    ) : (
                      <div className="mt-4 grid grid-cols-4 gap-2 text-center">
                        <div className="rounded-xl bg-white/[0.03] p-2.5">
                          <p className="text-base font-extrabold tabular-nums text-sand-100">{stats?.confirmed_count ?? 0}</p>
                          <p className="mt-0.5 text-[10px] text-white/40">مؤكدون</p>
                        </div>
                        <div className="rounded-xl bg-white/[0.03] p-2.5">
                          <p className="text-base font-extrabold tabular-nums text-sand-100">{stats?.waitlisted_count ?? 0}</p>
                          <p className="mt-0.5 text-[10px] text-white/40">انتظار</p>
                        </div>
                        <div className="rounded-xl bg-white/[0.03] p-2.5">
                          <p className="text-base font-extrabold tabular-nums text-sand-100">{stats?.team_a_count ?? 0}</p>
                          <p className="mt-0.5 text-[10px] text-white/40">فريق أ</p>
                        </div>
                        <div className="rounded-xl bg-white/[0.03] p-2.5">
                          <p className="text-base font-extrabold tabular-nums text-sand-100">{stats?.team_b_count ?? 0}</p>
                          <p className="mt-0.5 text-[10px] text-white/40">فريق ب</p>
                        </div>
                      </div>
                    )}
                  </div>

                  <p className="flex items-center justify-center gap-1.5 border-t border-white/[0.07] px-5 py-3 text-center text-xs font-bold text-brand-300">
                    {result ? (
                      <>
                        <Trophy className="size-3.5" />
                        النتيجة والتقييمات
                      </>
                    ) : (
                      <>
                        فتح تفاصيل المباراة
                        <ArrowLeft className="size-3.5" />
                      </>
                    )}
                  </p>
                </Card>
                </Link>
              )
            })}
          </div>
        ) : (
          <EmptyState
            icon={History}
            title="لا توجد أسابيع سابقة بعد"
            description="عند اكتمال أول مباراة، ستظهر إحصائياتها هنا وتبقى محفوظة لأي أسبوع لاحق."
          />
        )}
      </section>
    </div>
  )
}
