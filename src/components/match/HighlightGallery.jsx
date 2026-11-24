import { useEffect, useState } from 'react'
import { Image as ImageIcon, Play, Trash2, X } from 'lucide-react'
import Card from '../ui/Card'
import EmptyState from '../ui/EmptyState'

function formatHighlightDate(value) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return new Intl.DateTimeFormat('ar', {
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'Asia/Jerusalem',
  }).format(date)
}

export default function HighlightGallery({
  highlights = [],
  showEmpty = false,
  onDelete,
  deletingId = null,
}) {
  const [active, setActive] = useState(null)
  const [failedIds, setFailedIds] = useState([])

  useEffect(() => {
    if (!active) return undefined
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') setActive(null)
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [active])

  const markFailed = (id) => {
    setFailedIds((current) => (current.includes(id) ? current : [...current, id]))
  }

  if (!highlights.length) {
    return showEmpty ? (
      <EmptyState
        icon={ImageIcon}
        title="لا توجد مقاطع بعد"
        description="ارفع صورة أو فيديو من هدف أو لحظة مميزة ليظهر هنا وللاعبين في صفحة النتيجة."
      />
    ) : null
  }

  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {highlights.map((highlight) => {
          const isVideo = highlight.media_type === 'video'
          const isBroken = failedIds.includes(highlight.id)
          const dateLabel = formatHighlightDate(highlight.created_at)
          return (
            <Card key={highlight.id} className="overflow-hidden">
              <button
                type="button"
                onClick={() => setActive(highlight)}
                aria-label={`عرض ${isVideo ? 'الفيديو' : 'الصورة'}${highlight.caption ? `: ${highlight.caption}` : ''}`}
                className="group relative block aspect-video w-full overflow-hidden bg-pitch-950/70"
              >
                {isBroken ? (
                  <span className="grid size-full place-items-center text-white/35">
                    <ImageIcon className="size-8" />
                  </span>
                ) : isVideo ? (
                  <video
                    src={highlight.media_url}
                    muted
                    playsInline
                    preload="metadata"
                    className="size-full object-cover"
                    onError={() => markFailed(highlight.id)}
                  />
                ) : (
                  <img
                    src={highlight.media_url}
                    alt={highlight.caption ?? 'مقطع من المباراة'}
                    loading="lazy"
                    decoding="async"
                    className="size-full object-cover transition-transform duration-300 group-hover:scale-105"
                    onError={() => markFailed(highlight.id)}
                  />
                )}
                <span className="pointer-events-none absolute inset-0 grid place-items-center bg-pitch-950/25 opacity-0 transition-opacity group-hover:opacity-100">
                  <span className="grid size-11 place-items-center rounded-full bg-brand-400 text-pitch-950">
                    <Play className="size-5" />
                  </span>
                </span>
                <span className="pointer-events-none absolute bottom-2 start-2 rounded-full bg-pitch-950/75 px-2.5 py-1 text-[10px] font-extrabold text-white/80 backdrop-blur-sm">
                  {isVideo ? 'فيديو' : 'صورة'}
                </span>
              </button>

              <div className="flex items-start justify-between gap-2 p-3">
                <div className="min-w-0">
                  <p className="line-clamp-2 text-xs font-bold leading-5 text-sand-100">
                    {highlight.caption ?? 'مقطع من المباراة'}
                  </p>
                  {dateLabel ? <p className="mt-1 text-[10px] text-white/40" dir="ltr">{dateLabel}</p> : null}
                </div>
                {onDelete ? (
                  <button
                    type="button"
                    onClick={() => onDelete(highlight)}
                    disabled={deletingId === highlight.id}
                    className="grid size-9 shrink-0 place-items-center rounded-xl border border-red-400/25 text-red-300 transition-colors hover:bg-red-400/10 disabled:opacity-50"
                    aria-label="حذف المقطع"
                  >
                    <Trash2 className="size-4" />
                  </button>
                ) : null}
              </div>
            </Card>
          )
        })}
      </div>

      {active ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-pitch-950/90 p-3 backdrop-blur-sm sm:p-6"
          role="dialog"
          aria-modal="true"
          aria-label="عرض المقطع"
          onClick={() => setActive(null)}
        >
          <div
            className="max-h-[92dvh] w-full max-w-4xl overflow-y-auto overscroll-contain rounded-[1.75rem] border border-white/10 bg-pitch-900/95 p-4 shadow-glow sm:p-5"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mb-3 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-extrabold text-sand-100">
                  {active.caption ?? 'مقطع من المباراة'}
                </p>
                <p className="mt-1 text-[11px] text-white/45">
                  {active.media_type === 'video' ? 'فيديو' : 'صورة'} من المباراة
                </p>
              </div>
              <button
                type="button"
                onClick={() => setActive(null)}
                className="grid size-10 shrink-0 place-items-center rounded-xl text-white/50 transition-colors hover:text-white"
                aria-label="إغلاق المقطع"
              >
                <X className="size-5" />
              </button>
            </div>
            {active.media_type === 'video' ? (
              <video
                src={active.media_url}
                controls
                autoPlay
                playsInline
                className="max-h-[72dvh] w-full rounded-2xl bg-black"
              />
            ) : (
              <img
                src={active.media_url}
                alt={active.caption ?? 'مقطع من المباراة'}
                className="max-h-[72dvh] w-full rounded-2xl object-contain"
              />
            )}
          </div>
        </div>
      ) : null}
    </>
  )
}
