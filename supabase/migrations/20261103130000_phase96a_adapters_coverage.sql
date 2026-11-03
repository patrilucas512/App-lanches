-- Phase 96A: the remaining domains get adapters. Labor and delivery-proof records are kept by law, the files a step removes
-- leave only a hash, and the personal data map covers employees, drivers, leads, analytics, marketplaces and files.

alter table public.personal_data_map drop constraint personal_data_map_legal_retention_check;
alter table public.personal_data_map add constraint personal_data_map_legal_retention_check check(legal_retention is null or legal_retention in('fiscal','financial','contracts','audit','labor','delivery_proof'));

-- What a step left behind as proof (for a file: bucket and a hash of the path). Never a value that was removed.
alter table public.privacy_deletion_steps add column evidence jsonb not null default '{}';

insert into public.personal_data_map(domain,table_name,column_name,data_category,subject_category,sensitive,owner_service,adapter_key,legal_retention,notes) values
 ('workforce','custom_staff_members','notes','employee','employee',false,'Workforce (18)','workforce',null,null),
 ('workforce','employee_availability','notes','employee','employee',false,'Workforce (18)','workforce',null,null),
 ('workforce','work_shifts','starts_at','employee','employee',false,'Workforce (18)','workforce','labor','Escala é registro trabalhista.'),
 ('workforce','time_clock_entries','occurred_at','employee','employee',false,'Workforce (18)','workforce','labor','Ponto é registro trabalhista obrigatório.'),
 ('workforce','time_clock_entries','device_id','device_technical','employee',false,'Workforce (18)','workforce','labor',null),
 ('workforce','employee_evaluations','notes','employee','employee',false,'Workforce (18)','workforce','labor','A validar com o jurídico trabalhista.'),
 ('workforce','employee_feedback','feedback','employee','employee',false,'Workforce (18)','workforce','labor','A validar com o jurídico trabalhista.'),
 ('financial','cash_movements','operator_name','employee','employee',false,'Caixa','financial','financial',null),
 ('drivers','driver_profiles','vehicle_plate','driver','driver',false,'Delivery','drivers',null,null),
 ('drivers','driver_profiles','cpf_last4','driver','driver',false,'Delivery','drivers',null,null),
 ('drivers','deliveries','delivery_latitude','location','driver',false,'Delivery','drivers','delivery_proof','Comprovante de entrega.'),
 ('drivers','deliveries','delivery_longitude','location','driver',false,'Delivery','drivers','delivery_proof','Comprovante de entrega.'),
 ('financial','driver_financial_entries','reason','driver','driver',false,'Financeiro de entregadores (11)','financial','financial',null),
 ('leads','sales_contacts','name','identification','lead',false,'Sales CRM (29)','leads',null,null),
 ('leads','sales_contacts','email','contact','lead',false,'Sales CRM (29)','leads',null,null),
 ('leads','sales_contacts','phone','contact','lead',false,'Sales CRM (29)','leads',null,null),
 ('leads','sales_leads','notes','communication','lead',false,'Sales CRM (29)','leads',null,null),
 ('leads','sales_proposals','acceptance_ip','device_technical','lead',false,'Sales CRM (29)','leads','contracts','Aceite de proposta é prova contratual.'),
 ('data_platform','analytics_dim_customers','pseudonym','identification','end_customer',false,'Data Platform (34)','data_platform',null,'Pseudônimo; marcado como anonimizado na exclusão.'),
 ('data_platform','analytics_customer_360','revenue_cents','order_history','end_customer',false,'Data Platform (34)','data_platform',null,null),
 ('marketplaces','marketplace_order_snapshots','normalized_snapshot','identification','end_customer',false,'Marketplaces (69)','marketplaces',null,'Campos do cliente saem do snapshot.'),
 ('whatsapp','normalized_messages','text_content','communication','end_customer',false,'Omnichannel (12)','whatsapp',null,null),
 ('storage','custom_staff_members','photo_url','image','employee',false,'Storage (product-images)','storage',null,'Arquivo no bucket público product-images.'),
 ('storage','privacy_export_packages','storage_path','identification','end_customer',false,'Storage (privacy-exports)','storage',null,null)
on conflict do nothing;
