const variants = {
  brand: 'border-brand-400/25 bg-brand-400/10 text-brand-300',
  neutral: 'border-white/10 bg-white/5 text-white/65',
  warning: 'border-amber-400/25 bg-amber-400/10 text-amber-300',
}

export default function Badge({ variant = 'neutral', className = '', children }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[11px] font-bold ${variants[variant]} ${className}`}
    >
      {children}
    </span>
  )
}
