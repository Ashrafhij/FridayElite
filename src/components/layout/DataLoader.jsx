import { useIsFetching } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'

// Shows a full-screen overlay whenever React Query is fetching data (e.g. after
// navigating to a new page). This prevents the flash of empty/default content
// before the real data arrives.
export default function DataLoader() {
  const isFetching = useIsFetching()
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    // Small debounce so very fast fetches don't cause a flicker.
    const timer = setTimeout(() => setVisible(isFetching > 0), 80)
    return () => clearTimeout(timer)
  }, [isFetching])

  if (!visible) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-pitch-950/90 backdrop-blur-sm"
      aria-label="جارٍ التحميل"
      role="status"
    >
      <div className="flex flex-col items-center gap-3 rounded-2xl border border-white/10 bg-pitch-900/90 p-6 shadow-2xl">
        <Loader2 className="size-6 animate-spin text-brand-400" />
        <p className="text-sm font-semibold text-sand-100">جارٍ تحميل البيانات…</p>
      </div>
    </div>
  )
}
