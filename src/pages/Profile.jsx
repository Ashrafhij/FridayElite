import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  AlertCircle,
  BadgeCheck,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Loader2,
  LockKeyhole,
  Phone,
  Save,
  ShieldCheck,
  UserRound,
  X,
} from 'lucide-react'
import PageHeader from '../components/layout/PageHeader'
import Badge from '../components/ui/Badge'
import Card from '../components/ui/Card'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabase'
import { toArabicError } from '../lib/errorMessages'
import { formatPhoneForDisplay } from '../lib/phone'

const inputClass =
  'mt-2 w-full rounded-2xl border border-white/10 bg-pitch-950/60 px-4 py-3 text-sm font-semibold text-sand-100 outline-none transition-colors placeholder:text-white/25 focus:border-brand-400/50 disabled:opacity-60'

const labelClass = 'text-xs font-bold text-white/55'

const CATEGORY_LABELS = {
  gk: 'حراسة المرمى',
  defense: 'الدفاع',
  midfield: 'الوسط',
  attack: 'الهجوم',
}

const CATEGORY_ORDER = ['gk', 'defense', 'midfield', 'attack']

const STATUS_LABELS = {
  pending: 'بانتظار الموافقة',
  approved: 'موافق عليه',
  rejected: 'مرفوض',
  suspended: 'موقوف',
}

