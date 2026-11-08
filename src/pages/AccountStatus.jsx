import { Link, useNavigate } from 'react-router-dom'
import {
  ArrowLeft,
  Ban,
  CheckCircle2,
  Clock3,
  LogOut,
  Pencil,
  Phone,
  ShieldCheck,
  UserRound,
  XCircle,
} from 'lucide-react'
import PageHeader from '../components/layout/PageHeader'
import { ProfileUnavailable } from '../components/auth/RouteGuards'
import Badge from '../components/ui/Badge'
import Card from '../components/ui/Card'
import { useAuth } from '../context/AuthContext'
import { formatPhoneForDisplay } from '../lib/phone'

const STATUS_CONFIG = {
  pending: {
    label: 'بانتظار الموافقة',
    badge: 'warning',
    icon: Clock3,
    title: 'حسابك بانتظار موافقة الإدارة',
    description:
      'تم إنشاء الحساب بنجاح. يمكنك التسجيل في المباراة عبر رابط التسجيل الذي يشاركه المدير، وتُفعّل بقية الميزات بعد موافقة الإدارة.',
    tone: 'text-amber-300 border-amber-400/20 bg-amber-400/10',
  },
  rejected: {
    label: 'مرفوض',
    badge: 'neutral',
    icon: XCircle,
    title: 'لم تتم الموافقة على الحساب',
    description: 'لا يمكن استخدام حسابك للوصول إلى المباريات أو التسجيلات. تواصل مع إدارة المجموعة.',
    tone: 'text-red-300 border-red-400/20 bg-red-400/10',
  },
  suspended: {
    label: 'موقوف',
    badge: 'neutral',
    icon: Ban,
    title: 'الحساب موقوف',
    description:
      'تم إيقاف حسابك مؤقتًا من قبل الإدارة. لا يمكنك الوصول إلى وظائف اللاعبين حتى يُرفع الإيقاف.',
    tone: 'text-red-300 border-red-400/20 bg-red-400/10',
  },
  approved: {
    label: 'موافق عليه',
    badge: 'brand',
    icon: CheckCircle2,
    title: 'تم قبول حسابك',
    description: 'قبلت الإدارة حسابك وتم تفعيله بنجاح. يمكنك الآن الوصول إلى المباريات والتسجيل في المواعيد المتاحة.',
    tone: 'text-brand-300 border-brand-400/20 bg-brand-400/10',
  },
}

