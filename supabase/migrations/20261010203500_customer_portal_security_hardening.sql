-- Explicit deny policies document and enforce that sensitive portal state is
-- reachable only through the server-side, service-role RPC boundary.
create policy customer_portal_otp_deny_client on public.customer_portal_otp_challenges for all to anon,authenticated using(false) with check(false);
create policy customer_portal_sessions_deny_client on public.customer_portal_sessions for all to anon,authenticated using(false) with check(false);
create policy customer_addresses_deny_client on public.customer_addresses for all to anon,authenticated using(false) with check(false);
create policy customer_favorites_deny_client on public.customer_favorites for all to anon,authenticated using(false) with check(false);
create policy customer_preferences_deny_client on public.customer_notification_preferences for all to anon,authenticated using(false) with check(false);
create policy customer_notifications_deny_client on public.customer_notifications for all to anon,authenticated using(false) with check(false);
create policy customer_magic_links_deny_client on public.customer_magic_order_links for all to anon,authenticated using(false) with check(false);
create policy customer_portal_events_deny_client on public.customer_portal_events for all to anon,authenticated using(false) with check(false);

create index if not exists customer_portal_sessions_customer_id_idx on public.customer_portal_sessions(customer_id,created_at desc);
create index if not exists customer_addresses_customer_id_idx on public.customer_addresses(customer_id,updated_at desc) where deleted_at is null;
create index if not exists customer_favorites_customer_id_idx on public.customer_favorites(customer_id,created_at desc);
create index if not exists customer_magic_links_order_idx on public.customer_magic_order_links(order_id,expires_at) where revoked_at is null;
create index if not exists customer_support_customer_idx on public.customer_support_requests(customer_id,created_at desc);
create index if not exists customer_privacy_customer_idx on public.customer_privacy_requests(customer_id,created_at desc);
