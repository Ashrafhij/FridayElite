import { Trophy } from 'lucide-react'

export default function BrandMark({ className = '' }) {
  return (
    <span
      className={`grid size-10 shrink-0 place-items-center rounded-2xl bg-brand-400 text-pitch-950 shadow-glow ${className}`}
      aria-hidden="true"
    >
      <Trophy className="size-5" strokeWidth={2.5} />
    </span>
  )
}
