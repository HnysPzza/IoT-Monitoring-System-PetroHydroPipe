// Navigation metadata controls sidebar labels, icons, routes, and role visibility.
export const navItems = [
  {
    label: 'Dashboard',
    to: '/dashboard',
    icon: 'gauge',
    roles: ['Admin', 'Operation Manager', 'Asst. Operation Manager', 'Engineering Supervisor', 'Production Supervisor'],
    subtitle: 'Operational overview and machine availability.',
  },
  {
    label: 'Live Feed',
    to: '/dashboard/live',
    icon: 'activity',
    roles: ['Admin', 'Operation Manager', 'Asst. Operation Manager', 'Engineering Supervisor', 'Production Supervisor'],
    subtitle: 'ESP32 sensor visibility across 5 monitoring points.',
  },
  {
    label: 'Downtime',
    to: '/dashboard/downtime',
    icon: 'triangle-alert',
    roles: ['Admin', 'Operation Manager', 'Asst. Operation Manager', 'Engineering Supervisor', 'Production Supervisor'],
    subtitle: 'Review stoppages, causes, and intervention history.',
  },
  {
    label: 'Reports',
    to: '/dashboard/reports',
    icon: 'bar-chart-3',
    roles: ['Admin', 'Operation Manager', 'Asst. Operation Manager'],
    subtitle: 'Generate and export production summaries.',
  },
  {
    label: 'User Accounts',
    to: '/dashboard/users',
    icon: 'users',
    roles: ['Admin'],
    subtitle: 'Manage dashboard access and account status.',
  },
  {
    label: 'Machines',
    to: '/dashboard/machines',
    icon: 'monitor',
    roles: ['Admin', 'Engineering Supervisor'],
    subtitle: 'Register machines and configure ESP32 sensors.',
  },
  {
    label: 'Audit Log',
    to: '/dashboard/audit',
    icon: 'history',
    roles: ['Admin'],
    subtitle: 'Trace operator actions and system changes.',
  },
  {
    label: 'Settings',
    to: '/dashboard/settings',
    icon: 'settings',
    roles: ['Admin'],
    subtitle: 'Global dashboard preferences and schedules.',
  },
]

// Topbar titles are resolved from the current dashboard route.
export const dashboardPageMeta = {
  '/dashboard': {
    title: 'Dashboard Overview',
    subtitle: 'Current production posture across monitored machines.',
  },
  '/dashboard/live': {
    title: 'Live Feed',
    subtitle: 'Real-time ESP32 sensor and throughput visibility.',
  },
  '/dashboard/downtime': {
    title: 'Downtime Records',
    subtitle: 'Stoppage review and cause assignment.',
  },
  '/dashboard/reports': {
    title: 'Reports',
    subtitle: 'Daily, weekly, and monthly production summaries.',
  },
  '/dashboard/users': {
    title: 'User Accounts',
    subtitle: 'Access management for operational staff.',
  },
  '/dashboard/machines': {
    title: 'Machines',
    subtitle: 'Machine registry and 5-sensor ESP32 configuration.',
  },
  '/dashboard/audit': {
    title: 'Audit Log',
    subtitle: 'Administrative accountability trail.',
  },
  '/dashboard/settings': {
    title: 'Settings',
    subtitle: 'System-wide dashboard configuration.',
  },
}
