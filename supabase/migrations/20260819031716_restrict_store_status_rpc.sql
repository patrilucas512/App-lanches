do $$
begin
  if to_regprocedure('public.set_store_open(uuid, boolean)') is not null then
    execute 'revoke execute on function public.set_store_open(uuid, boolean) from anon, public';
    execute 'grant execute on function public.set_store_open(uuid, boolean) to authenticated';
  end if;
end
$$;
