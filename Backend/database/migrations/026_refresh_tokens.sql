-- Refresh tokens for session lifecycle (Asset 7 fix).
-- Only SHA-256 hashes are stored. Reusing a revoked token revokes every
-- session for that user (suspected token theft).

begin;

create table if not exists public.refresh_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists refresh_tokens_user_id_idx on public.refresh_tokens (user_id);
create index if not exists refresh_tokens_active_user_id_idx
  on public.refresh_tokens (user_id)
  where revoked_at is null;

alter table public.refresh_tokens enable row level security;

create or replace function public.rotate_refresh_token(
  p_token_hash text,
  p_replacement_token_hash text
)
returns table (
  outcome text,
  user_id uuid,
  expires_at timestamptz
)
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  v_token public.refresh_tokens%rowtype;
  v_user public.users%rowtype;
begin
  if p_token_hash is null
    or p_replacement_token_hash is null
    or p_token_hash = p_replacement_token_hash
    or length(p_token_hash) <> 64
    or length(p_replacement_token_hash) <> 64 then
    return query select 'invalid'::text, null::uuid, null::timestamptz;
    return;
  end if;

  select token.* into v_token
  from public.refresh_tokens token
  where token.token_hash = p_token_hash
  for update;

  if not found then
    return query select 'invalid'::text, null::uuid, null::timestamptz;
    return;
  end if;

  if v_token.revoked_at is not null then
    update public.refresh_tokens token
    set revoked_at = clock_timestamp()
    where token.user_id = v_token.user_id and token.revoked_at is null;

    insert into public.audit_logs (user_id, action, entity_type, metadata)
    values (
      v_token.user_id,
      'REFRESH_TOKEN_REUSED',
      'auth',
      jsonb_build_object('refreshTokenId', v_token.id)
    );

    return query select 'reused'::text, v_token.user_id, v_token.expires_at;
    return;
  end if;

  if v_token.expires_at <= clock_timestamp() then
    return query select 'invalid'::text, v_token.user_id, v_token.expires_at;
    return;
  end if;

  select user_record.* into v_user
  from public.users user_record
  where user_record.id = v_token.user_id
  for share;

  if not found or v_user.deleted_at is not null or v_user.status <> 'Active' then
    update public.refresh_tokens
    set revoked_at = clock_timestamp()
    where id = v_token.id and revoked_at is null;

    return query select 'inactive'::text, v_token.user_id, v_token.expires_at;
    return;
  end if;

  update public.refresh_tokens
  set revoked_at = clock_timestamp()
  where id = v_token.id and revoked_at is null;

  insert into public.refresh_tokens (user_id, token_hash, expires_at)
  values (v_token.user_id, p_replacement_token_hash, v_token.expires_at);

  return query select 'rotated'::text, v_token.user_id, v_token.expires_at;
end;
$$;

revoke all on table public.refresh_tokens from public, anon, authenticated, service_role;

grant select, insert, update on table public.refresh_tokens to service_role;

revoke execute on function public.rotate_refresh_token(text, text)
from public, anon, authenticated;

grant execute on function public.rotate_refresh_token(text, text) to service_role;

commit;
