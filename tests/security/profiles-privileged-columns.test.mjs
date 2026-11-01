import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
const root=fileURLToPath(new URL("../../",import.meta.url));
const migration=readFileSync(join(root,"supabase/migrations/20261101052347_profiles_privileged_columns_hardening.sql"),"utf8");
const SAFE=new Set(["full_name","phone","last_login_at"]);
const walk=dir=>readdirSync(dir).flatMap(name=>{const path=join(dir,name);return statSync(path).isDirectory()?walk(path):/\.(ts|tsx|mjs|js)$/.test(name)?[path]:[];});
const sources=["app","lib","components","supabase/functions"].flatMap(dir=>walk(join(root,dir)));

test("client roles lose table-wide write access to profiles",()=>assert.match(migration,/revoke insert, update on public\.profiles from public, anon, authenticated;/));
test("authenticated only receives update on the safe columns",()=>{
  const grants=[...migration.matchAll(/grant update \(([^)]+)\) on public\.profiles to authenticated;/g)];
  assert.equal(grants.length,1);
  assert.deepEqual(new Set(grants[0][1].split(",").map(column=>column.trim())),SAFE);
});
test("no later grant reopens the table to client roles",()=>assert.doesNotMatch(migration,/grant[^;]*on public\.profiles to[^;]*\b(anon|public)\b/));
test("trigger guards privileged columns for client roles",()=>{
  assert.match(migration,/current_user in \('anon', 'authenticated'\)/);
  for(const column of ["id","is_superadmin","status","created_at"])assert.match(migration,new RegExp(`new\\.${column} is distinct from old\\.${column}`));
  assert.match(migration,/before insert or update on public\.profiles/);
});
test("application code only writes the safe profile columns",()=>{
  const writes=sources.flatMap(path=>[...readFileSync(path,"utf8").matchAll(/\.from\(["'`]profiles["'`]\)\s*\.(update|upsert|insert|delete)\(\s*(\{[^}]*\})?/g)].map(match=>({path,method:match[1],payload:match[2]||""})));
  assert.ok(writes.length>0,"expected the after-login write to be found");
  for(const{path,method,payload}of writes){
    assert.equal(method,"update",`${path} must not ${method} profiles from the app`);
    for(const[,column]of payload.matchAll(/(\w+)\s*:/g))assert.ok(SAFE.has(column),`${path} writes protected column ${column}`);
  }
});
