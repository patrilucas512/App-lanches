import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const migration=readFileSync(new URL("../../supabase/migrations/20261012185858_quality_release_engineering_phase27.sql",import.meta.url),"utf8");
test("quality tables are tenant-safe and protected with RLS",()=>{for(const table of ["qa_pipeline_runs","qa_suite_runs","platform_releases","release_audit_events","quality_feature_flags","qa_regressions"])assert.match(migration,new RegExp(`alter table public\\.${table} enable row level security`));});
test("release audit connects version, actor and rollback",()=>assert.match(migration,/rollback_of[\s\S]*release_audit_events[\s\S]*actor_user_id/));
test("test tenants and environment safeguards are persisted",()=>assert.match(migration,/is_test_organization[\s\S]*test_safety_profile[\s\S]*real_payments_allowed/));

