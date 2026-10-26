import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const read=n=>readFile(new URL('../'+n,import.meta.url),'utf8');
const sql=await read('supabase/migrations/20260913175604_inventory_control.sql');
test('Inventory is incremental, tenant scoped and read-only outside authorized RPCs',()=>{
 for(const table of ['inventory_items','inventory_recipes','inventory_movements']) {
  assert.ok(sql.includes('alter table public.'+table+' enable row level security'));
 }
 assert.match(sql,/auth.uid\(\) is null or not private.has_role/);
 assert.match(sql,/foreign key\(establishment_id,stock_item_id\)/);
 assert.doesNotMatch(sql,/drop table|truncate|update public.products/i);
 assert.match(sql,/revoke all on public.inventory_items/);
});
test('Stock movements serialize, deduplicate and do not repeat menu sales at POS',()=>{
 assert.match(sql,/pg_advisory_xact_lock/);
 assert.match(sql,/create unique index inventory_source_once/);
 assert.match(sql,/create unique index inventory_manual_once/);
 assert.match(sql,/source_order_id is not null\) then return new/);
 for(const table of ['order_items','table_order_items','pos_sale_items']) assert.ok(sql.includes('after insert on public.'+table));
});
test('Recipes handle quantity, selected extras and removed ingredients',()=>{
 assert.match(sql,/r.quantity \* case/);
 assert.match(sql,/a->>'quantity'/);
 assert.match(sql,/jsonb_array_elements_text\(coalesce\(removed/);
 assert.match(sql,/available<used then raise exception/);
 assert.match(sql,/started_at is not null or k.ready_at is not null/);
});
test('Stock UI supports audit, recipes, paging, brand identity and role restriction',async()=>{
 const page=await read('app/painel/estoque/page.tsx'),ui=await read('components/inventory-manager.tsx');
 assert.match(page,/<DashboardShell brand=\{establishment\}/);
 assert.match(page,/\["owner","manager"\].includes/);
 for(const rpc of ['inventory_save_item','inventory_adjust','inventory_save_recipe']) assert.ok(ui.includes(rpc));
 assert.match(ui,/range\(page\*20,page\*20\+19\)/);
 assert.match(ui,/needs_restock/);
 assert.match(ui,/crypto.randomUUID/);
});