export default function AccountStatus() {
  const { profile, signOut } = useAuth()
  const navigate = useNavigate()

  if (!profile) return <ProfileUnavailable />

  const config = STATUS_CONFIG[profile.status] ?? STATUS_CONFIG.pending
  const Icon = config.icon
  const canEditProfile = profile.status === 'pending' || profile.status === 'approved'

  async function handleSignOut() {
    try {
      await signOut()
    } finally {
      navigate('/login', { replace: true })
    }
  }

  return (
    <div>
      <PageHeader
        eyebrow="حسابي"
        title="حالة الحساب"
        description="معلومات حسابك الحالية وما يمكنك الوصول إليه."
        actions={<Badge variant={config.badge}>{config.label}</Badge>}
      />

      <div className="grid gap-6 lg:grid-cols-5">
        <Card className="p-6 lg:col-span-3 sm:p-8">
          <span className={`grid size-14 place-items-center rounded-2xl border ${config.tone}`}>
            <Icon className="size-6" />
          </span>

          <h2 className="mt-5 text-xl font-extrabold text-sand-100">{config.title}</h2>
          <p className="mt-2 max-w-2xl text-sm leading-7 text-white/55">{config.description}</p>

          {profile.status === 'approved' ? (
            <div className="mt-5 flex items-start gap-3 rounded-2xl border border-brand-400/25 bg-brand-400/[0.07] px-4 py-4">
              <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-brand-300" />
              <div>
                <p className="text-sm font-extrabold text-brand-200">تم قبول حسابك وتم تفعيله بنجاح.</p>
                <p className="mt-1 text-[12px] leading-6 text-white/50">
                  يمكنك الآن التسجيل في المباريات وفتح الملف واختيار مراكزك المفضلة.
                </p>
              </div>
            </div>
          ) : null}

          {profile.rejection_reason ? (
            <div className="mt-5 rounded-2xl border border-red-400/20 bg-red-400/[0.06] px-4 py-3">
              <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-red-300/80">
                سبب الإدارة
              </p>
              <p className="mt-1.5 text-sm leading-7 text-white/70">{profile.rejection_reason}</p>
            </div>
          ) : null}

          {profile.status === 'pending' ? (
            <div className="mt-6 rounded-2xl border border-brand-400/15 bg-brand-400/[0.04] px-4 py-3.5">
              <p className="flex items-center gap-2 text-xs font-bold text-brand-300">
                <ShieldCheck className="size-4" />
                التحقق من رقم الهاتف
              </p>
              <p className="mt-1.5 text-[12px] leading-6 text-white/50">
                الموافقة تعتمد على تحقق الإدارة من رقم الهاتف خارجيًا (اتصال أو واتساب أو حضور
                شخصي). رقم الهاتف وحده لا يثبت الملكية.
              </p>
            </div>
          ) : null}

          {profile.status === 'pending' ? (
            <p className="mt-4 text-[12px] leading-6 text-white/45">
              يمكنك تعديل ملفك ومراكزك المفضلة الآن، كما يمكنك التسجيل في المباراة عبر رابط التسجيل
              الذي يشاركه المدير. تُفعّل بقية الميزات (المباريات، الفرق، دليل اللاعبين) بعد الموافقة،
              وسيظهر لك إشعار داخل التطبيق ويتحول حسابك إلى مفعّل تلقائيًا.
            </p>
          ) : null}

          <div className="mt-7 flex flex-wrap gap-3">
            {canEditProfile ? (
              <Link
                to="/profile"
                className="inline-flex items-center justify-center gap-2 rounded-2xl bg-brand-400 px-5 py-3 text-sm font-extrabold text-pitch-950 transition-opacity hover:opacity-90"
              >
                <Pencil className="size-4" />
                تعديل الملف والمراكز
              </Link>
            ) : null}

            {profile.status === 'approved' ? (
              <Link
                to="/"
                className="inline-flex items-center justify-center gap-2 rounded-2xl bg-brand-400 px-5 py-3 text-sm font-extrabold text-pitch-950 transition-opacity hover:opacity-90"
              >
                العودة للرئيسية
                <ArrowLeft className="size-4" />
              </Link>
            ) : null}

            <button
              type="button"
              onClick={handleSignOut}
              className="inline-flex items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-5 py-3 text-sm font-bold text-white/65 transition-colors hover:border-white/20 hover:text-white"
            >
              <LogOut className="size-4" />
              تسجيل الخروج
            </button>
          </div>
        </Card>

        <Card className="p-6 lg:col-span-2">
          <h2 className="text-base font-extrabold text-sand-100">بيانات الحساب</h2>

          <dl className="mt-5 space-y-4">
            <div className="flex items-start gap-3">
              <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-white/5 text-brand-300">
                <UserRound className="size-4" />
              </span>
              <div className="min-w-0">
                <dt className="text-[11px] font-bold text-white/40">الاسم</dt>
                <dd className="mt-1 break-words text-sm font-semibold text-sand-100">
                  {profile.full_name}
                </dd>
              </div>
            </div>

            <div className="flex items-start gap-3">
              <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-white/5 text-brand-300">
                <Phone className="size-4" />
              </span>
              <div className="min-w-0">
                <dt className="text-[11px] font-bold text-white/40">رقم الهاتف</dt>
                <dd className="mt-1 text-sm font-semibold text-sand-100" dir="ltr">
                  {formatPhoneForDisplay(profile.phone)}
                </dd>
              </div>
            </div>

            {profile.role === 'admin' ? (
              <div className="flex items-start gap-3">
                <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-brand-400/10 text-brand-300">
                  <ShieldCheck className="size-4" />
                </span>
                <div>
                  <dt className="text-[11px] font-bold text-white/40">الصلاحية</dt>
                  <dd className="mt-1 text-sm font-semibold text-brand-300">مدير المجموعة</dd>
                </div>
              </div>
            ) : null}
          </dl>

          <p className="mt-6 border-t border-white/10 pt-4 text-[11px] leading-6 text-white/35">
            لا يمكن تغيير رقم الهاتف من الملف الشخصي. تغيير الرقم يحتاج إجراءً إداريًا محميًا.
          </p>
        </Card>
      </div>
    </div>
  )
}
