import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export const MARKETPLACE_PERMISSIONS = [
  "marketplaces:view", "marketplaces:connect", "marketplaces:disconnect", "marketplaces:manage_settings",
  "marketplaces:manage_catalog_mapping", "marketplaces:sync_catalog", "marketplaces:manage_prices",
  "marketplaces:manage_availability", "marketplaces:view_orders", "marketplaces:manage_orders",
  "marketplaces:view_financial", "marketplaces:reconcile", "marketplaces:view_health", "marketplaces:view_network",
] as const;

export const MARKETPLACE_FEATURE_FLAGS = [
  "marketplace_integrations_enabled", "marketplace_catalog_sync_enabled",
  "marketplace_financial_reconciliation_enabled", "marketplace_auto_accept_enabled",
  "marketplace_capacity_sync_enabled",
] as const;

export const MARKETPLACE_COPILOT_TOOLS = [
  "marketplace_connection_diagnose", "marketplace_order_gap_explain", "marketplace_catalog_drift_explain",
  "marketplace_product_mapping_suggest", "marketplace_reconciliation_explain", "marketplace_health_summarize",
  "marketplace_sync_preview", "marketplace_incident_brief",
] as const;

export const MARKETPLACE_CAPABILITIES = [
  "webhook_orders", "polling_orders", "catalog_read", "catalog_write", "price_update", "availability_update",
  "modifier_support", "combo_support", "promotion_support", "order_accept", "order_reject", "order_cancel",
  "ready_status", "dispatch_status", "tracking", "financial_statement", "payout_data",
] as const;

export type MarketplaceCapability = typeof MARKETPLACE_CAPABILITIES[number];
export type CapabilityMatrix = Partial<Record<MarketplaceCapability, boolean>>;
export type ProviderResult<T = unknown> = { supported: boolean; ok: boolean; data?: T; error?: string; retryable?: boolean };

export interface MarketplaceProviderAdapter {
  readonly providerKey: string;
  connect(input: unknown): Promise<ProviderResult>;
  disconnect(input: unknown): Promise<ProviderResult>;
  refreshCredentials(input: unknown): Promise<ProviderResult>;
  getCapabilities(): Promise<CapabilityMatrix>;
  fetchStores(input?: unknown): Promise<ProviderResult>;
  fetchCatalog(input?: unknown): Promise<ProviderResult>;
  pushCatalog(input: unknown): Promise<ProviderResult>;
  updateProduct(input: unknown): Promise<ProviderResult>;
  updateAvailability(input: unknown): Promise<ProviderResult>;
  updatePrice(input: unknown): Promise<ProviderResult>;
  getOrders(input?: unknown): Promise<ProviderResult>;
  acknowledgeOrder(input: unknown): Promise<ProviderResult>;
  rejectOrder(input: unknown): Promise<ProviderResult>;
  updateOrderStatus(input: unknown): Promise<ProviderResult>;
  cancelOrder(input: unknown): Promise<ProviderResult>;
  getFinancialStatements(input?: unknown): Promise<ProviderResult>;
  getPayouts(input?: unknown): Promise<ProviderResult>;
  getHealth(): Promise<ProviderResult>;
}

export class CapabilityAwareMarketplaceAdapter implements MarketplaceProviderAdapter {
  public readonly providerKey: string;
  private readonly capabilities: CapabilityMatrix;
  constructor(providerKey: string, capabilities: CapabilityMatrix = {}) { this.providerKey = providerKey; this.capabilities = capabilities; }
  private unsupported(name: MarketplaceCapability | string): Promise<ProviderResult> { return Promise.resolve({ supported: false, ok: false, error: `Capability ${name} não suportada.` }); }
  private result(capability: MarketplaceCapability, data: unknown = {}): Promise<ProviderResult> { return this.capabilities[capability] ? Promise.resolve({ supported: true, ok: true, data }) : this.unsupported(capability); }
  connect(input: unknown) { return Promise.resolve({ supported: true, ok: true, data: input }); }
  disconnect(input: unknown) { return Promise.resolve({ supported: true, ok: true, data: input }); }
  refreshCredentials(input: unknown) { return Promise.resolve({ supported: true, ok: true, data: input }); }
  getCapabilities() { return Promise.resolve({ ...this.capabilities }); }
  fetchStores(input?: unknown) { return Promise.resolve({ supported: true, ok: true, data: input ?? [] }); }
  fetchCatalog(input?: unknown) { return this.result("catalog_read", input); }
  pushCatalog(input: unknown) { return this.result("catalog_write", input); }
  updateProduct(input: unknown) { return this.result("catalog_write", input); }
  updateAvailability(input: unknown) { return this.result("availability_update", input); }
  updatePrice(input: unknown) { return this.result("price_update", input); }
  getOrders(input?: unknown) { return this.result("polling_orders", input); }
  acknowledgeOrder(input: unknown) { return this.result("order_accept", input); }
  rejectOrder(input: unknown) { return this.result("order_reject", input); }
  updateOrderStatus(input: unknown) { return this.result("ready_status", input); }
  cancelOrder(input: unknown) { return this.result("order_cancel", input); }
  getFinancialStatements(input?: unknown) { return this.result("financial_statement", input); }
  getPayouts(input?: unknown) { return this.result("payout_data", input); }
  getHealth() { return Promise.resolve({ supported: true, ok: true, data: { provider: this.providerKey, capabilities: this.capabilities } }); }
}

