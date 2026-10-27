-- RLS policies execute this boolean helper under the querying role.
-- It exposes no rows or secrets; it only returns the caller's scoped permission.
grant execute on function private.can_voice(uuid,text) to authenticated;
