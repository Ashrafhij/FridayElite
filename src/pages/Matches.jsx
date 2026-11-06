import { CalendarDays, CheckCircle2, Clock, MapPin, Users } from 'lucide-react'
import PageHeader from '../components/layout/PageHeader'
import Card from '../components/ui/Card'
import EmptyState from '../components/ui/EmptyState'
import { useRegistrationWindow } from '../hooks/useRegistrationWindow'

const rhythm = [
  { label: 'موعد المباراة', value: 'كل جمعة — ٢٠:٠٠', icon: Clock },
  { label: 'فتح التسجيل', value: 'كل خميس — ١٠:٠٠ صباحًا', icon: CalendarDays },
  { label: 'إغلاق التسجيل', value: 'كل جمعة — ٢٠:٠٠ مساءً', icon: CheckCircle2 },
  { label: 'عدد المقاعد', value: '١٨ لاعبًا مؤكدًا', icon: Users },
  { label: 'الملعب', value: 'ملعب الحي — العشب الصناعي', icon: MapPin },
]

export default function Matches() {
  const registrationWindow = useRegistrationWindow()
  return (
    <div>
      <PageHeader
        eyebrow="الموسم الأول"
        title="المباريات"
        description="جدول المباريات الأسبوعية وحالة التسجيل في كل موعد."
      />

      <div className="grid gap-6 lg:grid-cols-5">
        <Card className="p-6 lg:col-span-2">
          <h2 className="text-base font-extrabold text-sand-100">إيقاع الأسبوع</h2>
          <p className={`mt-2 inline-flex items-center gap-2 rounded-full border px-3 py-1 text-[11px] font-bold ${registrationWindow.isOpen ? 'border-brand-400/25 bg-brand-400/10 text-brand-200' : 'border-white/10 bg-white/[0.03] text-white/55'}`}>
            <span className={`size-2 rounded-full ${registrationWindow.isOpen ? 'bg-brand-300' : 'bg-white/35'}`} aria-hidden="true" />
            {registrationWindow.isOpen
              ? 'التسجيل مفتوح الآن — يغلق الجمعة ٢٠:٠٠'
              : 'التسجيل مفتوح من الخميس ١٠:٠٠ حتى الجمعة ٢٠:٠٠'}
          </p>
          <dl className="mt-5 space-y-4">
            {rhythm.map(({ label, value, icon: Icon }) => (
              <div key={label} className="flex items-start gap-3">
                <span className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-xl bg-white/5 text-brand-300">
                  <Icon className="size-4" />
                </span>
                <div>
                  <dt className="text-xs font-semibold text-white/40">{label}</dt>
                  <dd className="mt-0.5 text-sm font-bold text-sand-100">{value}</dd>
                </div>
              </div>
            ))}
          </dl>
        </Card>

        <div className="lg:col-span-3">
          <EmptyState
            icon={CalendarDays}
            title="لا توجد مباريات منشورة بعد"
            description="ستظهر هنا أول مباراة بعد أن تضيفها الإدارة. يُفتح التسجيل الخميس الساعة ١٠:٠٠ صباحًا ويغلق الجمعة الساعة ٢٠:٠٠ مساءً، بتوقيت محلي."
          />
        </div>
      </div>
    </div>
  )
}
