-- Phase 8 reporting completion: assisted orders/revenue and peak-volume data.

create or replace function public.get_support_productivity(requested_establishment_id uuid,requested_days integer default 7)
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
  if not private.has_support_permission(requested_establishment_id,'productivity') then raise exception 'Sem permissão para produtividade.'; end if;
  return (select coalesce(jsonb_agg(x order by x.resolved desc,x.agent_name),'[]'::jsonb) from (
    select ah.to_user_id,coalesce(p.full_name,'Atendente') agent_name,count(distinct ah.conversation_id) received,
      count(distinct ah.conversation_id) filter(where ah.status='completed') resolved,
      count(distinct ah.id) filter(where ah.status='transferred') transfers,
      round(avg(extract(epoch from(cv.first_response_at-cv.queued_at))/60) filter(where cv.first_response_at is not null),1) avg_first_response_minutes,
      round(avg(extract(epoch from(cv.resolved_at-cv.queued_at))/60) filter(where cv.resolved_at is not null),1) avg_resolution_minutes,
      count(distinct cv.id) filter(where cv.sla_breached_at is null and cv.resolved_at is not null) sla_met,
      count(distinct cv.id) filter(where cv.sla_breached_at is not null) sla_breached,
      round(avg(sr.rating),2) satisfaction,round(avg(case qr.rating when 'excellent' then 3 when 'adequate' then 2 else 1 end),2) quality_score,
      coalesce(sum(commerce.orders_generated),0)::integer orders_generated,
      coalesce(sum(commerce.assisted_sales_cents),0)::bigint assisted_sales_cents
    from public.support_assignment_history ah
    join public.whatsapp_conversations cv on cv.id=ah.conversation_id
    left join public.profiles p on p.id=ah.to_user_id
    left join public.support_satisfaction_ratings sr on sr.conversation_id=cv.id
    left join public.support_quality_reviews qr on qr.conversation_id=cv.id and qr.agent_user_id=ah.to_user_id
    left join lateral (
      select count(*)::integer orders_generated,coalesce(sum(o.total_cents),0)::bigint assisted_sales_cents
      from public.whatsapp_order_links wol join public.orders o on o.id=wol.order_id
      where wol.conversation_id=cv.id and wol.created_at>=ah.offered_at and wol.created_at<coalesce(ah.ended_at,now()) and o.status<>'canceled'
    ) commerce on true
    where ah.establishment_id=requested_establishment_id and ah.offered_at>=now()-make_interval(days=>least(greatest(requested_days,1),30)) and ah.to_user_id is not null
    group by ah.to_user_id,p.full_name
  )x);
end $$;

create or replace function public.get_support_peak_hours(requested_establishment_id uuid,requested_days integer default 7)
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
  if not private.has_support_permission(requested_establishment_id,'productivity') then raise exception 'Sem permissão para produtividade.'; end if;
  return (select coalesce(jsonb_agg(x order by x.volume desc,x.weekday,x.hour),'[]'::jsonb) from (
    select extract(isodow from created_at at time zone 'America/Sao_Paulo')::integer weekday,
      extract(hour from created_at at time zone 'America/Sao_Paulo')::integer as "hour",count(*)::integer volume
    from public.support_conversation_events
    where establishment_id=requested_establishment_id and event_type='conversation_queued'
      and created_at>=now()-make_interval(days=>least(greatest(requested_days,1),30))
    group by 1,2 order by volume desc,weekday,hour limit 12
  )x);
end $$;

revoke all on function public.get_support_peak_hours(uuid,integer) from public,anon;
grant execute on function public.get_support_peak_hours(uuid,integer) to authenticated;
