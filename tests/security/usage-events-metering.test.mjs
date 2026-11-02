import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";

const dir = new URL("../../supabase/migrations/", import.meta.url);
const name = (await readdir(dir)).find(x => x.endsWith("_usage_events_metering_columns.sql"));
const migration = await readFile(new URL(name, dir), "utf8");

test("metering rows no longer need the menu event columns", () => {
  assert.match(migration, /alter column event_type drop not null,alter column establishment_id drop not null/);
});

test("every row is still a menu event or a metering event", () => {
  assert.match(migration, /\(event_type is not null and establishment_id is not null\) or\(meter_key is not null and organization_id is not null\)/);
});

test("the change does not touch or rewrite existing data", () => {
  assert.doesNotMatch(migration, /\b(update|delete|drop table|drop column)\b/i);
});
