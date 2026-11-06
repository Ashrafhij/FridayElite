import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, CheckCircle2, X } from 'lucide-react'
import { useAuth } from '../../context/AuthContext'

export default function ApprovalToast() {
  const { approvalNotice, dismissApprovalNotice } = useAuth()
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    if (!approvalNotice) {
      setVisible(false)
      return undefined
    }

    setVisible(true)
    const timer = window.setTimeout(() => setVisible(false), 10_000)

    return () => window.clearTimeout(timer)
  }, [approvalNotice, dismissApprovalNotice])

  if (!visible || !approvalNotice) return null

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed bottom-24 start-4 end-4 z-50 sm:start-1/2 sm:end-auto sm:w-[min(460px,calc(100vw-2rem))] sm:-translate-x-1/2 md:bottom-6"
    >
      <div className="flex items-start gap-3 rounded-3xl border border-brand-400/25 bg-pitch-900/95 p-4 shadow-glow backdrop-blur-xl">
        <span className="grid size-10 shrink-0 place-items-center rounded-2xl bg-brand-400/15 text-brand-300">
          <CheckCircle2 className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-extrabold text-sand-100">{approvalNotice.title}</p>
          <p className="mt-1 text-xs leading-6 text-white/60">{approvalNotice.body}</p>
          <Link
            to="/"
            onClick={dismissApprovalNotice}
            className="mt-3 inline-flex min-h-11 items-center gap-1.5 rounded-xl bg-brand-400 px-4 py-2 text-xs font-extrabold text-pitch-950"
          >
            الذهاب للمباريات
            <ArrowLeft className="size-4" />
          </Link>
        </div>
        <button
          type="button"
          onClick={() => {
            setVisible(false)
            dismissApprovalNotice()
          }}
          className="grid size-11 shrink-0 place-items-center rounded-xl text-white/45 transition-colors hover:text-white"
          aria-label="إغلاق الإشعار"
        >
          <X className="size-4" />
        </button>
      </div>
    </div>
  )
}
