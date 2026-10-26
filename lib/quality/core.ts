import { createHash } from "node:crypto";

export type RuntimeEnvironment = "development" | "staging" | "production";
export type ExternalEffect = "payment" | "fiscal" | "whatsapp" | "email";

export function runtimeEnvironment(): RuntimeEnvironment {
  const value = process.env.MASTERAPP_ENVIRONMENT || process.env.NODE_ENV || "development";
  return value === "production" || value === "staging" ? value : "development";
}

export function assertSafeTestTarget(input: { environment?: string; productionUrl?: string; targetUrl?: string }) {
  const environment = input.environment || process.env.TEST_ENVIRONMENT || runtimeEnvironment();
  if (environment === "production") throw new Error("Automated tests are blocked against production.");
  if (input.productionUrl && input.targetUrl && new URL(input.productionUrl).origin === new URL(input.targetUrl).origin) {
    throw new Error("Test target matches the production origin.");
  }
}

export function assertExternalEffectAllowed(effect: ExternalEffect, requestedMode: "test" | "production") {
  const environment = runtimeEnvironment();
  if (environment !== "production" && requestedMode === "production") {
    throw new Error(`${effect} production mode is blocked outside production.`);
  }
}

export function rolloutBucket(flagKey: string, subjectId: string) {
  const digest = createHash("sha256").update(`${flagKey}:${subjectId}`).digest();
  return digest.readUInt32BE(0) % 100;
}

export function isFeatureEnabled(input: {
  flagKey: string; subjectId: string; enabled: boolean; killSwitch?: boolean;
  rolloutPercent?: number; internalOnly?: boolean; internalUser?: boolean;
  targetOrganizationIds?: string[]; organizationId?: string | null;
  targetPlanCodes?: string[]; planCode?: string | null;
}) {
  if (!input.enabled || input.killSwitch) return false;
  if (input.internalOnly && !input.internalUser) return false;
  if (input.organizationId && input.targetOrganizationIds?.includes(input.organizationId)) return true;
  if (input.planCode && input.targetPlanCodes?.includes(input.planCode)) return true;
  return rolloutBucket(input.flagKey, input.subjectId) < Math.max(0, Math.min(100, input.rolloutPercent || 0));
}

export function sanitizeQaArtifact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitizeQaArtifact);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, child]) => [
    key,
    /token|secret|password|authorization|cookie|private.?key/i.test(key) ? "[redacted]" : sanitizeQaArtifact(child),
  ]));
}

export function moneyCents(parts: number[]) {
  if (parts.some(value => !Number.isSafeInteger(value))) throw new Error("Money must use integer cents.");
  return parts.reduce((total, value) => total + value, 0);
}

