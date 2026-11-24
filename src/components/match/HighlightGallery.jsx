import { useEffect, useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Heart,
  Image as ImageIcon,
  Loader2,
  MessageCircle,
  Play,
  Send,
  Trash2,
  X,
} from 'lucide-react'
import { useAuth } from '../../context/AuthContext'
import { supabase } from '../../lib/supabase'
import { toArabicError } from '../../lib/errorMessages'
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

function toInteractionError(error, fallback) {
  const raw = typeof error === 'string' ? error : error?.message ?? ''
  if (/schema cache|does not exist/i.test(raw)) {
    return 'التفاعلات غير مهيأة. طبّق تحديث قاعدة البيانات 0038 أولًا.'
  }
  return toArabicError(error, fallback)
}

export default function HighlightGallery({
  highlights = [],
  showEmpty = false,
  onDelete,
  deletingId = null,
}) {
  const { profile, isAdmin } = useAuth()
  const queryClient = useQueryClient()
  const [active, setActive] = useState(null)
  const [failedIds, setFailedIds] = useState([])
  const [openCommentsId, setOpenCommentsId] = useState(null)
  const [commentDraft, setCommentDraft] = useState('')
  const [commentBusy, setCommentBusy] = useState(false)
  const [likingId, setLikingId] = useState(null)
  const [interactionError, setInteractionError] = useState('')

  const matchId = highlights[0]?.match_id ?? null
  const highlightIds = useMemo(() => highlights.map((highlight) => highlight.id), [highlights])
  const canInteract = Boolean(profile && profile.status === 'approved')

  const likesQuery = useQuery({
    queryKey: ['highlight-likes', matchId],
    enabled: Boolean(matchId && highlightIds.length),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('match_highlight_likes')
        .select('highlight_id,user_id')
        .eq('match_id', matchId)
      if (error) {
        console.debug('match_highlight_likes unavailable', error)
        return []
      }
      return data ?? []
    },
    staleTime: 10_000,
    refetchInterval: 30_000,
  })

  const commentsQuery = useQuery({
    queryKey: ['highlight-comments', matchId],
    enabled: Boolean(matchId && highlightIds.length),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('match_highlight_comments')
        .select('id,highlight_id,user_id,body,created_at')
        .eq('match_id', matchId)
        .order('created_at', { ascending: true })
      if (error) {
        console.debug('match_highlight_comments unavailable', error)
        return []
      }
      return data ?? []
    },
    staleTime: 10_000,
    refetchInterval: 30_000,
  })

  const authorIds = useMemo(
    () => [...new Set((commentsQuery.data ?? []).map((comment) => comment.user_id))],
    [commentsQuery.data],
  )

  const authorsQuery = useQuery({
    queryKey: ['highlight-comment-authors', matchId, authorIds.join('|')],
    enabled: authorIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('player_directory')
        .select('id,full_name,avatar_url')
        .in('id', authorIds)
      if (error) {
        console.debug('highlight comment authors unavailable', error)
        return []
      }
      return data ?? []
    },
    staleTime: 60_000,
  })

  const likesByHighlight = useMemo(() => {
    const counts = new Map()
    for (const like of likesQuery.data ?? []) {
      counts.set(like.highlight_id, (counts.get(like.highlight_id) ?? 0) + 1)
    }
    return counts
  }, [likesQuery.data])

  const likedIds = useMemo(
    () =>
      new Set(
        (likesQuery.data ?? [])
          .filter((like) => like.user_id === profile?.id)
          .map((like) => like.highlight_id),
      ),
    [likesQuery.data, profile?.id],
  )

  const commentsByHighlight = useMemo(() => {
    const grouped = new Map()
    for (const comment of commentsQuery.data ?? []) {
      const list = grouped.get(comment.highlight_id) ?? []
      list.push(comment)
      grouped.set(comment.highlight_id, list)
    }
    return grouped
  }, [commentsQuery.data])

  const authorById = useMemo(
    () => new Map((authorsQuery.data ?? []).map((player) => [player.id, player])),
    [authorsQuery.data],
  )

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

  function toggleComments(highlightId) {
    setOpenCommentsId((current) => (current === highlightId ? null : highlightId))
    setCommentDraft('')
    setInteractionError('')
  }

  async function handleToggleLike(highlightId) {
    if (!canInteract || likingId) return
    setLikingId(highlightId)
    setInteractionError('')

    const { error } = await supabase.rpc('toggle_match_highlight_like', {
      p_highlight_id: highlightId,
    })
    setLikingId(null)

    if (error) {
      setInteractionError(toInteractionError(error, 'تعذر تحديث الإعجاب.'))
      return
    }
    await queryClient.invalidateQueries({ queryKey: ['highlight-likes', matchId] })
  }

  async function handleSubmitComment(event) {
    event.preventDefault()
    if (!canInteract || !openCommentsId || !commentDraft.trim()) return

    setCommentBusy(true)
    setInteractionError('')
    const { error } = await supabase.rpc('add_match_highlight_comment', {
      p_highlight_id: openCommentsId,
      p_body: commentDraft.trim(),
    })
    setCommentBusy(false)

    if (error) {
      setInteractionError(toInteractionError(error, 'تعذر إضافة التعليق.'))
      return
    }
    setCommentDraft('')
    await queryClient.invalidateQueries({ queryKey: ['highlight-comments', matchId] })
  }

  async function handleDeleteComment(comment) {
    setInteractionError('')
    const { error } = await supabase.rpc('delete_match_highlight_comment', {
      p_comment_id: comment.id,
    })
    if (error) {
      setInteractionError(toInteractionError(error, 'تعذر حذف التعليق.'))
      return
    }
    await queryClient.invalidateQueries({ queryKey: ['highlight-comments', matchId] })
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
          const comments = commentsByHighlight.get(highlight.id) ?? []
          const likeCount = likesByHighlight.get(highlight.id) ?? 0
          const isLiked = likedIds.has(highlight.id)
          const commentsOpen = openCommentsId === highlight.id
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

              <div className="flex items-center gap-1.5 border-t border-white/10 px-3 py-2">
                <button
                  type="button"
                  onClick={() => void handleToggleLike(highlight.id)}
                  disabled={!canInteract || likingId === highlight.id}
                  aria-pressed={isLiked}
                  aria-label={isLiked ? 'إلغاء الإعجاب' : 'إعجاب'}
                  className={`inline-flex min-h-9 items-center gap-1.5 rounded-xl px-2.5 text-[11px] font-bold transition-colors disabled:opacity-50 ${isLiked ? 'bg-red-400/15 text-red-200' : 'text-white/50 hover:bg-white/5 hover:text-white'}`}
                >
                  {likingId === highlight.id ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <Heart className={`size-3.5 ${isLiked ? 'fill-current' : ''}`} />
                  )}
                  {likeCount}
                </button>
                <button
                  type="button"
                  onClick={() => toggleComments(highlight.id)}
                  aria-expanded={commentsOpen}
                  aria-label="التعليقات"
                  className={`inline-flex min-h-9 items-center gap-1.5 rounded-xl px-2.5 text-[11px] font-bold transition-colors ${commentsOpen ? 'bg-brand-400/15 text-brand-200' : 'text-white/50 hover:bg-white/5 hover:text-white'}`}
                >
                  <MessageCircle className="size-3.5" />
                  {comments.length}
                </button>
              </div>

              {commentsOpen ? (
                <div className="border-t border-white/10 bg-pitch-950/30 p-3">
                  {comments.length ? (
                    <div className="space-y-2">
                      {comments.map((comment) => {
                        const author = authorById.get(comment.user_id)
                        return (
                          <div key={comment.id} className="rounded-xl border border-white/10 bg-white/[0.03] p-2.5">
                            <div className="flex items-center justify-between gap-2">
                              <div className="flex min-w-0 items-center gap-2">
                                <span className="grid size-7 shrink-0 place-items-center rounded-full bg-brand-400/10 text-[10px] font-black text-brand-300">
                                  {author?.full_name?.trim()?.charAt(0) ?? '؟'}
                                </span>
                                <span className="truncate text-[11px] font-extrabold text-sand-100">
                                  {author?.full_name ?? 'لاعب'}
                                </span>
                                <span className="shrink-0 text-[10px] text-white/35" dir="ltr">
                                  {formatHighlightDate(comment.created_at)}
                                </span>
                              </div>
                              {canInteract && (comment.user_id === profile?.id || isAdmin) ? (
                                <button
                                  type="button"
                                  onClick={() => void handleDeleteComment(comment)}
                                  className="grid size-8 shrink-0 place-items-center rounded-lg text-white/35 transition-colors hover:text-red-300"
                                  aria-label="حذف التعليق"
                                >
                                  <Trash2 className="size-3.5" />
                                </button>
                              ) : null}
                            </div>
                            <p className="mt-1.5 whitespace-pre-wrap break-words text-[11px] leading-5 text-white/70">
                              {comment.body}
                            </p>
                          </div>
                        )
                      })}
                    </div>
                  ) : (
                    <p className="py-2 text-center text-[11px] text-white/40">لا توجد تعليقات بعد. كن أول من يعلّق.</p>
                  )}

                  {canInteract ? (
                    <form onSubmit={handleSubmitComment} className="mt-3 flex items-end gap-2">
                      <input
                        type="text"
                        value={commentDraft}
                        onChange={(event) => setCommentDraft(event.target.value)}
                        maxLength={500}
                        placeholder="اكتب تعليقًا…"
                        aria-label="تعليق جديد"
                        className="min-h-10 w-full rounded-xl border border-white/10 bg-pitch-950/60 px-3 py-2 text-xs font-semibold text-sand-100 outline-none placeholder:text-white/25 focus:border-brand-400/50"
                      />
                      <button
                        type="submit"
                        disabled={commentBusy || !commentDraft.trim()}
                        className="grid size-10 shrink-0 place-items-center rounded-xl bg-brand-400 text-pitch-950 transition-colors hover:bg-brand-300 disabled:opacity-50"
                        aria-label="إرسال التعليق"
                      >
                        {commentBusy ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
                      </button>
                    </form>
                  ) : (
                    <p className="mt-2 text-center text-[10px] text-white/35">التعليق متاح للاعبين الموافق عليهم فقط.</p>
                  )}
                </div>
              ) : null}
            </Card>
          )
        })}
      </div>

      {interactionError ? (
        <p role="alert" className="mt-3 rounded-xl border border-red-400/20 bg-red-400/[0.06] px-4 py-3 text-xs leading-6 text-red-200">
          {interactionError}
        </p>
      ) : null}

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
