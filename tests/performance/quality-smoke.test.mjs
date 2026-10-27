import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const smoke=readFileSync(new URL("../../scripts/quality/smoke-test.mjs",import.meta.url),"utf8");
test("performance smoke is read-only and checks critical public surfaces",()=>{assert.match(smoke,/GET/);assert.match(smoke,/\/api\/health/);assert.doesNotMatch(smoke,/method:\s*["']POST/);});

