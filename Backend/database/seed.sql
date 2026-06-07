-- PetroHydroPipe IoT Monitoring System
-- Phase 2 seed data. Run after schema.sql.

insert into roles (name, description)
values
  ('Admin', 'Full system access and user management.'),
  ('Operation Manager', 'Production and downtime monitoring access.'),
  ('Asst. Operation Manager', 'Assistant production monitoring access.'),
  ('Engineering Supervisor', 'Machine and sensor monitoring access.'),
  ('Production Supervisor', 'Production floor monitoring access.')
on conflict (name) do update
set description = excluded.description;

insert into users (
  role_id,
  name,
  username,
  email,
  password_hash,
  status,
  must_change_password
)
select
  roles.id,
  'admin',
  'admin',
  'admin@petrohydropipe.local',
  -- Placeholder bcrypt hash for the temporary seed password: password123
  -- Replace during the real auth phase or regenerate with the backend seed tool.
  '$2b$10$PYl2gagd6YPknf9NDUWyo.r1fo3aAZyPmGr/PldpAoJlZGzoyZExO',
  'Active',
  true
from roles
where roles.name = 'Admin'
on conflict (username) do update
set
  role_id = excluded.role_id,
  name = excluded.name,
  email = excluded.email,
  status = excluded.status,
  must_change_password = excluded.must_change_password;

insert into machines (machine_code, name, status, location)
values
  ('M-01', 'Spiral Mill 01', 'Idle', 'Production Floor')
on conflict (machine_code) do update
set
  name = excluded.name,
  status = excluded.status,
  location = excluded.location;

insert into sensors (
  machine_id,
  sensor_code,
  esp32_device_id,
  label,
  status
)
select
  machines.id,
  sensor_seed.sensor_code,
  sensor_seed.esp32_device_id,
  sensor_seed.label,
  'Active'
from machines
cross join (
  values
    ('S-01', 'esp32-m01-s01', 'Sensor 01'),
    ('S-02', 'esp32-m01-s02', 'Sensor 02'),
    ('S-03', 'esp32-m01-s03', 'Sensor 03'),
    ('S-04', 'esp32-m01-s04', 'Sensor 04'),
    ('S-05', 'esp32-m01-s05', 'Sensor 05')
) as sensor_seed(sensor_code, esp32_device_id, label)
where machines.machine_code = 'M-01'
on conflict (sensor_code) do update
set
  machine_id = excluded.machine_id,
  esp32_device_id = excluded.esp32_device_id,
  label = excluded.label,
  status = excluded.status;
