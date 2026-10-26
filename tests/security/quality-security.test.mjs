import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const migration=readFileSync(new URL("../../supabase/migrations/20261012185858_quality_release_engineering_phase27.sql",import.meta.url),"utf8");
const api=readFileSync(new URL("../../app/api/quality/route.ts",import.meta.url),"utf8");
test("anonymous roles cannot read quality control tables",()=>assert.match(migration,/revoke all on public\.qa_environments[\s\S]*from public,anon/));
test("mutations require superadmin and confirmation",()=>assert.match(api,/is_superadmin[\s\S]*confirmed !== true/));
test("rollback requires detailed reason and approval state",()=>assert.match(migration,/length\(trim[\s\S]*awaiting_approval/));
test("artifacts redact credentials",()=>assert.match(readFileSync(new URL("../../lib/quality/core.ts",import.meta.url),"utf8"),/token\|secret\|password[\s\S]*\[redacted\]/));

