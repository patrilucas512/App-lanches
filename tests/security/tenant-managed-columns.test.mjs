import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
const root=fileURLToPath(new URL("../../",import.meta.url));
const migration=readFileSync(join(root,"supabase/migrations/20261101140000_tenant_managed_columns_hardening.sql"),"utf8");
const walk=dir=>readdirSync(dir).flatMap(name=>{const path=join(dir,name);return statSync(path).isDirectory()?walk(path):/\.(ts|tsx|mjs|js)$/.test(name)?[path]:[];});
const sources=["app","lib","components"].flatMap(dir=>walk(join(root,dir)));
const SERVICE_CLIENTS=new Set(["a","admin"]);
const granted=table=>new Set([...migration.matchAll(new RegExp(`grant update \\(([^)]+)\\) on public\\.${table} to authenticated;`,"g"))].flatMap(match=>match[1].split(",").map(column=>column.trim())));
const clientWrites=table=>sources.flatMap(path=>[...readFileSync(path,"utf8").matchAll(new RegExp(`([\\w$]+)\\s*\\.from\\(["'\`]${table}["'\`]\\)\\s*\\.(update|upsert|insert|delete)\\(([\\s\\S]*?)\\)\\s*\\.eq\\(`,"g"))].filter(match=>!SERVICE_CLIENTS.has(match[1])).map(match=>({path,method:match[2],payload:match[3]})));

for(const table of ["establishments","organizations","establishment_members","organization_members"]){
  test(`client roles lose table-wide write access to ${table}`,()=>assert.match(migration,new RegExp(`revoke insert, update, delete on public\\.${table} from public, anon, authenticated;`)));
}
test("managed columns are never granted to clients",()=>{
  for(const column of ["organization_id","active","public_menu_active","blocked_at","block_type","block_reason","block_message","unit_status","ownership_type"])assert.ok(!granted("establishments").has(column),column);
  for(const column of ["status","billing_establishment_id","is_test_organization"])assert.ok(!granted("organizations").has(column),column);
  assert.doesNotMatch(migration,/grant[^;]*on public\.(establishment_members|organization_members) to[^;]*authenticated/);
});
test("trigger guards managed columns for client roles",()=>{
  assert.match(migration,/current_user in \('anon', 'authenticated'\)/);
  for(const column of ["organization_id","active","public_menu_active","blocked_at","block_type","block_reason","block_message","unit_status","ownership_type","status"])assert.match(migration,new RegExp(`new\\.${column} is distinct from old\\.${column}`));
  for(const name of ["establishments_guard_managed_columns","organizations_guard_managed_columns","establishment_members_guard_managed","organization_members_guard_managed"])assert.match(migration,new RegExp(`create trigger ${name}`));
});
test("panel cannot reopen a unit held by the platform",()=>assert.match(migration,/requested_status='active' and held then raise exception/));
test("application code only writes granted columns",()=>{
  for(const table of ["establishments","organizations"]){
    const writes=clientWrites(table),allowed=granted(table);
    assert.ok(writes.length>0,`expected client writes to ${table}`);
    for(const{path,method,payload}of writes){
      assert.equal(method,"update",`${path} must not ${method} ${table} from the client`);
      for(const[,column]of payload.matchAll(/(\w+)\s*:/g))assert.ok(allowed.has(column),`${path} writes protected column ${column}`);
    }
  }
});
test("application code does not write membership from the client",()=>{
  for(const table of ["establishment_members","organization_members"]){
    const writes=sources.flatMap(path=>[...readFileSync(path,"utf8").matchAll(new RegExp(`([\\w$]+)\\s*\\.from\\(["'\`]${table}["'\`]\\)\\s*\\.(update|upsert|insert|delete)\\(`,"g"))].filter(match=>!SERVICE_CLIENTS.has(match[1])).map(()=>path));
    assert.deepEqual(writes,[]);
  }
});
