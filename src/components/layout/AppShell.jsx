import { Outlet } from 'react-router-dom'
import ApprovalToast from './ApprovalToast'
import DataLoader from './DataLoader'
import Header from './Header'
import BottomNav from './BottomNav'

export default function AppShell() {
  return (
    <div className="relative min-h-dvh overflow-x-clip">
      <div className="bg-stadium pointer-events-none fixed inset-0 -z-10" aria-hidden="true" />
      <Header />
      <main className="safe-nav-space mx-auto w-full max-w-6xl px-4 pt-6 sm:px-6 lg:pt-10">
        <Outlet />
      </main>
      <ApprovalToast />
      <DataLoader />
      <BottomNav />
    </div>
  )
}
