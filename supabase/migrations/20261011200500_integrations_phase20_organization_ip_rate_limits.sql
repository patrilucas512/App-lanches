begin;

create table if not exists public.api_organization_rate_limit_buckets(
  organization_id uuid not null references public.organizations(id) on delete cascade,
  bucket_start timestamptz not null,
  request_count integer not null default 0,
  primary key(organization_id,bucket_start)
);

create table if not exists public.api_ip_rate_limit_buckets(
  api_client_id uuid not null references public.api_clients(id) on delete cascade,
  ip_hash text not null,
  bucket_start timestamptz not null,
  request_count integer not null default 0,
  primary key(api_client_id,ip_hash,bucket_start)
);

alter table public.api_organization_rate_limit_buckets enable row level security;
alter table public.api_ip_rate_limit_buckets enable row level security;
revoke all on public.api_organization_rate_limit_buckets,public.api_ip_rate_limit_buckets from public,anon,authenticated;

drop function if exists public.consume_api_rate_limit(uuid,integer);
create or replace function public.consume_api_rate_limit(requested_client_id uuid,requested_limit integer,requested_ip_hash text default null)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  bucket timestamptz:=date_trunc('minute',clock_timestamp());
  org_id uuid;
  client_used integer;
  org_used integer;
  ip_used integer:=0;
  client_limit integer:=greatest(coalesce(requested_limit,60),1);
  org_limit integer;
  ip_limit integer;
begin
  if current_setting('request.jwt.claim.role',true)<>'service_role' then raise exception 'Operação interna.'; end if;
  select organization_id into org_id from public.api_clients where id=requested_client_id and status='active';
  if org_id is null then raise exception 'Cliente de API inválido.'; end if;
  org_limit:=greatest(client_limit*5,500);
  ip_limit:=greatest(client_limit*2,120);

  insert into public.api_rate_limit_buckets(api_client_id,bucket_start,request_count) values(requested_client_id,bucket,1)
  on conflict(api_client_id,bucket_start) do update set request_count=public.api_rate_limit_buckets.request_count+1 returning request_count into client_used;
  insert into public.api_organization_rate_limit_buckets(organization_id,bucket_start,request_count) values(org_id,bucket,1)
  on conflict(organization_id,bucket_start) do update set request_count=public.api_organization_rate_limit_buckets.request_count+1 returning request_count into org_used;
  if nullif(requested_ip_hash,'') is not null then
    insert into public.api_ip_rate_limit_buckets(api_client_id,ip_hash,bucket_start,request_count) values(requested_client_id,requested_ip_hash,bucket,1)
    on conflict(api_client_id,ip_hash,bucket_start) do update set request_count=public.api_ip_rate_limit_buckets.request_count+1 returning request_count into ip_used;
  end if;
  return jsonb_build_object(
    'allowed',client_used<=client_limit and org_used<=org_limit and (requested_ip_hash is null or ip_used<=ip_limit),
    'limit',client_limit,'remaining',greatest(client_limit-client_used,0),
    'organization_remaining',greatest(org_limit-org_used,0),'ip_remaining',case when requested_ip_hash is null then null else greatest(ip_limit-ip_used,0) end,
    'reset_at',extract(epoch from bucket+interval '1 minute')::bigint
  );
end$$;

revoke all on function public.consume_api_rate_limit(uuid,integer,text) from public,anon,authenticated;
grant execute on function public.consume_api_rate_limit(uuid,integer,text) to service_role;

select cron.schedule('integration-rate-limit-cleanup','17 3 * * *',$$delete from public.api_rate_limit_buckets where bucket_start < now()-interval '2 days';delete from public.api_organization_rate_limit_buckets where bucket_start < now()-interval '2 days';delete from public.api_ip_rate_limit_buckets where bucket_start < now()-interval '2 days'$$)
where not exists(select 1 from cron.job where jobname='integration-rate-limit-cleanup');

commit;
