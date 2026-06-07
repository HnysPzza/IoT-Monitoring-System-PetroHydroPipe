export const userRoles = [
  'Admin',
  'Operation Manager',
  'Asst. Operation Manager',
  'Engineering Supervisor',
  'Production Supervisor',
]

export const USER_ACCOUNTS_STORAGE_KEY = 'iot_monitoring_user_accounts'

export const initialUserAccounts = [
  {
    id: 'usr-admin',
    name: 'admin',
    username: 'admin',
    email: 'admin@petrohydropipe.local',
    role: 'Admin',
    status: 'Active',
    createdAt: '2026-06-01',
    password: 'password123',
  },
  {
    id: 'usr-opmanager',
    name: 'Amiel Reyes',
    username: 'opmanager',
    email: 'opmanager@petrohydropipe.local',
    role: 'Operation Manager',
    status: 'Active',
    createdAt: '2026-06-01',
    password: 'password123',
  },
  {
    id: 'usr-asstmanager',
    name: 'Leah Dizon',
    username: 'asstmanager',
    email: 'asstmanager@petrohydropipe.local',
    role: 'Asst. Operation Manager',
    status: 'Active',
    createdAt: '2026-06-01',
    password: 'password123',
  },
  {
    id: 'usr-engsupervisor',
    name: 'Nico Peralta',
    username: 'engsupervisor',
    email: 'engsupervisor@petrohydropipe.local',
    role: 'Engineering Supervisor',
    status: 'Active',
    createdAt: '2026-06-01',
    password: 'password123',
  },
  {
    id: 'usr-prodsupervisor',
    name: 'Mara Santos',
    username: 'prodsupervisor',
    email: 'prodsupervisor@petrohydropipe.local',
    role: 'Production Supervisor',
    status: 'Active',
    createdAt: '2026-06-01',
    password: 'password123',
  },
]
