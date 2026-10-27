import { spawnSync } from "node:child_process";

const knownDiagnostics = new Set([
  "app/api/omnichannel/messages/route.ts:TS18047",
  "app/api/public-capacity/route.ts:TS18047",
  "app/api/public-capacity/route.ts:TS2345",
  "app/api/sales-crm/route.ts:TS18047",
  "app/api/sales-crm/route.ts:TS2345",
  "app/api/whatsapp/crm/templates/route.ts:TS18047",
  "app/api/whatsapp/crm/test/route.ts:TS18047",
  "app/api/whatsapp/crm/test/route.ts:TS2339",
  "lib/ai-attendant/config.ts:TS2339",
  "lib/ai-attendant/order-conversation.ts:TS2352",
  "lib/integrations/public-api.ts:TS2339",
  "lib/integrations/public-api.ts:TS2698",
  "lib/knowledge_base/core.ts:TS2769",
  "lib/knowledge_base/core.ts:TS1501",
  "lib/security/core.ts:TS18047",
  "lib/security/core.ts:TS2339",
]);

const result = spawnSync(process.execPath, ["node_modules/typescript/bin/tsc", "--noEmit", "--pretty", "false", "-p", "tsconfig.app.json"], {
  encoding: "utf8",
});
const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
if (result.status === 0) {
  console.log("TypeScript check passed without diagnostics.");
  process.exit(0);
}

const diagnostics = [...output.matchAll(/^(.+?)\(\d+,\d+\): error (TS\d+):/gm)].map((match) => ({
  key: `${match[1].replaceAll("\\", "/")}:${match[2]}`,
  line: match[0],
}));
const unexpected = diagnostics.filter(({ key }) => !knownDiagnostics.has(key));
if (unexpected.length || diagnostics.length === 0) {
  process.stderr.write(output);
  console.error(`TypeScript baseline rejected ${unexpected.length || "unparsed"} new diagnostic(s).`);
  process.exit(1);
}

console.log(`TypeScript baseline accepted ${diagnostics.length} known legacy diagnostic(s); no new errors.`);
