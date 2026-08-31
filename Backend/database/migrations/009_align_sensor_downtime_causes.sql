-- Migration 009: Align filler-wire downtime causes with the canonical sensor roles
begin;

set local lock_timeout = '2s';

do $migration$
declare
  v_rpc regprocedure := to_regprocedure(
    'public.ingest_iot_sensor_event(uuid,uuid,uuid,text,jsonb,timestamptz)'
  );
  v_definition text;
  v_s02_legacy constant text := 'when ''S-02'' then ''Weld Wire Refill''';
  v_s04_legacy constant text := 'when ''S-04'' then ''Flux Refill''';
  v_s02_current constant text := 'when ''S-02'' then ''Consumable Shortage''';
  v_s04_current constant text := 'when ''S-04'' then ''Consumable Shortage''';
begin
  if v_rpc is null then
    raise exception using
      errcode = '42883',
      message = 'Required ingest_iot_sensor_event RPC is missing. Apply migrations through 008 first.';
  end if;

  select pg_get_functiondef(v_rpc)
  into v_definition;

  if position(v_s02_current in v_definition) > 0
    and position(v_s04_current in v_definition) > 0 then
    null;
  elsif position(v_s02_legacy in v_definition) > 0
    and position(v_s04_legacy in v_definition) > 0 then
    v_definition := replace(v_definition, v_s02_legacy, v_s02_current);
    v_definition := replace(v_definition, v_s04_legacy, v_s04_current);
    execute v_definition;
  else
    raise exception using
      errcode = '55000',
      message = 'ingest_iot_sensor_event has an unexpected downtime-cause mapping; migration 009 stopped without changes.';
  end if;
end;
$migration$;

commit;
