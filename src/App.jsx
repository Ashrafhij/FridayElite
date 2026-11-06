import { lazy, Suspense } from 'react'
import { Route, Routes } from 'react-router-dom'
import AppShell from './components/layout/AppShell'
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
const CHUNK_RELOAD_FLAG = 'friday-elite-chunk-reload'

function reloadOnceAfterCacheBust() {
  if (window.sessionStorage.getItem(CHUNK_RELOAD_FLAG) === '1') return false
  window.sessionStorage.setItem(CHUNK_RELOAD_FLAG, '1')
  const url = new URL(window.location.href)
  url.searchParams.set('v', String(Date.now()))
  window.location.replace(url.href)
  return true
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

const AccountStatus = lazyWithReload(() => import('./pages/AccountStatus'))
const Admin = lazyWithReload(() => import('./pages/Admin'))
const Dashboard = lazyWithReload(() => import('./pages/Dashboard'))
const Login = lazyWithReload(() => import('./pages/Login'))
const MatchDetails = lazyWithReload(() => import('./pages/MatchDetails'))
const Matches = lazyWithReload(() => import('./pages/Matches'))
const NotFound = lazyWithReload(() => import('./pages/NotFound'))
const Profile = lazyWithReload(() => import('./pages/Profile'))
const Signup = lazyWithReload(() => import('./pages/Signup'))

function LazyPage({ children, full = false }) {
  return <Suspense fallback={<AuthLoading compact={!full} />}>{children}</Suspense>
}

export default function App() {
  return (
    <Routes>
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
