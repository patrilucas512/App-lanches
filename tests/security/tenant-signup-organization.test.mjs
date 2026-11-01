import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
const dir=new URL("../../supabase/migrations/",import.meta.url);
const migration=readFileSync(new URL(readdirSync(dir).find(name=>name.endsWith("_tenant_signup_organization.sql")),dir),"utf8");
test("a new store is created inside its own organization",()=>{
  assert.match(migration,/insert into public\.organizations\(name,slug,created_by\)/);
  assert.match(migration,/insert into public\.establishments\(name,slug,email,organization_id\)/);
});
test("the creator owns both the organization and the store",()=>{
  assert.match(migration,/insert into public\.organization_members\(organization_id,user_id,role,all_stores,active\) values\(new_organization_id,current_user_id,'owner',true,true\)/);
  assert.match(migration,/insert into public\.establishment_members\(establishment_id,user_id,role\) values\(new_id,current_user_id,'owner'\)/);
});
test("catalog rows take the organization from the store, whatever the client sends",()=>{
  assert.match(migration,/select e\.organization_id into new\.organization_id from public\.establishments e where e\.id = new\.establishment_id/);
  for(const table of ["categories","products"])assert.match(migration,new RegExp(`before insert on public\\.${table}`));
});
test("the fill function is not callable by clients",()=>assert.match(migration,/revoke all on function private\.fill_organization_from_establishment\(\) from public, anon, authenticated/));
