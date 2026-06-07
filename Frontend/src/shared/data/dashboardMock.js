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
    subtitle: 'Streaming sensor visibility across active machines.',
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
    subtitle: 'Register machines and configure sensor thresholds.',
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

export const dashboardPageMeta = {
  '/dashboard': {
    title: 'Dashboard Overview',
    subtitle: 'Current production posture across monitored machines.',
  },
  '/dashboard/live': {
    title: 'Live Feed',
    subtitle: 'Real-time sensor and throughput visibility.',
  },
  '/dashboard/downtime': {
    title: 'Downtime Records',
    subtitle: 'Stoppage review and cause assignment.',
  },
  '/dashboard/reports': {
    title: 'Reports',
    subtitle: 'Management exports and generated summaries.',
  },
  '/dashboard/users': {
    title: 'User Accounts',
    subtitle: 'Access management for operational staff.',
  },
  '/dashboard/machines': {
    title: 'Machines',
    subtitle: 'Machine registry and sensor threshold controls.',
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

export const overviewMockData = {
  alerts: [
    {
      id: 'dt-1',
      type: 'danger',
      message: 'Machine M-03 downtime detected at 09:18 AM. Duration: 14 min. Cause: Broken Part.',
    },
  ],
  summary: [
    { id: 'pipes', label: 'Total Pipes Today', value: '1,284 pcs', tone: 'success', helper: '+9.8% vs yesterday' },
    { id: 'events', label: 'Downtime Events', value: '3', tone: 'warning', helper: '2 unresolved this shift' },
    { id: 'minutes', label: 'Downtime Today', value: '41 min', tone: 'danger', helper: 'Longest stop: 18 min' },
    { id: 'availability', label: 'Machine Availability', value: '92.4%', tone: 'primary', helper: 'Across 4 active machines' },
  ],
  machines: [
    {
      id: 'M-01',
      name: 'Spiral Mill 01',
      status: 'Running',
      pipeCount: 412,
      sensorSignal: 'Stable',
      lastEvent: '10:24:09 AM',
    },
    {
      id: 'M-02',
      name: 'Spiral Mill 02',
      status: 'Running',
      pipeCount: 366,
      sensorSignal: 'Stable',
      lastEvent: '10:24:07 AM',
    },
    {
      id: 'M-03',
      name: 'Spiral Mill 03',
      status: 'Downtime',
      pipeCount: 228,
      sensorSignal: 'No pulse',
      lastEvent: '10:10:42 AM',
    },
    {
      id: 'M-04',
      name: 'Spiral Mill 04',
      status: 'Idle',
      pipeCount: 278,
      sensorSignal: 'Standby',
      lastEvent: '10:02:18 AM',
    },
  ],
  downtimeTrend: [
    { day: 'Mon', minutes: 18 },
    { day: 'Tue', minutes: 26 },
    { day: 'Wed', minutes: 12 },
    { day: 'Thu', minutes: 41 },
    { day: 'Fri', minutes: 24 },
    { day: 'Sat', minutes: 9 },
  ],
  availability: [
    { machineId: 'M-01', percent: 98 },
    { machineId: 'M-02', percent: 96 },
    { machineId: 'M-03', percent: 81 },
    { machineId: 'M-04', percent: 94 },
  ],
  unreadAlerts: 2,
}

export const placeholderSections = {
  live: {
    eyebrow: 'Phase next',
    title: 'Live Feed shell ready',
    copy: 'This route is wired into the dashboard shell and role model. Sensor polling UI will plug into this section next.',
  },
  downtime: {
    eyebrow: 'Phase next',
    title: 'Downtime workspace ready',
    copy: 'This section is reserved for stoppage logs, cause assignment, and downtime trend details.',
  },
  reports: {
    eyebrow: 'Phase next',
    title: 'Reports workspace ready',
    copy: 'Report generation and export controls will be implemented on top of this route shell.',
  },
  users: {
    eyebrow: 'Admin only',
    title: 'User management workspace ready',
    copy: 'User creation, edit, and removal flows will be added here in the next admin phase.',
  },
  machines: {
    eyebrow: 'Engineering',
    title: 'Machine registry workspace ready',
    copy: 'Machine enrollment and threshold configuration screens will be added to this section.',
  },
  audit: {
    eyebrow: 'Admin only',
    title: 'Audit log workspace ready',
    copy: 'Administrative activity history and filters will be implemented in this route.',
  },
  settings: {
    eyebrow: 'Admin only',
    title: 'Settings workspace ready',
    copy: 'Global monitoring preferences and schedules will be configured here.',
  },
}
