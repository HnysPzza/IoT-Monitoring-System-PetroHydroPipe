// Navigation metadata controls sidebar labels, icons, routes, and role visibility.
export const navItems = [
  {
    label: 'Overview',
    to: '/dashboard',
    icon: 'gauge',
    group: 'monitor',
    roles: ['Admin', 'Operation Manager', 'Asst. Operation Manager', 'Engineering Supervisor', 'Managing Director', 'Production Supervisor'],
    subtitle: 'Production and downtime monitoring for Spiral Mill 01.',
  },
  {
    label: 'Live Feed',
    to: '/dashboard/live',
    icon: 'rss',
    group: 'monitor',
    roles: ['Admin', 'Operation Manager', 'Asst. Operation Manager', 'Engineering Supervisor', 'Managing Director', 'Production Supervisor'],
    subtitle: 'Live status across five monitoring points.',
  },
  {
    label: 'Downtime',
    to: '/dashboard/downtime',
    icon: 'triangle-alert',
    group: 'monitor',
    roles: ['Admin', 'Operation Manager', 'Asst. Operation Manager', 'Engineering Supervisor', 'Managing Director', 'Production Supervisor'],
    subtitle: 'Review stoppages, causes, and intervention history.',
  },
  {
    label: 'Reports',
    to: '/dashboard/reports',
    icon: 'bar-chart-3',
    group: 'analyze',
    roles: ['Admin', 'Operation Manager', 'Asst. Operation Manager', 'Managing Director'],
    subtitle: 'Generate and export production summaries.',
  },
  {
    label: 'Analytics',
    to: '/dashboard/analytics',
    icon: 'chart-no-axes-combined',
    group: 'analyze',
    roles: ['Admin', 'Operation Manager', 'Asst. Operation Manager', 'Engineering Supervisor', 'Managing Director'],
    subtitle: 'Explore production, downtime, and process trends.',
  },
  {
    label: 'Audit Log',
    to: '/dashboard/audit',
    icon: 'logs',
    group: 'analyze',
    roles: ['Admin'],
    subtitle: 'Trace operator actions and system changes.',
  },
  {
    label: 'User Accounts',
    to: '/dashboard/users',
    icon: 'users',
    group: 'admin',
    roles: ['Admin'],
    subtitle: 'Manage dashboard access and account status.',
  },
  {
    label: 'Machines',
    to: '/dashboard/machines',
    icon: 'monitor',
    group: 'admin',
    roles: ['Admin', 'Engineering Supervisor'],
    subtitle: 'Manage Spiral Mill 01 and its five sensors.',
  },
  {
    label: 'Settings',
    to: '/dashboard/settings',
    icon: 'settings',
    group: 'admin',
    roles: ['Admin'],
    subtitle: 'Operational configuration, sensor thresholds, and system preferences for Spiral Mill 01.',
  },
]

export const navGroups = [
  { id: 'monitor', label: 'Monitor' },
  { id: 'analyze', label: 'Analytics' },
  { id: 'admin', label: 'Admin' },
]

// Topbar titles are resolved from the current dashboard route.
export const dashboardPageMeta = {
  '/dashboard': {
    title: 'Overview',
    subtitle: 'Production and downtime monitoring for Spiral Mill 01.',
  },
  '/dashboard/live': {
    title: 'Live Feed',
    subtitle: 'Current status across five monitoring points.',
  },
  '/dashboard/downtime': {
    title: 'Downtime Records',
    subtitle: 'Stoppage review and cause assignment.',
  },
  '/dashboard/reports': {
    title: 'Reports',
    subtitle: 'Daily, weekly, and monthly production summaries.',
  },
  '/dashboard/analytics': {
    title: 'Analytics',
    subtitle: 'Production, downtime, and process trends.',
  },
  '/dashboard/users': {
    title: 'User Accounts',
    subtitle: 'Access management for operational staff.',
  },
  '/dashboard/machines': {
    title: 'Machines',
    subtitle: 'Spiral Mill 01 and five-sensor configuration.',
  },
  '/dashboard/audit': {
    title: 'Audit Log',
    subtitle: 'Administrative accountability trail.',
  },
  '/dashboard/settings': {
    title: 'Settings',
    subtitle: 'Operational configuration, sensor thresholds, and system preferences for Spiral Mill 01.',
  },
}
