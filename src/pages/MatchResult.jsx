import { Fragment, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ArrowLeft, CalendarDays, Check, Copy, Footprints, MapPin, Star, Trophy, Volleyball } from 'lucide-react'
import PageHeader from '../components/layout/PageHeader'
import Badge from '../components/ui/Badge'
import Card from '../components/ui/Card'
import EmptyState from '../components/ui/EmptyState'
import { supabase } from '../lib/supabase'
import { toArabicError } from '../lib/errorMessages'

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

function ratingColor(rating) {
  const value = Number(rating)
  if (Number.isNaN(value)) return '#9ca3af'
  if (value >= 7.5) return '#22c55e'
  if (value >= 6.5) return '#f59e0b'
  return '#ef4444'
}

export default function MatchResult() {
  const { matchId } = useParams()
  const [copied, setCopied] = useState(false)

  const matchQuery = useQuery({
    queryKey: ['result-page-match', matchId],
    enabled: Boolean(matchId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('matches')
        .select('id,kickoff_at,local_date,venue,status')
        .eq('id', matchId)
        .maybeSingle()
      if (error) throw error
      if (!data) throw new Error('MATCH_NOT_FOUND')
      return data
    },
    staleTime: 15_000,
  })

  const resultQuery = useQuery({
    queryKey: ['result-page-result', matchId],
    enabled: Boolean(matchId),
    queryFn: async () => {
      try {
        const { data, error } = await supabase
          .from('match_results')
          .select('match_id,team_a_score,team_b_score,notes')
          .eq('match_id', matchId)
          .maybeSingle()
        if (error) throw error
        return data ?? null
      } catch {
        return null
      }
    },
    staleTime: 15_000,
    refetchInterval: 30_000,
  })

  const teamsQuery = useQuery({
    queryKey: ['result-page-teams', matchId],
    enabled: Boolean(matchId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('match_teams')
        .select('id,match_id,side,name_ar,color')
        .eq('match_id', matchId)
        .order('side', { ascending: true })
      if (error) {
        console.debug('match_teams unavailable', error)
        return []
      }
      return data ?? []
    },
    staleTime: 15_000,
  })

  const scorersQuery = useQuery({
    queryKey: ['result-page-scorers', matchId],
    enabled: Boolean(matchId),
    queryFn: async () => {
      try {
        const { data, error } = await supabase
          .from('match_scorers')
          .select('id,player_id,team_id,goals,assists')
          .eq('match_id', matchId)
          .order('goals', { ascending: false })
          .order('assists', { ascending: false })
        if (error) throw error
        return data ?? []
      } catch {
        return []
      }
    },
    staleTime: 15_000,
  })

  const ratingStatsQuery = useQuery({
    queryKey: ['result-page-rating-stats', matchId],
    enabled: Boolean(matchId),
    queryFn: async () => {
      try {
        const { data, error } = await supabase
          .from('match_player_rating_stats')
          .select('player_id,average_rating,rating_count')
          .eq('match_id', matchId)
          .order('average_rating', { ascending: false })
          .limit(10)
        if (error) throw error
        return data ?? []
      } catch {
        return []
      }
    },
    staleTime: 15_000,
    refetchInterval: 30_000,
  })

  const notablePlayerIds = [
    ...new Set([
      ...(scorersQuery.data ?? []).map((scorer) => scorer.player_id),
      ...(ratingStatsQuery.data ?? []).map((stat) => stat.player_id),
    ]),
  ]

  const directoryQuery = useQuery({
    queryKey: ['result-page-directory', matchId, notablePlayerIds.join('|')],
    enabled: notablePlayerIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('player_directory')
        .select('id,full_name,avatar_url,jersey_number')
        .in('id', notablePlayerIds)
      if (error) throw error
      return data ?? []
    },
    staleTime: 30_000,
  })

  const match = matchQuery.data
  const result = resultQuery.data ?? null
  const teams = teamsQuery.data ?? []
  const scorers = scorersQuery.data ?? []
  const ratingStats = ratingStatsQuery.data ?? []
  const directoryById = new Map((directoryQuery.data ?? []).map((player) => [player.id, player]))

  function getResultLink() {
    return `${window.location.origin}${window.location.pathname}#/matches/${matchId}/result`
  }

  async function handleCopyLink() {
    const link = getResultLink()
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
    setCopied(true)
    window.setTimeout(() => setCopied(false), 2500)
  }

  if (matchQuery.isLoading) {
    return (
      <div>
        <PageHeader eyebrow="نتيجة المباراة" title="جارٍ التحميل…" />
        <EmptyState icon={Trophy} title="جارٍ تحميل النتيجة" description="نجهّز لوحة النتيجة والهدافين والتقييمات." />
      </div>
    )
  }

  if (matchQuery.error || !match) {
    return (
      <div>
        <PageHeader eyebrow="نتيجة المباراة" title="تعذر تحميل النتيجة" />
        <EmptyState
          icon={Trophy}
          title="النتيجة غير متاحة"
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
        eyebrow="نتيجة المباراة"
        title={formatDate(match.local_date)}
        description="النتيجة النهائية وهدافو المباراة وتقييمات اللاعبين."
        actions={
          <Link to={`/matches/${matchId}`} className="inline-flex min-h-11 items-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-4 py-2.5 text-xs font-bold text-white/75 transition-colors hover:text-white">
            <ArrowLeft className="size-4" />
            صفحة المباراة
          </Link>
        }
      />

      {result ? (
        <>
          <section className="relative overflow-hidden rounded-[2rem] border border-white/15 bg-pitch-950/80 p-5 shadow-glow sm:p-8" aria-label="النتيجة النهائية">
            <div className="pointer-events-none absolute inset-0" aria-hidden="true">
              <div
                className="absolute inset-y-0 start-0 w-1/2"
                style={{ background: `linear-gradient(120deg, ${teams.find((team) => team.side === 'A')?.color ?? '#d2ff4d'}38, transparent 70%)` }}
              />
              <div
                className="absolute inset-y-0 end-0 w-1/2"
                style={{ background: `linear-gradient(-120deg, ${teams.find((team) => team.side === 'B')?.color ?? '#f5f3ea'}38, transparent 70%)` }}
              />
            </div>

            <div className="relative">
              <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-sm text-white/60">
                <span className="inline-flex items-center gap-2">
                  <CalendarDays className="size-4 text-brand-400/80" />
                  {formatDate(match.local_date)}
                </span>
                <span className="inline-flex items-center gap-2">
                  <MapPin className="size-4 text-brand-400/80" />
                  {match.venue}
                </span>
              </div>

              <div className="mx-auto mt-6 grid max-w-xl grid-cols-[1fr_auto_1fr] items-center gap-2 sm:gap-6">
                {['A', 'B'].map((side) => {
                  const team = teams.find((item) => item.side === side)
                  const score = side === 'A' ? result.team_a_score : result.team_b_score
                  const otherScore = side === 'A' ? result.team_b_score : result.team_a_score
                  const isWinner = score > otherScore
                  return (
                    <Fragment key={side}>
                      <div className={`min-w-0 ${side === 'A' ? 'text-end' : 'text-start'}`}>
                        <div className={`flex items-center gap-2 ${side === 'A' ? 'flex-row-reverse' : ''}`}>
                          <span className="size-4 shrink-0 rounded-full border border-white/25" style={{ backgroundColor: team?.color ?? '#d2ff4d' }} aria-hidden="true" />
                          <p className="truncate text-sm font-black text-sand-100 sm:text-lg">
                            {team?.name_ar ?? (side === 'A' ? 'الفريق أ' : 'الفريق ب')}
                          </p>
                        </div>
                        <p
                          className="mt-1 text-7xl font-black tabular-nums sm:text-8xl"
                          style={isWinner ? { color: team?.color ?? '#d2ff4d' } : undefined}
                        >
                          {score}
                        </p>
                      </div>
                      {side === 'A' ? (
                        <div className="min-w-20 px-1 text-center">
                          {(() => {
                            const winnerTeam =
                              result.team_a_score > result.team_b_score
                                ? teams.find((item) => item.side === 'A')
                                : result.team_b_score > result.team_a_score
                                  ? teams.find((item) => item.side === 'B')
                                  : null
                            return winnerTeam ? (
                              <p
                                className="inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-xs font-black text-pitch-950"
                                style={{ backgroundColor: winnerTeam.color ?? '#d2ff4d' }}
                              >
                                <Trophy className="size-4" />
                                {winnerTeam.name_ar} الفائز
                              </p>
                            ) : (
                              <p className="inline-flex items-center rounded-full border border-white/15 bg-white/10 px-4 py-2 text-xs font-black text-white/70">
                                تعادل
                              </p>
                            )
                          })()}
                        </div>
                      ) : null}
                    </Fragment>
                  )
                })}
              </div>

              {scorers.length ? (
                <div className="mx-auto mt-7 grid max-w-2xl gap-4 sm:grid-cols-2">
                  {['A', 'B'].map((side) => {
                    const team = teams.find((item) => item.side === side)
                    const teamScorers = scorers.filter((scorer) => scorer.team_id === team?.id)
                    if (!teamScorers.length) return null
                    return (
                      <div key={side} className="min-w-0 rounded-2xl border border-white/10 bg-white/[0.03] p-3">
                        <p className="mb-2 flex items-center gap-1.5 text-[11px] font-extrabold text-white/50">
                          <span className="size-2.5 rounded-full" style={{ backgroundColor: team?.color ?? '#d2ff4d' }} aria-hidden="true" />
                          {team?.name_ar ?? (side === 'A' ? 'الفريق أ' : 'الفريق ب')}
                        </p>
                        <div className="space-y-1.5">
                          {teamScorers.map((scorer) => {
                            const player = directoryById.get(scorer.player_id)
                            return (
                              <div key={scorer.id} className="flex items-center justify-between gap-2 rounded-xl bg-white/[0.04] px-3 py-2">
                                <span className="min-w-0 truncate text-xs font-bold text-sand-100">{player?.full_name ?? 'لاعب'}</span>
                                <span className="flex shrink-0 items-center gap-1">
                                  {scorer.goals ? (
                                    <span title={`${scorer.goals} هدف`} className="flex h-5 items-center gap-0.5 rounded-full bg-white px-1.5 text-[10px] font-black text-pitch-950">
                                      <Volleyball className="size-2.5" />
                                      {scorer.goals}
                                    </span>
                                  ) : null}
                                  {scorer.assists ? (
                                    <span title={`${scorer.assists} تمريرة`} className="flex h-5 items-center gap-0.5 rounded-full bg-brand-300 px-1.5 text-[10px] font-black text-pitch-950">
                                      <Footprints className="size-2.5" />
                                      {scorer.assists}
                                    </span>
                                  ) : null}
                                </span>
                              </div>
                            )
                          })}
                        </div>
                      </div>
                    )
                  })}
                </div>
              ) : null}

              {result.notes ? (
                <p className="mx-auto mt-5 max-w-xl rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-center text-sm leading-7 text-white/55">
                  {result.notes}
                </p>
              ) : null}

              <div className="mt-7 flex flex-col items-center justify-center gap-3 sm:flex-row">
                <Link
                  to={`/matches/${matchId}?rate=1`}
                  className="inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl bg-brand-400 px-7 py-3.5 text-base font-extrabold text-pitch-950 shadow-glow transition-colors hover:bg-brand-300"
                >
                  <Star className="size-5" />
                  قيّم لاعبي المباراة
                </Link>
                <button
                  type="button"
                  onClick={() => void handleCopyLink()}
                  className="inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl border border-white/15 bg-white/10 px-5 py-3.5 text-sm font-bold text-white/80 transition-colors hover:text-white"
                >
                  {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
                  {copied ? 'تم نسخ الرابط' : 'نسخ رابط النتيجة'}
                </button>
              </div>
              <p className="mt-3 text-center text-[11px] leading-5 text-white/40">
                شارك الرابط مع الفريق — سيفتح صفحة النتيجة مع زر التقييم. التقييم للمشاركين في المباراة فقط.
              </p>
            </div>
          </section>

          {ratingStats.length ? (
            <section className="mt-8" aria-label="أعلى التقييمات">
              <div className="mb-4 flex items-start justify-between gap-3">
                <div>
                  <h2 className="flex items-center gap-2 text-lg font-extrabold text-sand-100">
                    <Star className="size-5 text-brand-300" />
                    أعلى التقييمات
                  </h2>
                  <p className="mt-1 text-sm text-white/45">متوسط تقييم اللاعبين من 10 بعدد تقييماتهم.</p>
                </div>
                <Badge variant="brand">{ratingStats.length} لاعب مقيّم</Badge>
              </div>

              <div className="space-y-2.5">
                {ratingStats.map((stat, index) => {
                  const player = directoryById.get(stat.player_id)
                  return (
                    <Card key={stat.player_id} className="flex items-center gap-3 p-4">
                      <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-brand-400/10 text-sm font-black text-brand-300">
                        {index + 1}
                      </span>
                      <span className="relative grid size-11 shrink-0 place-items-center overflow-hidden rounded-full bg-brand-400/10 text-sm font-black text-brand-300">
                        {player?.full_name?.trim()?.charAt(0) || '؟'}
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
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-extrabold text-sand-100">{player?.full_name ?? 'لاعب'}</p>
                        <p className="mt-0.5 text-[11px] text-white/45">{stat.rating_count} تقييم</p>
                      </div>
                      <span
                        className="shrink-0 rounded-full px-3 py-1.5 text-sm font-black text-white"
                        style={{ backgroundColor: ratingColor(stat.average_rating) }}
                      >
                        {Number(stat.average_rating).toFixed(1)}
                      </span>
                    </Card>
                  )
                })}
              </div>
            </section>
          ) : null}
        </>
      ) : (
        <EmptyState
          icon={Trophy}
          title="لم تُنشر النتيجة بعد"
          description="ستظهر هنا النتيجة النهائية والهدافون وأعلى التقييمات بعد إدخال الإدارة لها."
          action={
            <Link to={`/matches/${matchId}`} className="inline-flex min-h-11 items-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-4 py-2.5 text-xs font-bold text-white/75">
              <ArrowLeft className="size-4" />
              صفحة المباراة
            </Link>
          }
        />
      )}
    </div>
  )
}
