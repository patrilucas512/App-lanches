do $migration$
declare
  function_definition text;
  updated_definition text;
  old_fragment constant text := ',1),20)';
  replacement_count integer;
  current_count integer;
begin
  select pg_get_functiondef(p.oid)
  into function_definition
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = 'place_public_order'
    and pg_get_function_identity_arguments(p.oid) = 'requested_slug text, buyer_name text, buyer_phone text, requested_fulfillment text, requested_items jsonb, order_notes text, requested_table_number text, requested_source text, requested_payment text';

  if function_definition is null then
    raise exception 'Função place_public_order não encontrada.';
  end if;

  replacement_count := (length(function_definition) - length(replace(function_definition, old_fragment, ''))) / length(old_fragment);
  current_count := (length(function_definition) - length(replace(function_definition, ',1),999)', ''))) / length(',1),999)');
  if replacement_count = 2 then
    updated_definition := replace(function_definition, old_fragment, ',1),999)');
    execute updated_definition;
  elsif current_count <> 2 then
    raise exception 'Limites esperados não encontrados em place_public_order: %', replacement_count;
  end if;
end
$migration$;
