-- Ajustes da revisão da Fase 93.
-- quality: allow-nonconcurrent-index reason=empty-identity-governance-tables

-- JIT guarda quem pediu, para que essa pessoa não aprove o próprio pedido.
alter table public.jit_sessions add column if not exists requested_by uuid references auth.users(id) on delete set null;
create index if not exists jit_sessions_requested_by_idx on public.jit_sessions(requested_by) where requested_by is not null;

-- Tratamento de SoD nasce pendente e só vale depois da aprovação de outras pessoas.
alter table public.sod_mitigations add column if not exists required_approvals integer not null default 1 check(required_approvals between 1 and 5);
alter table public.sod_mitigations drop constraint if exists sod_mitigations_check;
alter table public.sod_mitigations drop constraint if exists sod_mitigations_check1;
alter table public.sod_mitigations drop constraint if exists sod_mitigations_status_check;
alter table public.sod_mitigations alter column status set default 'pending';
alter table public.sod_mitigations add constraint sod_mitigations_status_check check(status in('pending','active','expired','revoked'));
alter table public.sod_mitigations add constraint sod_mitigations_active_approved_check check(status<>'active' or cardinality(approved_by)>=required_approvals);
alter table public.sod_mitigations add constraint sod_mitigations_critical_acceptance_check check(kind<>'acceptance' or severity<>'critical' or required_approvals>=2);

-- Uma elevação de papel não apaga o acesso a todas as lojas de quem já o tinha.
create or replace function public.rbac_apply_organization_role(requested_organization_id uuid,requested_user_id uuid,requested_role text,requested_all_stores boolean default false) returns jsonb language plpgsql security definer set search_path='' as $$
declare current_role_value text;
begin
 if requested_role not in('admin','supervisor','analyst','member') then raise exception 'RBAC_ROLE_NOT_PROVISIONABLE'; end if;
 select role into current_role_value from public.organization_members where organization_id=requested_organization_id and user_id=requested_user_id;
 if current_role_value='owner' then raise exception 'RBAC_OWNER_PROTECTED'; end if;
 insert into public.organization_members(organization_id,user_id,role,all_stores,active) values(requested_organization_id,requested_user_id,requested_role,requested_all_stores,true) on conflict(organization_id,user_id) do update set role=excluded.role,all_stores=organization_members.all_stores or excluded.all_stores,active=true,updated_at=now();
 return jsonb_build_object('previous_role',current_role_value,'role',requested_role);
end$$;

-- O Copilot não cancela ações da governança de acessos.
create or replace function public.cancel_copilot_action(requested_action_id uuid) returns void language plpgsql security definer set search_path='' as $$
declare r public.copilot_action_requests%rowtype;
begin
  select * into r from public.copilot_action_requests where id=requested_action_id for update;
  if r.id is null or r.source<>'copilot' or (select auth.uid())<>r.requested_by then raise exception 'Ação não encontrada.'; end if;
  if r.status not in ('pending_confirmation','pending_approval') then raise exception 'Ação não pode mais ser cancelada.'; end if;
  update public.copilot_action_requests set status='cancelled',updated_at=now() where id=r.id; perform private.copilot_event(r.id,'action_cancelled');
end $$;

-- Chaves estrangeiras sem índice.
create index if not exists access_grants_created_by_idx on public.access_grants(created_by) where created_by is not null;
create index if not exists access_findings_accepted_by_idx on public.access_findings(accepted_by) where accepted_by is not null;
create index if not exists identity_governance_jobs_org_idx on public.identity_governance_jobs(organization_id);
create index if not exists identity_governance_audit_actor_idx on public.identity_governance_audit_events(actor_id) where actor_id is not null;
create index if not exists identity_lifecycle_requested_by_idx on public.identity_lifecycle_events(requested_by) where requested_by is not null;
create index if not exists identity_lifecycle_user_idx on public.identity_lifecycle_events(user_id) where user_id is not null;
create index if not exists break_glass_reviewer_idx on public.break_glass_events(reviewer_id) where reviewer_id is not null;
create index if not exists break_glass_used_by_idx on public.break_glass_events(used_by) where used_by is not null;
create index if not exists sod_rules_created_by_idx on public.sod_rule_definitions(created_by) where created_by is not null;
create index if not exists sod_mitigations_created_by_idx on public.sod_mitigations(created_by) where created_by is not null;
create index if not exists sod_mitigations_org_idx on public.sod_mitigations(organization_id);
create index if not exists access_review_campaigns_created_by_idx on public.access_review_campaigns(created_by) where created_by is not null;
create index if not exists access_review_items_decided_by_idx on public.access_review_items(decided_by) where decided_by is not null;
create index if not exists access_certifications_certified_by_idx on public.access_certifications(certified_by) where certified_by is not null;
create index if not exists access_reconciliation_runs_created_by_idx on public.access_reconciliation_runs(created_by) where created_by is not null;
create index if not exists access_drift_items_user_idx on public.access_drift_items(user_id) where user_id is not null;
