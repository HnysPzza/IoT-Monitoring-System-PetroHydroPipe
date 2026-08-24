-- Restore manual downtime updates after migration 016 removed direct table writes.
-- Keep downtime_events protected and allow mutation only through this RPC.

begin;

alter function public.update_downtime_record(uuid, text, text, boolean, boolean)
  security definer;

revoke execute on function public.update_downtime_record(uuid, text, text, boolean, boolean)
from public, anon, authenticated;

grant execute on function public.update_downtime_record(uuid, text, text, boolean, boolean)
to service_role;

commit;