export function assertCapability(matrix: CapabilityMatrix, capability: MarketplaceCapability) {
  if (!matrix[capability]) throw new Error(`capability_not_supported:${capability}`);
}

export function verifyMarketplaceWebhook(input: { rawBody: string; signature: string; timestamp: string; secret: string; now?: number; toleranceSeconds?: number }) {
  const timestamp = Number(input.timestamp);
  const now = input.now ?? Date.now();
  if (!Number.isFinite(timestamp) || Math.abs(now - timestamp * 1000) > (input.toleranceSeconds ?? 300) * 1000) return false;
  const expected = createHmac("sha256", input.secret).update(`${input.timestamp}.${input.rawBody}`).digest("hex");
  const actual = input.signature.replace(/^sha256=/, "");
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(actual), Buffer.from(expected));
}

export function payloadHash(rawBody: string) { return createHash("sha256").update(rawBody).digest("hex"); }

export type ExternalItem = { externalId: string; sku?: string | null; barcode?: string | null; externalReference?: string | null; name?: string | null };
export type InternalItem = { id: string; sku?: string | null; barcode?: string | null; externalReference?: string | null; name?: string | null };
export function matchMarketplaceProduct(external: ExternalItem, internal: InternalItem[], explicit?: Record<string, string>) {
  const explicitId = explicit?.[external.externalId];
  if (explicitId) return { internalId: explicitId, method: "explicit", reviewRequired: false };
  const fields: Array<[keyof ExternalItem, keyof InternalItem, string]> = [["sku", "sku", "sku"], ["barcode", "barcode", "barcode"], ["externalReference", "externalReference", "external_reference"]];
  for (const [externalKey, internalKey, method] of fields) {
    const value = String(external[externalKey] ?? "").trim().toLowerCase();
    if (!value) continue;
    const matches = internal.filter(item => String(item[internalKey] ?? "").trim().toLowerCase() === value);
    if (matches.length === 1) return { internalId: matches[0].id, method, reviewRequired: false };
  }
  const suggested = internal.find(item => external.name && item.name?.toLowerCase() === external.name.toLowerCase());
  return { internalId: suggested?.id ?? null, method: suggested ? "name_suggestion" : "unmatched", reviewRequired: true };
}

export function mapMarketplaceStatus(externalStatus: string, mappings: Record<string, string>) {
  return mappings[externalStatus] ?? "manual_review";
}

export function shouldAutoAccept(input: { capability: boolean; mappingsValid: boolean; capacityAvailable: boolean; paymentValid: boolean; fulfillmentValid: boolean; policyEnabled: boolean }) {
  return Object.values(input).every(Boolean);
}

export function calculateBackoff(attempt: number, retryAfterSeconds?: number) {
  if (retryAfterSeconds && retryAfterSeconds > 0) return Math.min(retryAfterSeconds, 3600);
  return Math.min(5 * 2 ** Math.max(0, attempt - 1), 1800);
}

export function resolveCancellationState(providerConfirmed: boolean, providerFailed: boolean) {
  if (providerConfirmed) return "cancelled";
  if (providerFailed) return "cancel_failed";
  return "provider_pending";
}

export function reconcileMarketplacePayout(expectedCents: number, paidCents: number, toleranceCents: number) {
  const differenceCents = paidCents - expectedCents;
  return { differenceCents, status: Math.abs(differenceCents) <= toleranceCents ? "matched" : "divergent" };
}

export function redactMarketplacePayload(payload: Record<string, unknown>) {
  const blocked = new Set(["token", "access_token", "refresh_token", "secret", "authorization", "customer_phone", "customer_email"]);
  return Object.fromEntries(Object.entries(payload).map(([key, value]) => [key, blocked.has(key.toLowerCase()) ? "[REDACTED]" : value]));
}
