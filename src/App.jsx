import { Component, lazy, Suspense } from 'react'
import { Route, Routes, useLocation } from 'react-router-dom'
import AppShell from './components/layout/AppShell'
import Card from './components/ui/Card'
import {
  AuthLoading,
  PublicOnly,
  RequireAdmin,
  RequireApproved,
  RequireAuth,
  RequireProfileAccess,
} from './components/auth/RouteGuards'

// Each page is loaded only when its route is visited. This keeps the first
// screen small on mobile instead of downloading the admin and profile pages
// before the player can even log in.
//
// After a new deployment the hashed chunk file names change, so a tab that
// was open before the deploy can reference a chunk that no longer exists
// (404 "Failed to fetch dynamically imported module"). When that happens we
// reload once with a cache-busting query parameter. The guard is time-based
// (not a sticky session flag) so repeated deploys during one session recover
// as well, while a real 404 can never cause an infinite reload loop.
const CHUNK_RELOAD_KEY = 'friday-elite-chunk-reload-at'
const CHUNK_RELOAD_COOLDOWN_MS = 30_000

function reloadOnceAfterCacheBust() {
  const last = Number(window.sessionStorage.getItem(CHUNK_RELOAD_KEY) || 0)
  const now = Date.now()
  if (now - last < CHUNK_RELOAD_COOLDOWN_MS) return false
  window.sessionStorage.setItem(CHUNK_RELOAD_KEY, String(now))
  const url = new URL(window.location.href)
  url.searchParams.set('v', String(now))
  window.location.replace(url.href)
  return true
}

function forceReloadWithCacheBust() {
  const url = new URL(window.location.href)
  url.searchParams.set('v', String(Date.now()))
  window.location.replace(url.href)
}

function lazyWithReload(factory) {
  return lazy(async () => {
    try {
      return await factory()
    } catch (error) {
      if (reloadOnceAfterCacheBust()) {
        return { default: () => null }
      }
      throw error
    }
  })
}

class ChunkErrorBoundary extends Component {
  state = { hasError: false }

  static getDerivedStateFromError() {
    return { hasError: true }
  }

  componentDidCatch() {
    reloadOnceAfterCacheBust()
  }

  render() {
    if (!this.state.hasError) return this.props.children
    return (
      <Card className="mx-auto max-w-md p-6 text-center">
        <p className="text-base font-extrabold text-sand-100">تعذر تحميل الصفحة</p>
        <p className="mt-2 text-sm leading-7 text-white/55">
          تم نشر تحديث جديد للموقع والتحديث الحالي لا يتوافق مع نسختك المفتوحة. حدّث الصفحة لتحميل النسخة الجديدة.
        </p>
        <button
          type="button"
          onClick={forceReloadWithCacheBust}
          className="mt-4 inline-flex min-h-11 items-center justify-center rounded-2xl bg-brand-400 px-5 py-3 text-sm font-extrabold text-pitch-950 transition-colors hover:bg-brand-300"
        >
          تحديث الصفحة
        </button>
      </Card>
    )
  }
}

const AccountStatus = lazyWithReload(() => import('./pages/AccountStatus'))
const Admin = lazyWithReload(() => import('./pages/Admin'))
const Dashboard = lazyWithReload(() => import('./pages/Dashboard'))
const JoinMatch = lazyWithReload(() => import('./pages/JoinMatch'))
const Login = lazyWithReload(() => import('./pages/Login'))
const MatchDetails = lazyWithReload(() => import('./pages/MatchDetails'))
const MatchResult = lazyWithReload(() => import('./pages/MatchResult'))
const Matches = lazyWithReload(() => import('./pages/Matches'))
const NotFound = lazyWithReload(() => import('./pages/NotFound'))
const Profile = lazyWithReload(() => import('./pages/Profile'))
const Signup = lazyWithReload(() => import('./pages/Signup'))

function LazyPage({ children, full = false }) {
  const { pathname } = useLocation()
  return (
    <ChunkErrorBoundary key={pathname}>
      <Suspense fallback={<AuthLoading compact={!full} />}>{children}</Suspense>
    </ChunkErrorBoundary>
  )
}

export default function App() {
  return (
    <Routes>
      {/* Public invite page: the admin shares this link so players can register
          with their phone number without signing in first. */}
      <Route
        path="/join/:matchId"
        element={
          <LazyPage full>
            <JoinMatch />
          </LazyPage>
        }
      />

      <Route element={<PublicOnly />}>
        <Route
          path="/login"
          element={
            <LazyPage full>
              <Login />
            </LazyPage>
          }
        />
        <Route
          path="/signup"
          element={
            <LazyPage full>
              <Signup />
            </LazyPage>
          }
        />
      </Route>

      <Route element={<RequireAuth />}>
        <Route element={<AppShell />}>
          <Route
            path="account-status"
            element={
              <LazyPage>
                <AccountStatus />
              </LazyPage>
            }
          />

          <Route element={<RequireProfileAccess />}>
            <Route
              path="profile"
              element={
                <LazyPage>
                  <Profile />
                </LazyPage>
              }
            />
          </Route>

          <Route element={<RequireApproved />}>
            <Route
              index
              element={
                <LazyPage>
                  <Dashboard />
                </LazyPage>
              }
            />
            <Route
              path="matches"
              element={
                <LazyPage>
                  <Matches />
                </LazyPage>
              }
            />
            <Route
              path="matches/:matchId"
              element={
                <LazyPage>
                  <MatchDetails />
                </LazyPage>
              }
            />
            <Route
              path="matches/:matchId/result"
              element={
                <LazyPage>
                  <MatchResult />
                </LazyPage>
              }
            />
          </Route>

          <Route element={<RequireAdmin />}>
            <Route
              path="admin"
              element={
                <LazyPage>
                  <Admin />
                </LazyPage>
              }
            />
          </Route>

          <Route
            path="*"
            element={
              <LazyPage>
                <NotFound />
              </LazyPage>
            }
          />
        </Route>
      </Route>
    </Routes>
  )
}