export default function Profile() {
  const { profile, isAdmin, refreshProfile } = useAuth()

  const [fullName, setFullName] = useState('')
  const [preferredFoot, setPreferredFoot] = useState('')
  const [jerseyNumber, setJerseyNumber] = useState('')
  const [selectedPositions, setSelectedPositions] = useState([])
  const [savingProfile, setSavingProfile] = useState(false)
  const [savingPositions, setSavingPositions] = useState(false)
  const [profileMessage, setProfileMessage] = useState({ type: '', text: '' })
  const [positionsMessage, setPositionsMessage] = useState({ type: '', text: '' })

  useEffect(() => {
    if (!profile) return
    setFullName(profile.full_name ?? '')
    setPreferredFoot(profile.preferred_foot ?? '')
    setJerseyNumber(profile.jersey_number == null ? '' : String(profile.jersey_number))
  }, [profile?.id, profile?.full_name, profile?.preferred_foot, profile?.jersey_number])

  const {
    data: positions = [],
    isLoading: positionsLoading,
    error: positionsError,
  } = useQuery({
    queryKey: ['positions'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('positions')
        .select('code, name_ar, category, sort_order')
        .eq('is_active', true)
        .order('sort_order', { ascending: true })

      if (error) throw error
      return data ?? []
    },
    staleTime: 10 * 60 * 1000,
  })

  const {
    data: savedPositions = [],
    isLoading: savedPositionsLoading,
    error: savedPositionsError,
    refetch: refetchSavedPositions,
  } = useQuery({
    queryKey: ['my-positions', profile?.id],
    enabled: Boolean(profile?.id),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('player_positions')
        .select('position_code, priority')
        .eq('player_id', profile.id)
        .order('priority', { ascending: true })

      if (error) throw error
      return data ?? []
    },
  })

  const savedPositionsKey = savedPositions.map((item) => item.position_code).join('|')

  useEffect(() => {
    setSelectedPositions(savedPositions.map((item) => item.position_code))
  }, [savedPositionsKey])

  const positionByCode = useMemo(
    () => new Map(positions.map((position) => [position.code, position])),
    [positions]
  )

  const positionsByCategory = useMemo(() => {
    const grouped = new Map(CATEGORY_ORDER.map((category) => [category, []]))
    for (const position of positions) {
      if (!grouped.has(position.category)) grouped.set(position.category, [])
      grouped.get(position.category).push(position)
    }
    return grouped
  }, [positions])

  function positionName(code) {
    return positionByCode.get(code)?.name_ar ?? code
  }

  function togglePosition(code) {
    setPositionsMessage({ type: '', text: '' })

    setSelectedPositions((current) => {
      if (current.includes(code)) {
        return current.filter((item) => item !== code)
      }

      if (current.length >= 5) {
        setPositionsMessage({
          type: 'error',
          text: 'يمكنك اختيار 5 مراكز كحد أقصى، مرتبة حسب الأولوية.',
        })
        return current
      }

      return [...current, code]
    })
  }

  function movePosition(index, direction) {
    setSelectedPositions((current) => {
      const target = index + direction
      if (target < 0 || target >= current.length) return current

      const next = [...current]
      ;[next[index], next[target]] = [next[target], next[index]]
      return next
    })
  }

  function removePosition(code) {
    setSelectedPositions((current) => current.filter((item) => item !== code))
  }

  async function handleSaveProfile(event) {
    event.preventDefault()
    setProfileMessage({ type: '', text: '' })

    const name = fullName.trim()
    if (name.length < 2) {
      setProfileMessage({ type: 'error', text: 'أدخل الاسم الكامل (حرفان على الأقل).' })
      return
    }

    let jersey = null
    if (jerseyNumber.trim() !== '') {
      jersey = Number(jerseyNumber)
      if (!Number.isInteger(jersey) || jersey < 1 || jersey > 99) {
        setProfileMessage({ type: 'error', text: 'رقم القميص يجب أن يكون بين 1 و99.' })
        return
      }
    }

    setSavingProfile(true)

    try {
      const { error } = await supabase.rpc('update_my_profile', {
        p_full_name: name,
        p_avatar_url: profile?.avatar_url ?? null,
        p_preferred_foot: preferredFoot || null,
        p_jersey_number: jersey,
      })

      if (error) throw error

      await refreshProfile()
      setProfileMessage({ type: 'success', text: 'تم حفظ بيانات الملف الشخصي.' })
    } catch (saveError) {
      setProfileMessage({ type: 'error', text: toArabicError(saveError) })
    } finally {
      setSavingProfile(false)
    }
  }

  async function handleSavePositions() {
    setPositionsMessage({ type: '', text: '' })

    if (selectedPositions.length === 0) {
      setPositionsMessage({ type: 'error', text: 'اختر مركزًا واحدًا على الأقل.' })
      return
    }

    setSavingPositions(true)

    try {
      const { error } = await supabase.rpc('set_my_positions', {
        p_position_codes: selectedPositions,
      })

      if (error) throw error

      await refetchSavedPositions()
      setPositionsMessage({ type: 'success', text: 'تم حفظ المراكز المفضلة وترتيبها.' })
    } catch (saveError) {
      setPositionsMessage({ type: 'error', text: toArabicError(saveError) })
    } finally {
      setSavingPositions(false)
    }
  }

  if (!profile) return null

  const isPending = profile.status === 'pending'
  const statusLabel = STATUS_LABELS[profile.status] ?? profile.status

  return (
    <div>
      <PageHeader
        eyebrow="حسابي"
        title="الملف الشخصي"
        description="بياناتك الأساسية ومراكزك المفضلة. رقم الهاتف للقراءة فقط ويُدار من خلال المصادقة."
        actions={
          <Badge variant={profile.status === 'approved' ? 'brand' : 'warning'}>
            {profile.status === 'approved' ? <BadgeCheck className="size-3.5" /> : null}
            {statusLabel}
          </Badge>
        }
      />

      {isPending ? (
        <div className="mb-6 flex items-start gap-3 rounded-3xl border border-amber-400/20 bg-amber-400/[0.05] px-5 py-4">
          <ShieldCheck className="mt-0.5 size-5 shrink-0 text-amber-300" />
          <div>
            <p className="text-sm font-bold text-amber-200">حسابك بانتظار موافقة الإدارة</p>
            <p className="mt-1 text-[12px] leading-6 text-white/50">
              يمكنك حفظ ملفك ومراكزك المفضلة الآن. لا يمكنك الوصول إلى المباريات أو التسجيلات أو
              الفرق أو دليل اللاعبين حتى تتم الموافقة.
            </p>
          </div>
        </div>
      ) : (
        <div className="mb-6 flex items-start gap-3 rounded-3xl border border-brand-400/15 bg-brand-400/[0.035] px-5 py-4">
          <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-brand-300" />
          <div>
            <p className="text-sm font-bold text-brand-200">حسابك موافق عليه</p>
            <p className="mt-1 text-[12px] leading-6 text-white/50">
              يمكنك الآن التسجيل في المباريات المتاحة والوصول إلى وظائف اللاعبين.
            </p>
          </div>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="p-6 lg:col-span-1">
          <div className="flex flex-col items-center text-center">
            <span className="grid size-24 place-items-center rounded-full border border-brand-400/20 bg-brand-400/10 text-3xl font-black text-brand-300">
              {profile.full_name.trim().charAt(0) || '؟'}
            </span>
            <h2 className="mt-4 text-lg font-extrabold text-sand-100">{profile.full_name}</h2>
            <p className="mt-1 flex items-center gap-1.5 text-sm text-white/50" dir="ltr">
              <Phone className="size-3.5" />
              {formatPhoneForDisplay(profile.phone)}
            </p>
            <div className="mt-3 flex flex-wrap justify-center gap-2">
              <Badge variant={profile.status === 'approved' ? 'brand' : 'warning'}>
                {statusLabel}
              </Badge>
              {isAdmin ? <Badge variant="brand">مدير</Badge> : null}
            </div>
          </div>

          <div className="mt-7 border-t border-white/10 pt-5">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-xs font-bold text-white/50">المراكز المفضلة</h3>
              <span className="text-[11px] font-bold text-white/30">
                {selectedPositions.length}/5
              </span>
            </div>

            {savedPositionsLoading ? (
              <p className="mt-3 text-xs text-white/35">جارٍ تحميل المراكز…</p>
            ) : selectedPositions.length > 0 ? (
              <ol className="mt-3 space-y-2">
                {selectedPositions.map((code, index) => (
                  <li
                    key={code}
                    className="flex items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.03] px-3 py-2"
                  >
                    <span className="grid size-6 shrink-0 place-items-center rounded-full bg-brand-400/15 text-[11px] font-black text-brand-300">
                      {index + 1}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-xs font-bold text-white/70">
                      {positionName(code)}
                    </span>
                    <button
                      type="button"
                      onClick={() => movePosition(index, -1)}
                      disabled={index === 0}
                      className="rounded-lg p-1 text-white/35 transition-colors hover:text-white disabled:opacity-20"
                      aria-label="رفع الأولوية"
                    >
                      <ChevronUp className="size-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => movePosition(index, 1)}
                      disabled={index === selectedPositions.length - 1}
                      className="rounded-lg p-1 text-white/35 transition-colors hover:text-white disabled:opacity-20"
                      aria-label="خفض الأولوية"
                    >
                      <ChevronDown className="size-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => removePosition(code)}
                      className="rounded-lg p-1 text-white/35 transition-colors hover:text-red-300"
                      aria-label="إزالة المركز"
                    >
                      <X className="size-3.5" />
                    </button>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="mt-3 text-xs leading-6 text-white/35">
                لم تحدد مراكز بعد. اختر حتى 5 مراكز من القائمة.
              </p>
            )}

            {positionsMessage.text && positionsMessage.type === 'error' ? (
              <p className="mt-3 text-[11px] leading-5 text-red-300">{positionsMessage.text}</p>
            ) : null}
          </div>

          <p className="mt-6 border-t border-white/10 pt-4 text-[11px] leading-6 text-white/30">
            <LockKeyhole className="mb-0.5 me-1 inline size-3" />
            رقم الهاتف لا يمكن تعديله من هنا. أي تغيير يتطلب إجراءً إداريًا محميًا وقد يعيد حالة
            الحساب إلى المراجعة.
          </p>
        </Card>

        <div className="space-y-6 lg:col-span-2">
          <Card className="p-6 sm:p-7">
            <div className="flex items-center gap-2">
              <UserRound className="size-4 text-brand-300" />
              <h2 className="text-base font-extrabold text-sand-100">البيانات الأساسية</h2>
            </div>

            <form onSubmit={handleSaveProfile} className="mt-5 space-y-5" noValidate>
              <div className="grid gap-5 sm:grid-cols-2">
                <div>
                  <label htmlFor="profile-name" className={labelClass}>
                    الاسم الكامل
                  </label>
                  <input
                    id="profile-name"
                    type="text"
                    autoComplete="name"
                    value={fullName}
                    onChange={(event) => setFullName(event.target.value)}
                    maxLength={80}
                    className={inputClass}
                    disabled={savingProfile}
                  />
                </div>

                <div>
                  <label htmlFor="profile-phone" className={labelClass}>
                    رقم الهاتف
                  </label>
                  <div className="relative">
                    <LockKeyhole className="pointer-events-none absolute end-4 top-1/2 mt-1 size-3.5 -translate-y-1/2 text-white/25" />
                    <input
                      id="profile-phone"
                      type="tel"
                      dir="ltr"
                      value={formatPhoneForDisplay(profile.phone)}
                      readOnly
                      className={`${inputClass} pe-10 text-left text-white/50`}
                      aria-describedby="profile-phone-hint"
                    />
                  </div>
                  <p id="profile-phone-hint" className="mt-2 text-[11px] leading-5 text-white/30">
                    للقراءة فقط — مربوط بحساب المصادقة.
                  </p>
                </div>

                <div>
                  <label htmlFor="profile-foot" className={labelClass}>
                    القدم المفضلة
                  </label>
                  <select
                    id="profile-foot"
                    value={preferredFoot}
                    onChange={(event) => setPreferredFoot(event.target.value)}
                    className={inputClass}
                    disabled={savingProfile}
                  >
                    <option value="">غير محدد</option>
                    <option value="right">يمين</option>
                    <option value="left">يسار</option>
                    <option value="both">كلتا القدمين</option>
                  </select>
                </div>

                <div>
                  <label htmlFor="profile-jersey" className={labelClass}>
                    رقم القميص
                  </label>
                  <input
                    id="profile-jersey"
                    type="number"
                    inputMode="numeric"
                    min="1"
                    max="99"
                    dir="ltr"
                    value={jerseyNumber}
                    onChange={(event) => setJerseyNumber(event.target.value)}
                    placeholder="1 - 99"
                    className={`${inputClass} text-left`}
                    disabled={savingProfile}
                  />
                  <p className="mt-2 text-[11px] leading-5 text-white/30">
                    رقم القميص الفريد يُطبّق على اللاعبين الموافق عليهم.
                  </p>
                </div>
              </div>

              {profileMessage.text ? (
                <div
                  role={profileMessage.type === 'error' ? 'alert' : 'status'}
                  className={`flex items-start gap-2 rounded-2xl border px-4 py-3 text-[12px] leading-6 ${
                    profileMessage.type === 'error'
                      ? 'border-red-400/20 bg-red-400/[0.06] text-red-200'
                      : 'border-brand-400/20 bg-brand-400/[0.06] text-brand-200'
                  }`}
                >
                  {profileMessage.type === 'error' ? (
                    <AlertCircle className="mt-0.5 size-4 shrink-0" />
                  ) : (
                    <CheckCircle2 className="mt-0.5 size-4 shrink-0" />
                  )}
                  <span>{profileMessage.text}</span>
                </div>
              ) : null}

              <button
                type="submit"
                disabled={savingProfile}
                className="inline-flex items-center justify-center gap-2 rounded-2xl bg-brand-400 px-5 py-3 text-sm font-extrabold text-pitch-950 transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {savingProfile ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
                {savingProfile ? 'جارٍ الحفظ…' : 'حفظ البيانات'}
              </button>
            </form>
          </Card>

          <Card className="p-6 sm:p-7">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <BadgeCheck className="size-4 text-brand-300" />
                <h2 className="text-base font-extrabold text-sand-100">المراكز المفضلة</h2>
              </div>
              <span className="text-[11px] font-semibold text-white/35">
                اختر حتى 5 مراكز، الأولوية من الأعلى إلى الأسفل
              </span>
            </div>

            {positionsLoading ? (
              <p className="mt-5 text-xs text-white/35">جارٍ تحميل المراكز…</p>
            ) : positionsError ? (
              <p className="mt-5 text-xs text-red-300">تعذر تحميل قائمة المراكز.</p>
            ) : savedPositionsError ? (
              <p className="mt-5 text-xs text-red-300">تعذر تحميل مراكزك الحالية.</p>
            ) : (
              <div className="mt-5 space-y-5">
                {CATEGORY_ORDER.map((category) => {
                  const categoryPositions = positionsByCategory.get(category) ?? []
                  if (categoryPositions.length === 0) return null

                  return (
                    <div key={category}>
                      <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-white/30">
                        {CATEGORY_LABELS[category]}
                      </p>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {categoryPositions.map((position) => {
                          const order = selectedPositions.indexOf(position.code)
                          const isSelected = order >= 0

                          return (
                            <button
                              key={position.code}
                              type="button"
                              onClick={() => togglePosition(position.code)}
                              className={`inline-flex items-center gap-1.5 rounded-full border px-3.5 py-2 text-xs font-bold transition-colors ${
                                isSelected
                                  ? 'border-brand-400/40 bg-brand-400/15 text-brand-200'
                                  : 'border-white/10 bg-white/[0.03] text-white/55 hover:border-white/20 hover:text-white'
                              }`}
                            >
                              {isSelected ? (
                                <span className="grid size-4 place-items-center rounded-full bg-brand-400 text-[9px] font-black text-pitch-950">
                                  {order + 1}
                                </span>
                              ) : null}
                              {position.name_ar}
                            </button>
                          )
                        })}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}

            {positionsMessage.text ? (
              <div
                role={positionsMessage.type === 'error' ? 'alert' : 'status'}
                className={`mt-5 flex items-start gap-2 rounded-2xl border px-4 py-3 text-[12px] leading-6 ${
                  positionsMessage.type === 'error'
                    ? 'border-red-400/20 bg-red-400/[0.06] text-red-200'
                    : 'border-brand-400/20 bg-brand-400/[0.06] text-brand-200'
                }`}
              >
                {positionsMessage.type === 'error' ? (
                  <AlertCircle className="mt-0.5 size-4 shrink-0" />
                ) : (
                  <CheckCircle2 className="mt-0.5 size-4 shrink-0" />
                )}
                <span>{positionsMessage.text}</span>
              </div>
            ) : null}

            <button
              type="button"
              onClick={handleSavePositions}
              disabled={savingPositions || positionsLoading || Boolean(positionsError)}
              className="mt-5 inline-flex items-center justify-center gap-2 rounded-2xl bg-brand-400 px-5 py-3 text-sm font-extrabold text-pitch-950 transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {savingPositions ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
              {savingPositions ? 'جارٍ الحفظ…' : 'حفظ المراكز'}
            </button>
          </Card>
        </div>
      </div>
    </div>
  )
}
