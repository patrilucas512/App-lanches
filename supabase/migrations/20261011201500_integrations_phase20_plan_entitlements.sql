begin;

with ranked as (
  select id,row_number() over(order by sort_order,id) as tier,count(*) over() as total
  from public.plans
  where active=true
)
update public.plans p set
  developer_portal_enabled=true,
  webhooks_enabled=(r.tier>=least(2,r.total)),
  public_api_enabled=(r.tier=r.total),
  marketplace_integrations_enabled=(r.tier=r.total),
  max_api_clients=case when r.tier=r.total then null when r.tier=1 then 0 else 3 end,
  max_webhook_endpoints=case when r.tier=r.total then null when r.tier=1 then 0 else 5 end,
  updated_at=now()
from ranked r
where p.id=r.id;

commit;
