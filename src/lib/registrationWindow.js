export const REGISTRATION_TIME_ZONE = 'Asia/Jerusalem'

const WEEKDAY_NUMBERS = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
}

function getZonedParts(date, timeZone = REGISTRATION_TIME_ZONE) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
    weekday: 'short',
  }).formatToParts(date)

  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  return {
    year: Number(value.year),
    month: Number(value.month),
    day: Number(value.day),
    hour: Number(value.hour) % 24,
    minute: Number(value.minute),
    second: Number(value.second),
    weekday: WEEKDAY_NUMBERS[value.weekday] ?? 0,
  }
}

function addDaysToLocalDate({ year, month, day }, delta) {
  const date = new Date(Date.UTC(year, month - 1, day + delta))
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
  }
}

function zonedTimeToUtc(localParts, timeZone = REGISTRATION_TIME_ZONE) {
  const target = Date.UTC(
    localParts.year,
    localParts.month - 1,
    localParts.day,
    localParts.hour,
    localParts.minute,
    localParts.second ?? 0,
  )

  let offset = 0
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const candidate = target - offset
    const zoned = getZonedParts(new Date(candidate), timeZone)
    const represented = Date.UTC(
      zoned.year,
      zoned.month - 1,
      zoned.day,
      zoned.hour,
      zoned.minute,
      zoned.second,
    )
    const nextOffset = represented - candidate
    if (nextOffset === offset) break
    offset = nextOffset
  }

  return new Date(target - offset)
}

function buildWindow(friday) {
  const thursday = addDaysToLocalDate(friday, -1)

  return {
    openAt: zonedTimeToUtc({ ...thursday, hour: 10, minute: 0, second: 0 }),
    closeAt: zonedTimeToUtc({ ...friday, hour: 20, minute: 0, second: 0 }),
  }
}

/**
 * Returns the weekly one-slot registration window displayed by the app:
 * Thursday 10:00 local time until Friday 20:00 local time.
 */
export function getRegistrationWindow(now = new Date()) {
  const parts = getZonedParts(now)
  const daysSinceFriday = (parts.weekday - 5 + 7) % 7
  const recentFriday = addDaysToLocalDate(
    { year: parts.year, month: parts.month, day: parts.day },
    -daysSinceFriday,
  )

  const windows = [-7, 0, 7].map((delta) =>
    buildWindow(addDaysToLocalDate(recentFriday, delta)),
  )

  const currentWindow =
    windows.find((window) => now >= window.openAt && now < window.closeAt) ?? null
  const nextWindow =
    windows.find((window) => window.openAt > now) ?? buildWindow(addDaysToLocalDate(recentFriday, 14))

  return {
    isOpen: Boolean(currentWindow),
    currentWindow,
    nextWindow,
    activeWindow: currentWindow ?? nextWindow,
    timeZone: REGISTRATION_TIME_ZONE,
  }
}

export function formatRegistrationDateTime(date) {
  return new Intl.DateTimeFormat('ar', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: REGISTRATION_TIME_ZONE,
  }).format(date)
}
