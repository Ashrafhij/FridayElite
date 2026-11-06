import { CalendarDays, Home, Settings, ShieldCheck, UserRound } from 'lucide-react'

export const primaryNav = [
  {
    to: '/',
    label: 'الرئيسية',
    shortLabel: 'الرئيسية',
    icon: Home,
    end: true,
    approvedOnly: true,
  },
  {
    to: '/matches',
    label: 'المباريات',
    shortLabel: 'المباريات',
    icon: CalendarDays,
    approvedOnly: true,
  },
  {
    to: '/profile',
    label: 'الملف الشخصي',
    shortLabel: 'حسابي',
    icon: UserRound,
    profileAccess: true,
  },
  { to: '/admin', label: 'الإدارة', shortLabel: 'الإدارة', icon: Settings, adminOnly: true },
]

export const accountStatusNav = {
  to: '/account-status',
  label: 'حالة الحساب',
  shortLabel: 'الحالة',
  icon: ShieldCheck,
  end: true,
  statusOnly: true,
}

export function getNavItems(profile) {
  if (!profile) return []

  const isApproved = profile.status === 'approved'
  const isAdmin = isApproved && profile.role === 'admin'
  const canProfile = profile.status === 'pending' || isApproved

  if (!isApproved) {
    const profileItem = primaryNav.find((item) => item.profileAccess)
    return canProfile ? [accountStatusNav, profileItem] : [accountStatusNav]
  }

  return primaryNav.filter((item) => {
    if (item.adminOnly) return isAdmin
    if (item.approvedOnly) return isApproved
    if (item.profileAccess) return canProfile
    return true
  })
}
