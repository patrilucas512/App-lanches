import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync,execFileSync } from "node:child_process";
import { mkdirSync,mkdtempSync,rmSync,writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname,join } from "node:path";
import { fileURLToPath } from "node:url";
const script=fileURLToPath(new URL("../../scripts/quality/migration-safety.mjs",import.meta.url));
const SAFE="alter table public.t add column note text;\n",HAZARD="create index t_note_idx on public.t(note);\n";
const repo=t=>{
  const cwd=mkdtempSync(join(tmpdir(),"migration-safety-"));t.after(()=>rmSync(cwd,{recursive:true,force:true}));
  const git=(...args)=>execFileSync("git",["-c","user.name=ci","-c","user.email=ci@example.test","-c","commit.gpgsign=false","-c","core.autocrlf=false",...args],{cwd,encoding:"utf8",stdio:["ignore","pipe","pipe"]});
  const commit=(name,sql)=>{const path=join(cwd,name);mkdirSync(dirname(path),{recursive:true});writeFileSync(path,sql);git("add","-A");git("commit","-m",name);};
  git("init","-b","main");commit("README.md","base\n");
  // Same shape as refs/pull/N/merge: a merge commit whose first parent is the base and whose second parent is the PR tip.
  const checkoutPullRequestMerge=()=>{git("checkout","--detach","main");git("merge","--no-ff","-m","pr merge","feature");};
  return {cwd,git,commit,checkoutPullRequestMerge};
};
const gate=(cwd,event="pull_request")=>spawnSync(process.execPath,[script],{cwd,encoding:"utf8",env:{...process.env,GITHUB_EVENT_NAME:event}});

test("fails on a hazardous migration outside the last commit of the PR",t=>{
  const {cwd,git,commit,checkoutPullRequestMerge}=repo(t);
  git("checkout","-b","feature");
  commit("supabase/migrations/1_hazard.sql",HAZARD);
  commit("supabase/migrations/2_safe.sql",SAFE);
  commit("docs/notes.md","last commit touches no migration\n");
  checkoutPullRequestMerge();
  const result=gate(cwd);
  assert.equal(result.status,1,result.stderr);
  assert.match(result.stderr,/1_hazard\.sql: review required for index may lock writes/);
  assert.doesNotMatch(result.stderr,/2_safe\.sql/);
});

test("passes when the branch only merged main, even if main carries a hazardous migration",t=>{
  const {cwd,git,commit,checkoutPullRequestMerge}=repo(t);
  git("checkout","-b","feature");
  commit("docs/notes.md","no migration here\n");
  git("checkout","main");
  commit("supabase/migrations/1_from_main.sql",HAZARD);
  git("checkout","feature");
  git("merge","--no-ff","-m","sync main","main");
  git("checkout","main");
  commit("supabase/migrations/2_newer_on_main.sql",HAZARD);
  checkoutPullRequestMerge();
  const result=gate(cwd);
  assert.equal(result.status,0,result.stderr);
  assert.match(result.stdout,/passed for 0 changed file/);
});

test("still reports the PR's own migration after a merge of main",t=>{
  const {cwd,git,commit,checkoutPullRequestMerge}=repo(t);
  git("checkout","-b","feature");
  commit("supabase/migrations/2_own.sql",HAZARD);
  git("checkout","main");
  commit("supabase/migrations/1_from_main.sql",SAFE);
  git("checkout","feature");
  git("merge","--no-ff","-m","sync main","main");
  checkoutPullRequestMerge();
  const result=gate(cwd);
  assert.equal(result.status,1,result.stderr);
  assert.match(result.stderr,/2_own\.sql/);
  assert.doesNotMatch(result.stderr,/1_from_main\.sql/);
});

test("passes on a non-concurrent index with the allow marker",t=>{
  const {cwd,git,commit,checkoutPullRequestMerge}=repo(t);
  git("checkout","-b","feature");
  commit("supabase/migrations/1_new_table.sql",`-- quality: allow-nonconcurrent-index reason=new-empty-feature-tables\ncreate table public.t(note text);\n${HAZARD}`);
  commit("docs/notes.md","later commit\n");
  checkoutPullRequestMerge();
  const result=gate(cwd);
  assert.equal(result.status,0,result.stderr);
  assert.match(result.stdout,/passed for 1 changed file/);
});

test("fails closed when the range cannot be evaluated",t=>{
  const {cwd,git,commit}=repo(t);
  git("checkout","-b","feature");
  commit("supabase/migrations/1_hazard.sql",HAZARD);
  // HEAD is not a merge commit, so HEAD^2 does not exist: an unevaluated PR must not count as passed.
  const result=gate(cwd);
  assert.equal(result.status,2,result.stderr);
  assert.match(result.stderr,/could not evaluate/);
});

test("outside a pull request it keeps checking only the last commit",t=>{
  const {cwd,git,commit}=repo(t);
  git("checkout","-b","feature");
  commit("supabase/migrations/1_hazard.sql",HAZARD);
  commit("docs/notes.md","last commit touches no migration\n");
  assert.equal(gate(cwd,"workflow_dispatch").status,0);
});
