import { useState } from 'react'
import { Link, NavLink, useNavigate } from 'react-router-dom'
import { Loader2, LogOut } from 'lucide-react'
import BrandMark from './BrandMark'
import { getNavItems } from '../../lib/navigation'
import { useAuth } from '../../context/AuthContext'

export default function Header() {
  const { profile, signOut } = useAuth()
  const navigate = useNavigate()
  const [signingOut, setSigningOut] = useState(false)

  const navItems = getNavItems(profile)
  const canEditProfile = profile && ['pending', 'approved'].includes(profile.status)
  const accountHref = canEditProfile ? '/profile' : '/account-status'
  const initial = profile?.full_name?.trim()?.charAt(0) || '؟'

  async function handleSignOut() {
    setSigningOut(true)
    try {
      await signOut()
    } finally {
      setSigningOut(false)
      navigate('/login', { replace: true })
    }
  }

  return (
    <header className="sticky top-0 z-40 border-b border-white/5 bg-pitch-950/75 backdrop-blur-xl">
      <div className="mx-auto flex h-16 w-full max-w-6xl items-center gap-3 px-4 sm:px-6">
        <Link to="/" className="flex shrink-0 items-center gap-2.5" aria-label="فرايدي إيليت — الرئيسية">
          <BrandMark />
          <span className="flex flex-col leading-none">
            <span className="text-[15px] font-extrabold tracking-tight text-sand-100">
              فرايدي إيليت
            </span>
            <span className="mt-1 text-[10px] font-semibold uppercase tracking-[0.28em] text-brand-400/80">
              Friday Elite
            </span>
          </span>
        </Link>

        <nav className="ms-auto hidden items-center gap-1 md:flex" aria-label="التنقل الرئيسي">
          {navItems.map(({ to, label, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                `rounded-full px-4 py-2 text-sm font-semibold transition-colors ${
                  isActive
                    ? 'bg-white/8 text-brand-300'
                    : 'text-white/55 hover:bg-white/5 hover:text-white'
                }`
              }
            >
              {label}
            </NavLink>
          ))}
        </nav>

        <div className="ms-auto flex items-center gap-2 md:ms-3">
          {profile ? (
            <Link
              to={accountHref}
              className="flex items-center gap-2 rounded-full border border-white/10 bg-white/5 py-1 pe-3 ps-1 transition-colors hover:border-brand-400/40"
              aria-label="فتح حسابي"
            >
              <span className="relative grid size-8 place-items-center overflow-hidden rounded-full bg-brand-400/15 text-sm font-black text-brand-300">
                {initial}
                {profile.avatar_url ? (
                  <img
                    src={profile.avatar_url}
                    alt=""
                    loading="lazy"
                    decoding="async"
                    className="absolute inset-0 size-8 object-cover"
                    onError={(event) => {
                      event.currentTarget.style.display = 'none'
                    }}
                  />
                ) : null}
              </span>
              <span className="hidden max-w-32 truncate text-xs font-bold text-white/65 sm:block">
                {profile.full_name}
              </span>
            </Link>
          ) : null}

          <button
            type="button"
            onClick={handleSignOut}
            disabled={signingOut}
            className="grid size-10 place-items-center rounded-full border border-white/10 bg-white/5 text-white/60 transition-colors hover:border-red-400/30 hover:text-red-300 disabled:opacity-60"
            aria-label="تسجيل الخروج"
            title="تسجيل الخروج"
          >
            {signingOut ? <Loader2 className="size-4 animate-spin" /> : <LogOut className="size-4" />}
          </button>
        </div>
      </div>
    </header>
  )
}
