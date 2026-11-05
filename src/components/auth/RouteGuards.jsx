import { Navigate, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { LogOut, ShieldAlert } from 'lucide-react'
import { useAuth } from '../../context/AuthContext'
import Card from '../ui/Card'

export function AuthLoading({ compact = false }) {
  return (
    <div
      className={`flex flex-col items-center justify-center text-center ${
        compact ? 'min-h-[55vh]' : 'min-h-dvh'
      }`}
      role="status"
      aria-live="polite"
    >
      <span className="size-10 animate-spin rounded-full border-2 border-white/15 border-t-brand-400" />
      <p className="mt-4 text-sm font-semibold text-white/55">جارٍ التحقق من الحساب…</p>
    </div>
  )
}

export function ProfileUnavailable() {
  const { signOut, error } = useAuth()
  const navigate = useNavigate()

  async function handleSignOut() {
    try {
      await signOut()
    } finally {
      navigate('/login', { replace: true })
    }
  }

  return (
    <div className="flex min-h-[55vh] items-center justify-center">
      <Card className="w-full max-w-lg p-6 text-center sm:p-8">
        <span className="mx-auto grid size-14 place-items-center rounded-2xl border border-amber-400/20 bg-amber-400/10 text-amber-300">
          <ShieldAlert className="size-6" />
        </span>
        <h1 className="mt-5 text-xl font-extrabold text-sand-100">تعذر تحميل الملف الشخصي</h1>
        <p className="mt-2 text-sm leading-7 text-white/55">
          {error || 'الحساب موجود، لكن تعذر العثور على ملف اللاعب المرتبط به. تواصل مع إدارة المجموعة.'}
        </p>
        <button
          type="button"
          onClick={handleSignOut}
          className="mt-6 inline-flex items-center justify-center gap-2 rounded-2xl bg-brand-400 px-5 py-3 text-sm font-extrabold text-pitch-950"
        >
          <LogOut className="size-4" />
          تسجيل الخروج
        </button>
      </Card>
    </div>
  )
}

export function RequireAuth() {
  const { session, loading } = useAuth()
  const location = useLocation()

  if (loading) return <AuthLoading />
  if (!session) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />
  }

  return <Outlet />
}

export function RequireApproved() {
  const { profile, loading } = useAuth()

  if (loading) return <AuthLoading compact />
  if (!profile) return <ProfileUnavailable />
  if (profile.status !== 'approved') {
    return <Navigate to="/account-status" replace />
  }

  return <Outlet />
}

export function RequireProfileAccess() {
  const { profile, loading } = useAuth()

  if (loading) return <AuthLoading compact />
  if (!profile) return <ProfileUnavailable />
  if (!['pending', 'approved'].includes(profile.status)) {
    return <Navigate to="/account-status" replace />
  }

  return <Outlet />
}

export function RequireAdmin() {
  const { profile, isAdmin, loading } = useAuth()

  if (loading) return <AuthLoading compact />
  if (!profile) return <ProfileUnavailable />
  if (!isAdmin) return <Navigate to="/" replace />

  return <Outlet />
}

export function PublicOnly() {
  const { session, profile, loading } = useAuth()

  if (loading) return <AuthLoading />
  if (session) {
    return <Navigate to={profile?.status === 'approved' ? '/' : '/account-status'} replace />
  }

  return <Outlet />
}
