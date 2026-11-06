import { Link } from 'react-router-dom'
import { ShieldCheck } from 'lucide-react'
import BrandMark from '../layout/BrandMark'
import Card from '../ui/Card'

export default function AuthLayout({ title, description, children, footer }) {
  return (
    <div className="relative min-h-dvh overflow-hidden bg-pitch-950">
      <div className="bg-stadium pointer-events-none fixed inset-0" aria-hidden="true" />

      <main className="safe-page relative mx-auto flex min-h-dvh w-full max-w-6xl flex-col px-4 sm:px-6">
        <header className="flex items-center justify-between gap-4">
          <Link
            to="/"
            className="flex min-h-11 items-center gap-2.5"
            aria-label="فرايدي إيليت"
          >
            <BrandMark />
            <span className="flex flex-col leading-none">
              <span className="text-[15px] font-extrabold tracking-tight text-sand-100">
                فرايدي إيليت
              </span>
              <span className="mt-1 text-[10px] font-semibold uppercase tracking-[0.28em] text-brand-400/80">
                Friday Elite
              </span>
            </span>
          </Link>

          <span className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-[11px] font-bold text-white/55">
            <ShieldCheck className="size-3.5 text-brand-400/80" />
            دخول آمن
          </span>
        </header>

        <div className="flex flex-1 items-center justify-center py-8 sm:py-10">
          <div className="w-full max-w-md">
            <div className="mb-6 text-center">
              <h1 className="text-2xl font-black tracking-tight text-sand-100 sm:text-3xl">
                {title}
              </h1>
              {description ? (
                <p className="mx-auto mt-2 max-w-sm text-sm leading-7 text-white/50">{description}</p>
              ) : null}
            </div>

            <Card className="p-6 shadow-glow sm:p-8">{children}</Card>

            {footer ? <div className="mt-5 text-center">{footer}</div> : null}
          </div>
        </div>

        <p className="text-center text-[11px] leading-6 text-white/30">
          مجموعة كرة القدم الأسبوعية — الجمعة ٢٠:٠٠
        </p>
      </main>
    </div>
  )
}
