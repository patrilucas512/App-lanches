-- Fase 98G (lote 1): funções SECURITY DEFINER executáveis por anon. Tabela completa em
-- docs/security-definer-review.md. As 22 já tinham search_path fixo e validação de entrada; o que muda:
--
-- 1. Revoga anon de duas que não precisam ser públicas:
--    * place_public_order (v1): nenhum código chama; o cardápio usa place_public_order_v2. A função continua.
--    * set_store_open: exige dono/gerente logado (recusava anon por dentro).
-- 2. Limite de frequência nas escritas públicas sem limite: pedido (place_public_order_v2), abertura de chat
--    do site (start_web_chat_session) e evento de visita (record_public_event). Por IP (cabeçalhos que o
--    PostgREST repassa) e por loja. Chamadas do servidor (service_role) não entram no limite.

revoke execute on function public.place_public_order(text, text, text, text, jsonb, text, text, text, text, integer) from anon, authenticated;
revoke execute on function public.set_store_open(uuid, boolean) from anon;

create table if not exists private.public_rate_limits (
  bucket text not null,
  window_start timestamptz not null,
  hits integer not null default 0,
  primary key (bucket, window_start)
);
alter table private.public_rate_limits enable row level security;
revoke all on private.public_rate_limits from public, anon, authenticated;

create or replace function private.request_ip_key()
returns text language sql stable set search_path = '' as $$
  select coalesce(
    nullif(h->>'cf-connecting-ip', ''),
    nullif(h->>'x-real-ip', ''),
    nullif(btrim(split_part(coalesce(h->>'x-forwarded-for', ''), ',', 1)), ''),
    'sem-ip')
  from (select coalesce(nullif(current_setting('request.headers', true), ''), '{}')::json as h) x
$$;
revoke all on function private.request_ip_key() from public, anon, authenticated;

-- true = dentro do limite. Conta a chamada; janela fixa de requested_window.
create or replace function private.public_rate_allow(requested_scope text, requested_key text, requested_max integer, requested_window interval)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  win timestamptz := to_timestamp(floor(extract(epoch from now()) / extract(epoch from requested_window)) * extract(epoch from requested_window));
  bucket_key text := requested_scope || ':' || md5(coalesce(requested_key, ''));
  current_hits integer;
begin
  if coalesce((select auth.role()), '') = 'service_role' then return true; end if;
  insert into private.public_rate_limits as l(bucket, window_start, hits) values (bucket_key, win, 1)
  on conflict (bucket, window_start) do update set hits = l.hits + 1
  returning hits into current_hits;
  if random() < 0.01 then delete from private.public_rate_limits where window_start < now() - interval '1 day'; end if;
  return current_hits <= requested_max;
end $$;
revoke all on function private.public_rate_allow(text, text, integer, interval) from public, anon, authenticated;

-- Pedido: 30 por IP e 600 por loja a cada 10 minutos.
create or replace function private.enforce_public_order_rate(requested_slug text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not private.public_rate_allow('order_ip', lower(coalesce(requested_slug, '')) || '|' || private.request_ip_key(), 30, interval '10 minutes')
     or not private.public_rate_allow('order_store', lower(coalesce(requested_slug, '')), 600, interval '10 minutes') then
    raise exception 'Muitos pedidos em pouco tempo. Aguarde alguns minutos e tente de novo.' using errcode = 'P0001', hint = 'RATE_LIMITED';
  end if;
end $$;
revoke all on function private.enforce_public_order_rate(text) from public, anon, authenticated;

-- Injeta a checagem no começo de cada função, sem reescrever o corpo (as três são longas e já testadas).
do $$
declare
  target record;
  def text;
  injected text;
begin
  for target in select * from (values
    ('public.place_public_order_v2(text,text,text,text,jsonb,text,text,text,text,integer,jsonb)'::regprocedure,
     'perform private.enforce_public_order_rate(requested_slug);'),
    ('public.start_web_chat_session(uuid,text,text)'::regprocedure,
     'if not private.public_rate_allow(''web_chat_session'', coalesce(requested_public_key::text, '''') || ''|'' || private.request_ip_key(), 20, interval ''10 minutes'') then raise exception ''Muitas conversas abertas em pouco tempo. Aguarde alguns minutos.'' using errcode = ''P0001'', hint = ''RATE_LIMITED''; end if;'),
    ('public.record_public_event(text,text,uuid,uuid,integer)'::regprocedure,
     'if not private.public_rate_allow(''public_event'', lower(coalesce(requested_slug, '''')) || ''|'' || private.request_ip_key(), 300, interval ''10 minutes'') then return false; end if;')
  ) v(fn, guard) loop
    def := pg_get_functiondef(target.fn);
    if position('public_rate_allow' in def) > 0 or position('enforce_public_order_rate' in def) > 0 then continue; end if;
    -- o primeiro "begin" do corpo (depois do declare, se houver)
    injected := regexp_replace(def, '(\$function\$[\s\S]*?\mbegin\M)', E'\\1\n  ' || replace(target.guard, '\', '\\'), '');
    if injected = def then raise exception 'PHASE98G_INJECT_FAILED: %', target.fn; end if;
    execute injected;
  end loop;
end $$;
