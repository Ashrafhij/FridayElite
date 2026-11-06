const MAX_FILE_BYTES = 5 * 1024 * 1024
const MAX_DIMENSION = 512
const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp']

function loadBitmap(file) {
  if (typeof createImageBitmap === 'function') {
    try {
      return createImageBitmap(file, { imageOrientation: 'from-image' }).catch(() =>
        createImageBitmap(file)
      )
    } catch {
      return createImageBitmap(file)
    }
  }

  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file)
    const image = new Image()

    image.onload = () => {
      URL.revokeObjectURL(objectUrl)
      resolve(image)
    }
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl)
      reject(new Error('IMAGE_PROCESSING_FAILED'))
    }
    image.src = objectUrl
  })
}

/**
 * Validates and shrinks a profile photo before upload.
 * Returns a JPEG Blob capped at 512px on the longest side.
 */
export async function prepareAvatar(file) {
  if (!file) throw new Error('IMAGE_REQUIRED')

  if (file.type && !ACCEPTED_TYPES.includes(file.type)) {
    throw new Error('INVALID_IMAGE_TYPE')
  }

  if (file.size > MAX_FILE_BYTES) {
    throw new Error('IMAGE_TOO_LARGE')
  }

  const source = await loadBitmap(file)
  const width = source.width
  const height = source.height

  if (!width || !height) {
    throw new Error('IMAGE_PROCESSING_FAILED')
  }

  const scale = Math.min(1, MAX_DIMENSION / Math.max(width, height))
  const targetWidth = Math.max(1, Math.round(width * scale))
  const targetHeight = Math.max(1, Math.round(height * scale))

  const canvas = document.createElement('canvas')
  canvas.width = targetWidth
  canvas.height = targetHeight

  const context = canvas.getContext('2d')
  if (!context) throw new Error('IMAGE_PROCESSING_FAILED')

  // Match the dark app background so transparent PNGs do not show black/white.
  context.fillStyle = '#0a0f0d'
  context.fillRect(0, 0, targetWidth, targetHeight)
  context.drawImage(source, 0, 0, targetWidth, targetHeight)

  if (typeof source.close === 'function') source.close()

  const blob = await new Promise((resolve) => {
    canvas.toBlob(resolve, 'image/jpeg', 0.85)
  })

  if (!blob) throw new Error('IMAGE_PROCESSING_FAILED')
  if (blob.size > MAX_FILE_BYTES) throw new Error('IMAGE_TOO_LARGE')

  return blob
}
