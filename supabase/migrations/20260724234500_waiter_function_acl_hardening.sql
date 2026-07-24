revoke all on function public.open_table_session(uuid, text, integer, text) from public, anon;
revoke all on function public.submit_table_order(uuid, jsonb, text) from public, anon;
revoke all on function public.update_kitchen_ticket(uuid, public.kitchen_ticket_status) from public, anon;
revoke all on function public.request_table_closure(uuid, integer, integer) from public, anon;
revoke all on function public.get_table_pix_data(uuid) from public, anon;
revoke all on function public.confirm_table_payment(uuid, text, text) from public, anon;
revoke all on function public.release_table_session(uuid) from public, anon;
revoke all on function public.update_pix_settings(uuid, text, text, text, text, text, text) from public, anon;
