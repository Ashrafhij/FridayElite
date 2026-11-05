export default function StatTile({ icon: Icon, label, value, hint }) {
  return (
    <div className="rounded-3xl border border-white/10 bg-white/[0.035] p-4 sm:p-5">
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs font-semibold text-white/50">{label}</span>
        {Icon ? (
          <span className="grid size-8 place-items-center rounded-xl bg-white/5 text-brand-300">
            <Icon className="size-4" />
          </span>
        ) : null}
      </div>
      <p className="mt-3 text-2xl font-extrabold tabular-nums text-sand-100 sm:text-3xl">{value}</p>
      {hint ? <p className="mt-1 text-[11px] leading-5 text-white/35">{hint}</p> : null}
    </div>
  )
}
