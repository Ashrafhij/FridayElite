import { NavLink } from 'react-router-dom'
import { getNavItems } from '../../lib/navigation'
import { useAuth } from '../../context/AuthContext'

export default function BottomNav() {
  const { profile } = useAuth()
  const navItems = getNavItems(profile)

  if (navItems.length === 0) return null

  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-40 border-t border-white/5 bg-pitch-950/95 backdrop-blur-md md:hidden"
      aria-label="التنقل السفلي"
    >
      <div
        className="safe-bottom mx-auto grid w-full max-w-md gap-1 px-2 py-1.5"
        style={{ gridTemplateColumns: `repeat(${navItems.length}, minmax(0, 1fr))` }}
      >
        {navItems.map(({ to, label, shortLabel, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) =>
              `flex min-h-14 flex-col items-center justify-center gap-1 rounded-2xl px-1.5 py-2 text-[11px] font-semibold transition-colors ${
                isActive ? 'bg-brand-400/10 text-brand-300' : 'text-white/50 hover:text-white/80'
              }`
            }
          >
            {({ isActive }) => (
              <>
                <Icon className="size-5" strokeWidth={isActive ? 2.4 : 2} />
                <span className="whitespace-nowrap">{shortLabel ?? label}</span>
              </>
            )}
          </NavLink>
        ))}
      </div>
    </nav>
  )
}
