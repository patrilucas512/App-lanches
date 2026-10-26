-- Incremental guards: no historical records are changed.
create or replace function private.pix_tlv_field(payload text, wanted text)
returns text language plpgsql immutable set search_path = '' as $$
declare position integer := 1; size integer; tag text; value text; result text; seen text[] := '{}';
begin
  if payload is null or length(payload)>2048 then return null; end if;
  while position <= length(payload) loop
    if substring(payload from position for 4) !~ '^[0-9]{4}$' then return null; end if;
    tag := substring(payload from position for 2);
    size := substring(payload from position+2 for 2)::integer;
    if tag=any(seen) or position+3+size>length(payload) then return null; end if;
    seen := array_append(seen,tag);
    value := substring(payload from position+4 for size);
    if tag=wanted then result := value; end if;
    position := position+4+size;
  end loop;
  return result;
end $$;
revoke all on function private.pix_tlv_field(text,text) from public,anon,authenticated;

create or replace function private.validate_table_payment_evidence()
returns trigger language plpgsql set search_path = '' as $$
declare official_key text; merchant text; amount text; expected_amount integer;
begin
  select total_cents into expected_amount from public.table_sessions
    where id=new.table_session_id and establishment_id=new.establishment_id;
  if expected_amount is null or new.amount_cents is distinct from expected_amount then
    raise exception 'Valor do pagamento não corresponde à conta.';
  end if;
  if new.payment_method='pix' then
    select pix_key into official_key from public.pix_settings where establishment_id=new.establishment_id;
    merchant := private.pix_tlv_field(new.pix_payload,'26');
    amount := private.pix_tlv_field(new.pix_payload,'54');
    if official_key is null
      or lower(private.pix_tlv_field(merchant,'00')) is distinct from 'br.gov.bcb.pix'
      or private.pix_tlv_field(merchant,'01') is distinct from official_key
      or private.pix_tlv_field(new.pix_payload,'53') is distinct from '986'
      or private.pix_tlv_field(new.pix_payload,'58') is distinct from 'BR'
      or amount is null or amount !~ '^[0-9]+[.][0-9]{2}$'
      or new.pix_copy_paste is distinct from new.pix_payload then
      raise exception 'Pix inválido: gere novamente o QR Code oficial da loja.';
    end if;
    if amount::numeric*100 is distinct from expected_amount::numeric then
      raise exception 'Valor do Pix diverge da conta. Gere novamente.';
    end if;
  end if;
  if new.payment_method in ('credit_card','debit_card') then
    if auth.uid() is null or new.card_proof_image_url is null
      or split_part(new.card_proof_image_url,'/',1) <> new.establishment_id::text
      or split_part(new.card_proof_image_url,'/',2) <> new.table_session_id::text
      or split_part(new.card_proof_image_url,'/',3) <> auth.uid()::text
      or not exists (select 1 from storage.objects o where o.bucket_id='payment-proofs'
        and o.name=new.card_proof_image_url and o.owner_id=auth.uid()::text
        and o.metadata->>'mimetype' in ('image/jpeg','image/png','image/webp')) then
      raise exception 'Fotografe e envie o comprovante desta conta antes de confirmar o cartão.';
    end if;
  end if;
  return new;
end $$;
revoke all on function private.validate_table_payment_evidence() from public,anon,authenticated;
create trigger validate_table_payment_evidence before insert on public.table_payments
for each row execute function private.validate_table_payment_evidence();

create or replace function private.validate_pickup_payment()
returns trigger language plpgsql set search_path = '' as $$
declare target public.orders%rowtype;
begin
  if new.status='delivered' and old.status is distinct from new.status and new.public_order_id is not null then
    select * into target from public.orders where id=new.public_order_id;
    if target.fulfillment_type in ('pickup','takeaway') then
      if target.payment_method in ('mercado_pago_online','pagarme_online') and target.online_payment_status is distinct from 'approved' then
        raise exception 'Aguarde a confirmação do pagamento online antes da retirada.';
      elsif target.payment_method in ('cash','credit_card','debit_card') and not exists (
        select 1 from public.pos_sales s where s.source_order_id=target.id
          and s.establishment_id=target.establishment_id and s.status='completed'
      ) then
        raise exception 'Passe no caixa e confirme o pagamento antes de retirar o pedido.';
      end if;
    end if;
  end if;
  return new;
end $$;
revoke all on function private.validate_pickup_payment() from public,anon,authenticated;
create trigger validate_pickup_payment before update of status on public.kitchen_tickets
for each row execute function private.validate_pickup_payment();
