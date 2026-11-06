import { useEffect, useState } from 'react'
import { Link, NavLink, useNavigate } from 'react-router-dom'
import { Bell, Loader2, LogOut } from 'lucide-react'
import BrandMark from './BrandMark'
import { getNavItems } from '../../lib/navigation'
import { useAuth } from '../../context/AuthContext'

function formatNotificationTime(value) {
  if (!value) return ''
  return new Intl.DateTimeFormat('ar', {
    dateStyle: 'short',
    timeStyle: 'short',
    timeZone: 'Asia/Jerusalem',
  }).format(new Date(value))
}

export default function Header() {
  const { profile, notifications, unreadNotificationCount, markNotificationRead, signOut } = useAuth()
  const navigate = useNavigate()
  const [signingOut, setSigningOut] = useState(false)
  const [notificationsOpen, setNotificationsOpen] = useState(false)

  const navItems = getNavItems(profile)
  const canEditProfile = profile && ['pending', 'approved'].includes(profile.status)
  const accountHref = canEditProfile ? '/profile' : '/account-status'
  const initial = profile?.full_name?.trim()?.charAt(0) || '؟'

  useEffect(() => {
    if (!notificationsOpen) return undefined
    function handleKeyDown(event) {
      if (event.key === 'Escape') setNotificationsOpen(false)
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [notificationsOpen])

  async function handleSignOut() {
    setSigningOut(true)
    try {
      await signOut()
    } finally {
      setSigningOut(false)
      navigate('/login', { replace: true })
    }
  }

  async function handleNotificationClick(notification) {
    await markNotificationRead(notification.id)
    setNotificationsOpen(false)
    if (notification.match_id) {
      navigate(`/matches/${notification.match_id}`)
    }
  }

  function handleMarkAllNotificationsRead() {
    const unread = (notifications ?? []).filter((notification) => !notification.read_at)
    void Promise.all(unread.map((notification) => markNotificationRead(notification.id)))
    setNotificationsOpen(false)
  }

  return (
    <header className="safe-top sticky top-0 z-40 border-b border-white/5 bg-pitch-950/90 backdrop-blur-md sm:bg-pitch-950/75 sm:backdrop-blur-xl">
      <div className="mx-auto flex h-16 w-full max-w-6xl items-center gap-3 px-4 sm:px-6">
        <Link
          to="/"
          className="flex min-h-11 shrink-0 items-center gap-2.5"
          aria-label="فرايدي إيليت — الرئيسية"
        >
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
              className="flex min-h-11 items-center gap-2 rounded-full border border-white/10 bg-white/5 py-1 pe-3 ps-1 transition-colors hover:border-brand-400/40"
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

          {profile ? (
            <div className="relative">
              <button
                type="button"
                onClick={() => setNotificationsOpen((open) => !open)}
                aria-label="الإشعارات"
                aria-expanded={notificationsOpen}
                aria-haspopup="true"
                className="relative grid size-11 place-items-center rounded-full border border-white/10 bg-white/5 text-white/60 transition-colors hover:border-brand-400/40 hover:text-brand-200"
              >
                <Bell className="size-4" />
                {unreadNotificationCount > 0 ? (
                  <span className="absolute -top-0.5 -end-0.5 grid min-w-5 place-items-center rounded-full bg-brand-400 px-1 py-0.5 text-[10px] leading-none font-black text-pitch-950">
                    {unreadNotificationCount}
                  </span>
                ) : null}
              </button>

              {notificationsOpen ? (
                <div className="absolute end-0 top-full z-50 mt-3 w-[min(360px,calc(100vw-2rem))] overflow-hidden rounded-3xl border border-white/10 bg-pitch-900/95 shadow-glow backdrop-blur-xl">
                  <div className="flex items-center justify-between gap-3 border-b border-white/10 px-4 py-3">
                    <p className="text-sm font-extrabold text-sand-100">الإشعارات</p>
                    {unreadNotificationCount > 0 ? (
                      <button
                        type="button"
                        onClick={handleMarkAllNotificationsRead}
                        className="text-[11px] font-bold text-brand-300 transition-colors hover:text-brand-200"
                      >
                        تحديد الكل كمقروء
                      </button>
                    ) : null}
                  </div>

                  <div className="max-h-[55vh] overflow-y-auto p-2">
                    {notifications.length ? (
                      notifications.map((notification) => (
                        <button
                          key={notification.id}
                          type="button"
                          onClick={() => void handleNotificationClick(notification)}
                          className="flex w-full items-start gap-3 rounded-2xl px-3 py-3 text-start transition-colors hover:bg-white/5"
                        >
                          <span
                            className={`mt-1.5 size-2 shrink-0 rounded-full ${notification.read_at ? 'bg-white/20' : 'bg-brand-400'}`}
                            aria-hidden="true"
                          />
                          <span className="min-w-0 flex-1">
                            <span className="block text-xs font-extrabold text-sand-100">
                              {notification.title_ar}
                            </span>
                            {notification.body_ar ? (
                              <span className="mt-1 block text-[11px] leading-5 text-white/55">
                                {notification.body_ar}
                              </span>
                            ) : null}
                            <span className="mt-1 block text-[10px] text-white/35">
                              {formatNotificationTime(notification.created_at)}
                            </span>
                          </span>
                        </button>
                      ))
                    ) : (
                      <p className="px-3 py-6 text-center text-xs leading-6 text-white/45">
                        لا توجد إشعارات بعد.
                      </p>
                    )}
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}

          <button
            type="button"
            onClick={handleSignOut}
            disabled={signingOut}
            className="grid size-11 place-items-center rounded-full border border-white/10 bg-white/5 text-white/60 transition-colors hover:border-red-400/30 hover:text-red-300 disabled:opacity-60"
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
