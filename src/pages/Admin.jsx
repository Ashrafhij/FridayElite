import { useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  AlertCircle,
  Ban,
  CalendarDays,
  CheckCircle2,
  Clock3,
  Loader2,
  Phone,
  Plus,
  RefreshCw,
  ShieldCheck,
  UserCheck,
  X,
  XCircle,
} from 'lucide-react'
import PageHeader from '../components/layout/PageHeader'
import Badge from '../components/ui/Badge'
import Card from '../components/ui/Card'
import EmptyState from '../components/ui/EmptyState'
import StatTile from '../components/ui/StatTile'
import { supabase } from '../lib/supabase'
import { toArabicError } from '../lib/errorMessages'

const STATUS_META = {
  pending: { label: 'بانتظار الموافقة', variant: 'warning', icon: Clock3 },
  approved: { label: 'موافق عليه', variant: 'brand', icon: CheckCircle2 },
  rejected: { label: 'مرفوض', variant: 'neutral', icon: XCircle },
  suspended: { label: 'موقوف', variant: 'neutral', icon: Ban },
}

const inputClass =
  'mt-2 w-full rounded-2xl border border-white/10 bg-pitch-950/60 px-4 py-3 text-sm font-semibold text-sand-100 outline-none transition-colors placeholder:text-white/25 focus:border-brand-400/50'

function StatusBadge({ status }) {
  const meta = STATUS_META[status] ?? STATUS_META.pending
  const Icon = meta.icon

  return (
    <Badge variant={meta.variant}>
      <Icon className="size-3.5" />
      {meta.label}
    </Badge>
  )
}

function formatDate(value) {
  if (!value) return '—'
  return new Intl.DateTimeFormat('ar', { dateStyle: 'medium' }).format(new Date(value))
}

function pad(value) {
  return String(value).padStart(2, '0')
}

