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
const AccountStatus = lazy(() => import('./pages/AccountStatus'))
const Admin = lazy(() => import('./pages/Admin'))
const Dashboard = lazy(() => import('./pages/Dashboard'))
const Login = lazy(() => import('./pages/Login'))
const Matches = lazy(() => import('./pages/Matches'))
const NotFound = lazy(() => import('./pages/NotFound'))
const Profile = lazy(() => import('./pages/Profile'))
const Signup = lazy(() => import('./pages/Signup'))

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
