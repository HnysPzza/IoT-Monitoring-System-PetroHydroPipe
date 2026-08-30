begin;

set local lock_timeout = '2s';

insert into public.roles (name, description)
values ('Managing Director', 'Full read access to operational analytics and reports.')
on conflict (name) do update
set description = excluded.description;

commit;
