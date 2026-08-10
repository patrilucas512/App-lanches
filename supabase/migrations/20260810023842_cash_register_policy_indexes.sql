create index if not exists cash_registers_created_by_idx on public.cash_registers(created_by) where created_by is not null;

drop policy if exists cash_registers_admin_all on public.cash_registers;
drop policy if exists cash_registers_employee_read on public.cash_registers;
create policy cash_registers_authorized_read on public.cash_registers for select to authenticated
using (private.has_role(establishment_id,array['owner','manager']::public.member_role[]) or private.is_financial_employee(establishment_id));
create policy cash_registers_admin_insert on public.cash_registers for insert to authenticated
with check (private.has_role(establishment_id,array['owner','manager']::public.member_role[]));
create policy cash_registers_admin_update on public.cash_registers for update to authenticated
using (private.has_role(establishment_id,array['owner','manager']::public.member_role[]))
with check (private.has_role(establishment_id,array['owner','manager']::public.member_role[]));
create policy cash_registers_admin_delete on public.cash_registers for delete to authenticated
using (private.has_role(establishment_id,array['owner','manager']::public.member_role[]));