function toLocalInputValue(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function defaultRegistrationOpen(kickoffValue) {
  if (!kickoffValue) return ''
  const kickoff = new Date(kickoffValue)
  if (Number.isNaN(kickoff.getTime())) return ''
  kickoff.setDate(kickoff.getDate() - 1)
  kickoff.setHours(10, 0, 0, 0)
  return toLocalInputValue(kickoff)
}

export default function Admin() {
  const [busyKey, setBusyKey] = useState('')
  const [actionError, setActionError] = useState('')
  const [successMessage, setSuccessMessage] = useState('')
  const [rejectTarget, setRejectTarget] = useState(null)
  const [rejectReason, setRejectReason] = useState('')
  const [creatingMatch, setCreatingMatch] = useState(false)
  const [matchError, setMatchError] = useState('')
  const [matchSuccess, setMatchSuccess] = useState('')
  const [kickoffAt, setKickoffAt] = useState('')
  const [registrationOpenAt, setRegistrationOpenAt] = useState('')
  const [registrationCloseAt, setRegistrationCloseAt] = useState('')
  const [venue, setVenue] = useState('')
  const [address, setAddress] = useState('')
  const [notes, setNotes] = useState('')
  const queryClient = useQueryClient()

  const {
    data: profiles = [],
    isLoading,
    error,
    refetch,
    isFetching,
  } = useQuery({
    queryKey: ['admin-profiles'],
    queryFn: async () => {
      const { data, error: queryError } = await supabase
        .from('profiles')
        .select(
          'id, full_name, phone, role, status, rejection_reason, created_at, approved_at, jersey_number, avatar_url'
        )
        .order('created_at', { ascending: false })

      if (queryError) throw queryError
      return data ?? []
    },
  })

  const players = useMemo(() => profiles.filter((item) => item.role !== 'admin'), [profiles])
  const pendingPlayers = useMemo(
    () => players.filter((item) => item.status === 'pending'),
    [players]
  )
  const otherPlayers = useMemo(
    () => players.filter((item) => item.status !== 'pending'),
    [players]
  )

  const approvedCount = players.filter((item) => item.status === 'approved').length
  const suspendedCount = players.filter((item) => item.status === 'suspended').length
  const rejectedCount = players.filter((item) => item.status === 'rejected').length

  async function runRpc(action, target, reason = null) {
    setActionError('')
    setSuccessMessage('')
    setBusyKey(`${action}:${target.id}`)

    try {
      let rpcError = null

      if (action === 'approve') {
        const { error: errorResult } = await supabase.rpc('approve_player', {
          p_player_id: target.id,
        })
        rpcError = errorResult
      } else if (action === 'reject') {
        const { error: errorResult } = await supabase.rpc('reject_player', {
          p_player_id: target.id,
          p_reason: reason,
        })
        rpcError = errorResult
      } else if (action === 'suspend') {
        const { error: errorResult } = await supabase.rpc('suspend_player', {
          p_player_id: target.id,
          p_reason: reason,
        })
        rpcError = errorResult
      }

      if (rpcError) throw rpcError

      await refetch()
      setSuccessMessage(
        action === 'approve'
          ? `تمت الموافقة على حساب ${target.full_name}.`
          : action === 'reject'
            ? `تم رفض حساب ${target.full_name}.`
            : `تم تعليق حساب ${target.full_name}.`
      )
      return true
    } catch (rpcError) {
      setActionError(toArabicError(rpcError))
      return false
    } finally {
      setBusyKey('')
    }
  }

  function handleApprove(target) {
    void runRpc('approve', target)
  }

  function handleSuspend(target) {
    const reason = window.prompt('سبب تعليق الحساب (اختياري):')
    if (reason === null) return
    void runRpc('suspend', target, reason.trim() || null)
  }

  function openReject(target) {
    setActionError('')
    setRejectTarget(target)
    setRejectReason('')
  }

  function closeReject() {
    setRejectTarget(null)
    setRejectReason('')
  }

  function handleKickoffChange(event) {
    const value = event.target.value
    setKickoffAt(value)
    if (!registrationOpenAt) {
      setRegistrationOpenAt(defaultRegistrationOpen(value))
    }
  }

  async function handleCreateMatch(event) {
    event.preventDefault()
    setMatchError('')
    setMatchSuccess('')

    const kickoff = kickoffAt ? new Date(kickoffAt) : null
    const open = registrationOpenAt ? new Date(registrationOpenAt) : null
    const close = registrationCloseAt ? new Date(registrationCloseAt) : null

    if (!kickoff || Number.isNaN(kickoff.getTime()) || !venue.trim()) {
      setMatchError('أدخل تاريخ ووقت المباراة واسم الملعب.')
      return
    }
    if ((open && Number.isNaN(open.getTime())) || (close && Number.isNaN(close.getTime()))) {
      setMatchError('أدخل أوقات فتح وإغلاق التسجيل بشكل صحيح.')
      return
    }
    if (open && close && open >= close) {
      setMatchError('وقت فتح التسجيل يجب أن يكون قبل وقت الإغلاق.')
      return
    }
    if (close && close > kickoff) {
      setMatchError('وقت إغلاق التسجيل يجب أن يكون قبل انطلاق المباراة أو مساوٍ له.')
      return
    }

    setCreatingMatch(true)
    try {
      const { error: rpcError } = await supabase.rpc('create_match', {
        p_kickoff_at: kickoff.toISOString(),
        p_venue: venue.trim(),
        p_address: address.trim() || null,
        p_notes: notes.trim() || null,
        p_registration_open_at: open?.toISOString() ?? null,
        p_registration_close_at: close?.toISOString() ?? null,
      })

      if (rpcError) throw rpcError

      setKickoffAt('')
      setRegistrationOpenAt('')
      setRegistrationCloseAt('')
      setVenue('')
      setAddress('')
      setNotes('')
      setMatchSuccess('تم إنشاء المباراة. ستظهر الآن في صفحة المباريات حسب جدولها.')
      await queryClient.invalidateQueries({ queryKey: ['matches', 'schedule'] })
    } catch (createError) {
      setMatchError(toArabicError(createError, 'تعذر إنشاء المباراة. تحقق من التاريخ والأوقات وحاول مرة أخرى.'))
    } finally {
      setCreatingMatch(false)
    }
  }

  async function handleRejectSubmit(event) {
    event.preventDefault()
    if (!rejectTarget) return

    const ok = await runRpc('reject', rejectTarget, rejectReason.trim() || null)
    if (ok) closeReject()
  }

  return (
    <div>
      <PageHeader
        eyebrow="الإدارة"
        title="إدارة الحسابات"
        description="مراجعة الحسابات الجديدة والموافقة عليها أو رفضها أو تعليقها."
        actions={
          <button
            type="button"
            onClick={() => void refetch()}
            disabled={isFetching}
            className="inline-flex min-h-11 items-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-4 py-2.5 text-xs font-bold text-white/65 transition-colors hover:border-white/20 hover:text-white disabled:opacity-60"
          >
            <RefreshCw className={`size-4 ${isFetching ? 'animate-spin' : ''}`} />
            تحديث
          </button>
        }
      />

      <div className="mb-6 flex items-start gap-3 rounded-3xl border border-amber-400/20 bg-amber-400/[0.05] px-5 py-4">
        <ShieldCheck className="mt-0.5 size-5 shrink-0 text-amber-300" />
        <div>
          <p className="text-sm font-bold text-amber-200">تحقق من ملكية رقم الهاتف قبل الموافقة</p>
          <p className="mt-1 text-[12px] leading-6 text-white/50">
            عند تعطيل OTP، لا يثبت رقم الهاتف ملكيته. تحقق من الرقم خارجيًا (اتصال أو واتساب أو
            حضور شخصي) قبل اعتماد الحساب. يمكن أن يكون الرقم مسروقًا أو معاد تدويره.
          </p>
        </div>
      </div>

      <div className="grid gap-3 min-[360px]:grid-cols-2 lg:grid-cols-4">
        <StatTile icon={Clock3} label="بانتظار الموافقة" value={pendingPlayers.length} />
        <StatTile icon={CheckCircle2} label="موافق عليهم" value={approvedCount} />
        <StatTile icon={Ban} label="موقوفون" value={suspendedCount} />
        <StatTile icon={XCircle} label="مرفوضون" value={rejectedCount} />
      </div>

      <section className="mt-6">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-2 text-base font-extrabold text-sand-100">
              <CalendarDays className="size-5 text-brand-300" />
              إنشاء مباراة جديدة
            </h2>
            <p className="mt-1 text-xs leading-6 text-white/45">
              يمكنك اختيار أي يوم ووقت للمباراة. إذا تركت أوقات التسجيل فارغة، ينفتح التسجيل اليوم السابق ١٠:٠٠ ويغلق عند الانطلاق.
            </p>
          </div>
          <span className="text-xs font-bold text-white/35">مباراة يدوية</span>
        </div>

        <Card className="p-5 sm:p-6">
          <form onSubmit={handleCreateMatch} className="grid gap-4 md:grid-cols-2">
            <div>
              <label htmlFor="match-kickoff" className="text-xs font-bold text-white/55">
                يوم ووقت المباراة
              </label>
              <input
                id="match-kickoff"
                type="datetime-local"
                value={kickoffAt}
                onChange={handleKickoffChange}
                required
                disabled={creatingMatch}
                className={inputClass}
              />
            </div>

            <div>
              <label htmlFor="match-venue" className="text-xs font-bold text-white/55">
                الملعب
              </label>
              <input
                id="match-venue"
                type="text"
                value={venue}
                onChange={(event) => setVenue(event.target.value)}
                required
                disabled={creatingMatch}
                placeholder="اسم الملعب"
                className={inputClass}
              />
            </div>

            <div>
              <label htmlFor="match-open" className="text-xs font-bold text-white/55">
                فتح التسجيل (اختياري)
              </label>
              <input
                id="match-open"
                type="datetime-local"
                value={registrationOpenAt}
                onChange={(event) => setRegistrationOpenAt(event.target.value)}
                disabled={creatingMatch}
                className={inputClass}
              />
            </div>

            <div>
              <label htmlFor="match-close" className="text-xs font-bold text-white/55">
                إغلاق التسجيل (اختياري)
              </label>
              <input
                id="match-close"
                type="datetime-local"
                value={registrationCloseAt}
                onChange={(event) => setRegistrationCloseAt(event.target.value)}
                disabled={creatingMatch}
                className={inputClass}
              />
            </div>

            <div>
              <label htmlFor="match-address" className="text-xs font-bold text-white/55">
                العنوان (اختياري)
              </label>
              <input
                id="match-address"
                type="text"
                value={address}
                onChange={(event) => setAddress(event.target.value)}
                disabled={creatingMatch}
                placeholder="العنوان أو رابط الخريطة"
                className={inputClass}
              />
            </div>

            <div>
              <label htmlFor="match-notes" className="text-xs font-bold text-white/55">
                ملاحظات (اختيارية)
              </label>
              <input
                id="match-notes"
                type="text"
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                disabled={creatingMatch}
                placeholder="أي تفاصيل إضافية"
                className={inputClass}
              />
            </div>

            {matchError ? (
              <p role="alert" className="rounded-2xl border border-red-400/20 bg-red-400/[0.06] px-4 py-3 text-[12px] leading-6 text-red-200 md:col-span-2">
                {matchError}
              </p>
            ) : null}
            {matchSuccess ? (
              <p role="status" className="rounded-2xl border border-brand-400/20 bg-brand-400/[0.06] px-4 py-3 text-[12px] leading-6 text-brand-200 md:col-span-2">
                {matchSuccess}
              </p>
            ) : null}

            <div className="md:col-span-2">
              <button
                type="submit"
                disabled={creatingMatch}
                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-2xl bg-brand-400 px-5 py-3 text-sm font-extrabold text-pitch-950 transition-colors hover:bg-brand-300 disabled:opacity-60"
              >
                {creatingMatch ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
                إنشاء المباراة
              </button>
            </div>
          </form>
        </Card>
      </section>

      {actionError ? (
        <div
          role="alert"
          className="mt-6 flex items-start gap-2 rounded-2xl border border-red-400/20 bg-red-400/[0.06] px-4 py-3 text-[12px] leading-6 text-red-200"
        >
          <AlertCircle className="mt-0.5 size-4 shrink-0" />
          <span>{actionError}</span>
        </div>
      ) : null}

      {successMessage ? (
        <div
          role="status"
          className="mt-6 flex items-start gap-2 rounded-2xl border border-brand-400/20 bg-brand-400/[0.06] px-4 py-3 text-[12px] leading-6 text-brand-200"
        >
          <CheckCircle2 className="mt-0.5 size-4 shrink-0" />
          <span>{successMessage}</span>
        </div>
      ) : null}

      <section className="mt-6">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="text-base font-extrabold text-sand-100">طلبات الانتظار</h2>
          <span className="text-xs font-bold text-white/35">{pendingPlayers.length} طلب</span>
        </div>

        {isLoading ? (
          <Card className="flex items-center gap-3 p-6 text-sm text-white/45">
            <Loader2 className="size-4 animate-spin text-brand-300" />
            جارٍ تحميل الحسابات…
          </Card>
        ) : error ? (
          <Card className="p-6 text-sm text-red-300">{toArabicError(error)}</Card>
        ) : pendingPlayers.length === 0 ? (
          <EmptyState
            icon={UserCheck}
            title="لا توجد طلبات انتظار"
            description="كل الحسابات الجديدة تمت مراجعتها."
          />
        ) : (
          <div className="space-y-3">
            {pendingPlayers.map((player) => {
              const approving = busyKey === `approve:${player.id}`
              const rejecting = busyKey === `reject:${player.id}`

              return (
                <Card key={player.id} className="p-5">
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="relative grid size-8 shrink-0 place-items-center overflow-hidden rounded-full bg-brand-400/10 text-[11px] font-black text-brand-300">
                          {player.full_name?.trim()?.charAt(0) || '؟'}
                          {player.avatar_url ? (
                            <img
                              src={player.avatar_url}
                              alt=""
                              loading="lazy"
                              decoding="async"
                              className="absolute inset-0 size-8 object-cover"
                              onError={(event) => {
                                event.currentTarget.style.display = 'none'
                              }}
                            />
                          ) : null}
                        </span>
                        <h3 className="truncate text-sm font-extrabold text-sand-100">
                          {player.full_name}
                        </h3>
                        <StatusBadge status={player.status} />
                      </div>
                      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-white/45">
                        <span className="inline-flex items-center gap-1.5" dir="ltr">
                          <Phone className="size-3.5" />
                          {player.phone}
                        </span>
                        <span>القميص: {player.jersey_number ?? '—'}</span>
                        <span>التسجيل: {formatDate(player.created_at)}</span>
                      </div>
                    </div>

                    <div className="flex shrink-0 flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => handleApprove(player)}
                        disabled={Boolean(busyKey)}
                        className="inline-flex min-h-11 items-center gap-1.5 rounded-2xl bg-brand-400 px-4 py-2.5 text-xs font-extrabold text-pitch-950 transition-opacity hover:opacity-90 disabled:opacity-60"
                      >
                        {approving ? (
                          <Loader2 className="size-3.5 animate-spin" />
                        ) : (
                          <CheckCircle2 className="size-3.5" />
                        )}
                        موافقة
                      </button>

                      <button
                        type="button"
                        onClick={() => openReject(player)}
                        disabled={Boolean(busyKey)}
                        className="inline-flex min-h-11 items-center gap-1.5 rounded-2xl border border-red-400/25 bg-red-400/[0.06] px-4 py-2.5 text-xs font-bold text-red-200 transition-colors hover:bg-red-400/10 disabled:opacity-60"
                      >
                        {rejecting ? (
                          <Loader2 className="size-3.5 animate-spin" />
                        ) : (
                          <XCircle className="size-3.5" />
                        )}
                        رفض
                      </button>
                    </div>
                  </div>
                </Card>
              )
            })}
          </div>
        )}
      </section>

      <section className="mt-8">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="text-base font-extrabold text-sand-100">الحسابات المسجلة</h2>
          <span className="text-xs font-bold text-white/35">{otherPlayers.length} حساب</span>
        </div>

        {isLoading ? (
          <Card className="p-6 text-sm text-white/45">جارٍ التحميل…</Card>
        ) : otherPlayers.length === 0 ? (
          <EmptyState
            icon={UserCheck}
            title="لا توجد حسابات أخرى"
            description="ستظهر الحسابات الموافق عليها والمرفوضة والموقوفة هنا."
          />
        ) : (
          <div className="space-y-3">
            {otherPlayers.map((player) => {
              const approving = busyKey === `approve:${player.id}`
              const suspending = busyKey === `suspend:${player.id}`

              return (
                <Card key={player.id} className="p-5">
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="relative grid size-8 shrink-0 place-items-center overflow-hidden rounded-full bg-brand-400/10 text-[11px] font-black text-brand-300">
                          {player.full_name?.trim()?.charAt(0) || '؟'}
                          {player.avatar_url ? (
                            <img
                              src={player.avatar_url}
                              alt=""
                              loading="lazy"
                              decoding="async"
                              className="absolute inset-0 size-8 object-cover"
                              onError={(event) => {
                                event.currentTarget.style.display = 'none'
                              }}
                            />
                          ) : null}
                        </span>
                        <h3 className="truncate text-sm font-extrabold text-sand-100">
                          {player.full_name}
                        </h3>
                        <StatusBadge status={player.status} />
                      </div>
                      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-white/45">
                        <span className="inline-flex items-center gap-1.5" dir="ltr">
                          <Phone className="size-3.5" />
                          {player.phone}
                        </span>
                        <span>القميص: {player.jersey_number ?? '—'}</span>
                        <span>التسجيل: {formatDate(player.created_at)}</span>
                      </div>
                      {player.rejection_reason ? (
                        <p className="mt-2 text-[11px] leading-5 text-white/35">
                          ملاحظة الإدارة: {player.rejection_reason}
                        </p>
                      ) : null}
                    </div>

                    <div className="flex shrink-0 flex-wrap gap-2">
                      {player.status === 'approved' ? (
                        <button
                          type="button"
                          onClick={() => handleSuspend(player)}
                          disabled={Boolean(busyKey)}
                          className="inline-flex min-h-11 items-center gap-1.5 rounded-2xl border border-red-400/25 bg-red-400/[0.06] px-4 py-2.5 text-xs font-bold text-red-200 transition-colors hover:bg-red-400/10 disabled:opacity-60"
                        >
                          {suspending ? (
                            <Loader2 className="size-3.5 animate-spin" />
                          ) : (
                            <Ban className="size-3.5" />
                          )}
                          تعليق
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => handleApprove(player)}
                          disabled={Boolean(busyKey)}
                          className="inline-flex min-h-11 items-center gap-1.5 rounded-2xl bg-brand-400 px-4 py-2.5 text-xs font-extrabold text-pitch-950 transition-opacity hover:opacity-90 disabled:opacity-60"
                        >
                          {approving ? (
                            <Loader2 className="size-3.5 animate-spin" />
                          ) : (
                            <CheckCircle2 className="size-3.5" />
                          )}
                          موافقة
                        </button>
                      )}
                    </div>
                  </div>
                </Card>
              )
            })}
          </div>
        )}
      </section>

      {rejectTarget ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-pitch-950/80 p-4 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-labelledby="reject-title"
          onClick={(event) => {
            if (event.target === event.currentTarget) closeReject()
          }}
        >
          <Card className="max-h-[85dvh] w-full max-w-md overflow-y-auto p-5 shadow-glow sm:p-6">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 id="reject-title" className="text-base font-extrabold text-sand-100">
                  رفض حساب {rejectTarget.full_name}
                </h2>
                <p className="mt-1 text-[11px] leading-5 text-white/40">
                  سيظهر سبب الرفض للاعب في صفحة حالة الحساب.
                </p>
              </div>
              <button
                type="button"
                onClick={closeReject}
                className="grid size-11 shrink-0 place-items-center rounded-xl text-white/40 transition-colors hover:text-white"
                aria-label="إغلاق"
              >
                <X className="size-4" />
              </button>
            </div>

            <form onSubmit={handleRejectSubmit} className="mt-5">
              <label htmlFor="reject-reason" className="text-xs font-bold text-white/55">
                سبب الرفض (اختياري)
              </label>
              <textarea
                id="reject-reason"
                value={rejectReason}
                onChange={(event) => setRejectReason(event.target.value)}
                rows={4}
                maxLength={500}
                className={`${inputClass} resize-none`}
                placeholder="مثال: تعذر التحقق من رقم الهاتف."
              />

              <div className="mt-5 flex flex-wrap justify-end gap-2">
                <button
                  type="button"
                  onClick={closeReject}
                  className="inline-flex min-h-11 items-center rounded-2xl border border-white/10 bg-white/5 px-4 py-2.5 text-xs font-bold text-white/60 transition-colors hover:text-white"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  disabled={busyKey === `reject:${rejectTarget.id}`}
                  className="inline-flex min-h-11 items-center gap-1.5 rounded-2xl bg-red-400 px-4 py-2.5 text-xs font-extrabold text-pitch-950 transition-opacity hover:opacity-90 disabled:opacity-60"
                >
                  {busyKey === `reject:${rejectTarget.id}` ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <XCircle className="size-3.5" />
                  )}
                  تأكيد الرفض
                </button>
              </div>
            </form>
          </Card>
        </div>
      ) : null}
    </div>
  )
}
