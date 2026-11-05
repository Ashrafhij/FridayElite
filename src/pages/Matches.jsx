import { CalendarDays, Clock, MapPin, Users } from 'lucide-react'
import PageHeader from '../components/layout/PageHeader'
import Card from '../components/ui/Card'
import EmptyState from '../components/ui/EmptyState'

const rhythm = [
  { label: 'موعد المباراة', value: 'كل جمعة — ٢٠:٠٠', icon: Clock },
  { label: 'فتح التسجيل', value: 'كل خميس — ١٠:٠٠ صباحًا', icon: CalendarDays },
  { label: 'عدد المقاعد', value: '١٨ لاعبًا مؤكدًا', icon: Users },
  { label: 'الملعب', value: 'ملعب الحي — العشب الصناعي', icon: MapPin },
]

export default function Matches() {
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
            description="ستظهر هنا أول مباراة بعد أن تضيفها الإدارة. التسجيل يفتح تلقائيًا في الموعد المحدد."
          />
        </div>
      </div>
    </div>
  )
}
