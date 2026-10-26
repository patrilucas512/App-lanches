create or replace function public.prepare_customer_subscription_cancellation(requested_session_hash text,requested_slug text,requested_subscription_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare s public.customer_portal_sessions%rowtype;e public.establishments%rowtype;cs public.customer_subscriptions%rowtype;p public.customer_subscription_plans%rowtype;
begin
 if auth.role()<>'service_role' then raise exception 'Operação interna.';end if;
 select * into s from public.customer_portal_sessions where token_hash=requested_session_hash and revoked_at is null and expires_at>now();select * into e from public.establishments where slug=requested_slug and coalesce(organization_id,id)=s.organization_id and active;
 select * into cs from public.customer_subscriptions where id=requested_subscription_id and organization_id=s.organization_id and customer_id in(select id from public.customers where organization_customer_id=s.organization_customer_id or id=s.customer_id);select * into p from public.customer_subscription_plans where id=cs.plan_id;
 if s.id is null or e.id is null or cs.id is null or cs.status in('cancelled','expired') then raise exception 'Assinatura não autorizada.';end if;
 return jsonb_build_object('provider',cs.payment_provider,'provider_subscription_id',cs.payment_provider_subscription_id,'gateway_account_id',cs.payment_gateway_account_id,'manual_renewal',cs.manual_renewal,'policy',p.cancellation_policy,'benefits_end_at',case when p.cancellation_policy='immediate' then now() else cs.current_period_end end);
end $$;
revoke all on function public.prepare_customer_subscription_cancellation(text,text,uuid) from public,anon,authenticated;
grant execute on function public.prepare_customer_subscription_cancellation(text,text,uuid) to service_role;
