import { Link } from 'react-router-dom'
import { ArrowLeft, SearchX } from 'lucide-react'

export default function NotFound() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center text-center">
      <span className="grid size-16 place-items-center rounded-3xl border border-brand-400/20 bg-brand-400/10 text-brand-300">
        <SearchX className="size-7" />
      </span>
      <p className="mt-6 text-5xl font-black text-white/15">٤٠٤</p>
      <h1 className="mt-2 text-xl font-extrabold text-sand-100">الصفحة غير موجودة</h1>
      <p className="mt-2 max-w-sm text-sm leading-7 text-white/50">
        الرابط الذي فتحته غير صحيح أو تم نقل الصفحة.
      </p>
      <Link
        to="/"
        className="mt-6 inline-flex items-center gap-2 rounded-2xl bg-brand-400 px-5 py-3 text-sm font-extrabold text-pitch-950"
      >
        العودة للرئيسية
        <ArrowLeft className="size-4" />
      </Link>
    </div>
  )
}
