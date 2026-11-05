export default function Card({ className = '', children, ...props }) {
  return (
    <div
      className={`rounded-3xl border border-white/10 bg-white/[0.035] ${className}`}
      {...props}
    >
      {children}
    </div>
  )
}
