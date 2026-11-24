import { toArabicError } from './errorMessages'

const MAX_IMAGE_BYTES = 10 * 1024 * 1024
const MAX_VIDEO_BYTES = 50 * 1024 * 1024

const MIME_BY_EXTENSION = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  mp4: 'video/mp4',
  webm: 'video/webm',
  mov: 'video/quicktime',
}

/**
 * Validates a highlight file and returns everything needed for the upload.
 * The server RPC repeats these checks so a direct Storage call cannot register
 * an unsupported file as a match highlight.
 */
export function prepareHighlight(file) {
  if (!file) throw new Error('HIGHLIGHT_REQUIRED')

  const extension = String(file.name ?? '').split('.').pop()?.toLowerCase() ?? ''
  const contentType = MIME_BY_EXTENSION[extension]
  if (!contentType) throw new Error('INVALID_HIGHLIGHT_TYPE')

  const reportedType = String(file.type ?? '').toLowerCase()
  if (
    reportedType &&
    reportedType !== contentType &&
    reportedType !== 'application/octet-stream'
  ) {
    throw new Error('INVALID_HIGHLIGHT_TYPE')
  }

  const mediaType = contentType.startsWith('video/') ? 'video' : 'image'
  const maxBytes = mediaType === 'video' ? MAX_VIDEO_BYTES : MAX_IMAGE_BYTES
  if (!file.size || file.size > maxBytes) throw new Error('HIGHLIGHT_TOO_LARGE')

  const suffix = Math.random().toString(36).slice(2, 10)
  const safeExtension = extension === 'jpeg' ? 'jpg' : extension
  return {
    file,
    mediaType,
    contentType,
    fileName: `${Date.now()}-${suffix}.${safeExtension}`,
  }
}

/** Friendly Arabic message when the highlights bucket has not been created. */
export function toHighlightError(error) {
  const raw = typeof error === 'string' ? error : error?.message ?? ''
  if (/bucket not found/i.test(raw)) {
    return 'مساحة مقاطع المباراة غير مهيأة. طبّق تحديث قاعدة البيانات 0037 أولًا.'
  }
  return toArabicError(error, 'تعذر رفع المقطع. حاول مرة أخرى.')
}

export function formatHighlightSize(bytes) {
  const value = Number(bytes)
  if (!Number.isFinite(value) || value <= 0) return '—'
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} كيلوبايت`
  return `${(value / (1024 * 1024)).toFixed(1)} ميجابايت`
}
