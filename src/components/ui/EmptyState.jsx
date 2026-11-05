export default function EmptyState({ icon: Icon, title, description, action }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-3xl border border-dashed border-white/10 bg-white/[0.02] px-6 py-14 text-center">
      {Icon ? (
        <span className="mb-5 grid size-14 place-items-center rounded-2xl border border-brand-400/20 bg-brand-400/10 text-brand-300">
          <Icon className="size-6" />
        </span>
      ) : null}
      <h2 className="text-base font-extrabold text-sand-100">{title}</h2>
      {description ? (
        <p className="mt-2 max-w-md text-sm leading-7 text-white/50">{description}</p>
      ) : null}
      {action ? <div className="mt-6">{action}</div> : null}
    </div>
  )
}
