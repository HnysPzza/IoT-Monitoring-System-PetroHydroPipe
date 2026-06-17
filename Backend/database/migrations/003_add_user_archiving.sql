-- Phase 10 migration: keep deleted user accounts as archived records.
alter table users
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by uuid references users(id) on delete set null;

create index if not exists idx_users_deleted_at on users(deleted_at);
