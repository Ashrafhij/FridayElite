import { Route, Routes } from 'react-router-dom'
import AppShell from './components/layout/AppShell'
import {
  PublicOnly,
  RequireAdmin,
  RequireApproved,
  RequireAuth,
  RequireProfileAccess,
} from './components/auth/RouteGuards'
import AccountStatus from './pages/AccountStatus'
import Admin from './pages/Admin'
import Dashboard from './pages/Dashboard'
import Login from './pages/Login'
import Matches from './pages/Matches'
import NotFound from './pages/NotFound'
import Profile from './pages/Profile'
import Signup from './pages/Signup'

export default function App() {
  return (
    <Routes>
      <Route element={<PublicOnly />}>
        <Route path="/login" element={<Login />} />
        <Route path="/signup" element={<Signup />} />
      </Route>

      <Route element={<RequireAuth />}>
        <Route element={<AppShell />}>
          <Route path="account-status" element={<AccountStatus />} />

          <Route element={<RequireProfileAccess />}>
            <Route path="profile" element={<Profile />} />
          </Route>

          <Route element={<RequireApproved />}>
            <Route index element={<Dashboard />} />
            <Route path="matches" element={<Matches />} />
          </Route>

          <Route element={<RequireAdmin />}>
            <Route path="admin" element={<Admin />} />
          </Route>

          <Route path="*" element={<NotFound />} />
        </Route>
      </Route>
    </Routes>
  )
}
