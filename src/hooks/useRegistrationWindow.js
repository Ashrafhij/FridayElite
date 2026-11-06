import { useEffect, useState } from 'react'
import { getRegistrationWindow } from '../lib/registrationWindow'

export function useRegistrationWindow(updateIntervalMs = 30_000) {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), updateIntervalMs)
    return () => clearInterval(timer)
  }, [updateIntervalMs])

  return getRegistrationWindow(new Date(now))
}
