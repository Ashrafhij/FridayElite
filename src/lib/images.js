const MAX_FILE_BYTES = 5 * 1024 * 1024
const MAX_DIMENSION = 512

/**
 * Accepted MIME types for avatar upload.
 * HEIC/HEIF are handled by conversion during prepareAvatar.
 */
const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']

/**
 * Supported file extensions (lowercased) for the file input accept attribute.
 * Added HEIC/HEIF to match what Android cameras produce.
 */
const SUPPORTED_EXTENSIONS = ['jpg', 'jpeg', 'png', 'webp', 'heic', 'heif']

function getFileExtension(fileName) {
  if (!fileName) return ''
  const dotIndex = fileName.lastIndexOf('.')
  if (dotIndex === -1) return ''
  return fileName.slice(dotIndex + 1).toLowerCase()
}

function getFileMIMEType(file) {
  if (!file || !file.type) return ''
  return file.type.toLowerCase()
}

/**
 * Checks if a file has a supported type/extension.
 * For Android HEIC/HEIF images, we allow them through but they'll be
 * converted to JPEG during preparation.
 */
function isSupportedFile(file) {
  if (!file) return false

  const mime = getFileMIMEType(file).toLowerCase()
  const ext = getFileExtension(file.name).toLowerCase()

  // Check by MIME type
  if (ACCEPTED_TYPES.includes(mime)) return true

  // Check by extension (catches HEIC/HEIF which may have unknown MIME types)
  if (SUPPORTED_EXTENSIONS.includes(ext)) return true

  return false
}

/**
 * Converts an image to a supported format (JPEG) if needed.
 * Handles HEIC/HEIF and other formats that createImageBitmap may not support.
 */
async function convertToJPEGBitmap(file) {
  // Try using createImageBitmap first (works for most formats including HEIC in modern browsers)
  try {
    const bitmap = await createImageBitmap(file)

    // Create a canvas and draw the bitmap
    const canvas = document.createElement('canvas')
    const width = bitmap.width
    const height = bitmap.height

    // Scale down if larger than MAX_DIMENSION
    const scale = Math.min(1, MAX_DIMENSION / Math.max(width, height))
    const targetWidth = Math.max(1, Math.round(width * scale))
    const targetHeight = Math.max(1, Math.round(height * scale))

    canvas.width = targetWidth
    canvas.height = targetHeight

    const context = canvas.getContext('2d')
    if (!context) throw new Error('CONTEXT_FAILED')

    // Fill with dark background to match app theme
    context.fillStyle = '#0a0f0d'
    context.fillRect(0, 0, targetWidth, targetHeight)

    // Draw the bitmap - if orientation is wrong, the browser may handle it,
    // but we also try with imageOrientation: from-image
    context.drawImage(bitmap, 0, 0, targetWidth, targetHeight)

    // Convert to JPEG blob
    const blob = await new Promise((resolve) => {
      canvas.toBlob((b) => resolve(b), 'image/jpeg', 0.85)
    })

    if (!blob) throw new Error('BLOB_FAILED')

    if (typeof bitmap.close === 'function') bitmap.close()

    return { blob, width: targetWidth, height: targetHeight }
  } catch (createError) {
    // createImageBitmap failed, fall back to the Image element approach
    return null
  }
}

/**
 * Validates and shrinks a profile photo before upload.
 * Returns a JPEG Blob capped at 512px on the longest side.
 * Handles HEIC/HEIF images from Android cameras.
 */
export async function prepareAvatar(file) {
  if (!file) throw new Error('IMAGE_REQUIRED')

  // Check if file type is supported (by MIME or extension)
  if (!isSupportedFile(file)) {
    throw new Error('INVALID_IMAGE_TYPE')
  }

  if (file.size > MAX_FILE_BYTES) {
    throw new Error('IMAGE_TOO_LARGE')
  }

  // Try to convert using createImageBitmap first
  const converted = await convertToJPEGBitmap(file)

  if (converted) {
    // Return the converted blob directly
    if (converted.blob.size > MAX_FILE_BYTES) throw new Error('IMAGE_TOO_LARGE')
    return converted.blob
  }

  // Fallback: use the original loadBitmap approach
  let source
  try {
    source = await loadBitmap(file)
  } catch (error) {
    throw new Error('IMAGE_PROCESSING_FAILED')
  }

  const width = source.width
  const height = source.height

  if (!width || !height) {
    if (typeof source.close === 'function') source.close()
    throw new Error('IMAGE_PROCESSING_FAILED')
  }

  const scale = Math.min(1, MAX_DIMENSION / Math.max(width, height))
  const targetWidth = Math.max(1, Math.round(width * scale))
  const targetHeight = Math.max(1, Math.round(height * scale))

  const canvas = document.createElement('canvas')
  canvas.width = targetWidth
  canvas.height = targetHeight

  const context = canvas.getContext('2d')
  if (!context) {
    if (typeof source.close === 'function') source.close()
    throw new Error('IMAGE_PROCESSING_FAILED')
  }

  // Match the dark app background so transparent PNGs do not show black/white.
  context.fillStyle = '#0a0f0d'
  context.fillRect(0, 0, targetWidth, targetHeight)
  context.drawImage(source, 0, 0, targetWidth, targetHeight)

  if (typeof source.close === 'function') source.close()

  const blob = await new Promise((resolve) => {
    canvas.toBlob(resolve, 'image/jpeg', 0.85)
  })

  if (!blob) {
    throw new Error('IMAGE_PROCESSING_FAILED')
  }

  if (blob.size > MAX_FILE_BYTES) throw new Error('IMAGE_TOO_LARGE')

  return blob
}
