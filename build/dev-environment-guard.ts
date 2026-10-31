import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseEnv } from "node:util";

const PRODUCTION_SUPABASE_REF = "qjwmjwubtgqginwhmajv";
const ENV_FILES = [".env", ".env.local", ".env.development", ".env.development.local"];
const SUPABASE_URL_VARS = ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_URL"];
const SUPABASE_KEY_VARS = ["NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "SUPABASE_SECRET_KEY", "SUPABASE_SERVICE_ROLE_KEY"];
const PRODUCTION_MODE_VARS = ["MASTERAPP_ENVIRONMENT", "FISCAL_ENVIRONMENT"];
const OPTIONAL_DEV_FEATURES = {
  SUPABASE_SECRET_KEY: "login por senha, página de status e rotas administrativas",
  CUSTOMER_PORTAL_OTP_SECRET: "acesso do cliente ao portal Minha Conta",
  NEXT_PUBLIC_SITE_URL: "links de WhatsApp e retorno de pagamentos Pix",
  STRIPE_SECRET_KEY: "assinaturas pelo Stripe",
  STRIPE_WEBHOOK_SECRET: "sincronização de assinaturas do Stripe",
  OPENAI_API_KEY: "classificação por IA do atendente de WhatsApp",
};

type Env = Record<string, string | undefined>;

// Legacy Supabase keys are JWTs that name their project. `sb_` keys do not, so
// those are only caught through the URL check.
function jwtProjectRef(value: string) {
  try {
    return JSON.parse(Buffer.from(value.split(".")[1] ?? "", "base64url").toString("utf8")).ref as unknown;
  } catch {
    return null;
  }
}

export function findDevEnvironmentProblems(env: Env) {
  const problems: string[] = [];
  for (const name of SUPABASE_URL_VARS) {
    if (env[name]?.toLowerCase().includes(PRODUCTION_SUPABASE_REF)) problems.push(`${name} aponta para o Supabase de PRODUÇÃO.`);
  }
  for (const name of SUPABASE_KEY_VARS) {
    if (env[name] && jwtProjectRef(env[name]) === PRODUCTION_SUPABASE_REF) problems.push(`${name} é uma chave do Supabase de PRODUÇÃO.`);
  }
  if (env.STRIPE_SECRET_KEY && /^(sk|rk)_live_/.test(env.STRIPE_SECRET_KEY.trim())) problems.push("STRIPE_SECRET_KEY é uma chave LIVE. Use uma chave de teste (sk_test_...).");
  for (const name of PRODUCTION_MODE_VARS) {
    if (env[name]?.trim() === "production") problems.push(`${name}=production libera efeitos reais fora de produção.`);
  }
  return problems;
}

export function findMissingDevFeatures(env: Env) {
  return Object.entries(OPTIONAL_DEV_FEATURES).filter(([name]) => !env[name]?.trim()).map(([name, feature]) => `${name}: ${feature}`);
}

// Checks each env file as well as the process environment, because Vite and
// Wrangler do not resolve conflicts between them in the same way.
export function assertSafeDevEnvironment(root: string) {
  const fileSources = ENV_FILES.map((file) => join(root, file)).filter((file) => existsSync(file)).map((file) => parseEnv(readFileSync(file, "utf8")));
  const sources: Env[] = [...fileSources, process.env];
  const merged: Env = Object.assign({}, ...sources);
  const problems = new Set(sources.flatMap((env) => findDevEnvironmentProblems(env)));
  // The payment guard only blocks production gateways when this variable is set.
  if (!merged.MASTERAPP_ENVIRONMENT?.trim()) problems.add("MASTERAPP_ENVIRONMENT está ausente. Defina MASTERAPP_ENVIRONMENT=development.");
  if (problems.size) throw new Error(`Modo de desenvolvimento bloqueado para proteger os dados reais:\n${[...problems].map((problem) => `  - ${problem}`).join("\n")}\nAjuste o .env.local conforme o README (seção "Banco de desenvolvimento").`);
  const missing = findMissingDevFeatures(merged);
  if (missing.length) console.warn(`\nRecursos desativados por falta de variável no .env.local:\n${missing.map((item) => `  - ${item}`).join("\n")}\n`);
}
