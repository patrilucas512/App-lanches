import { createHash } from "node:crypto";

export const CATALOG_PERMISSIONS = [
  "catalog:view",
  "catalog:create_product",
  "catalog:edit_product",
  "catalog:manage_categories",
  "catalog:manage_modifiers",
  "catalog:manage_combos",
  "catalog:manage_prices",
  "catalog:publish",
  "catalog:schedule_publish",
  "catalog:manage_governance",
  "catalog:view_cost",
  "catalog:manage_network",
  "catalog:import",
  "catalog:export",
] as const;

export const CATALOG_COPILOT_TOOLS = [
  "searchCatalogProducts",
  "getProductDetails",
  "getCatalogHealth",
  "getPendingCatalogChanges",
  "getPriceHistory",
  "getProductAvailability",
  "getCatalogDistributionStatus",
] as const;

export const CATALOG_CHANNELS = ["dine_in", "waiter", "qr", "delivery", "pickup", "kiosk", "whatsapp", "web", "third_party"] as const;
export type CatalogChannel = (typeof CATALOG_CHANNELS)[number];
export type FieldPolicy = "inherit" | "locked" | "override_allowed" | "local_only";

export type CatalogProduct = {
  id: string;
  organizationId: string;
  storeId: string;
  categoryId?: string | null;
  masterProductId?: string | null;
  sku?: string | null;
  barcode?: string | null;
  internalCode?: string | null;
  name: string;
  description?: string | null;
  priceCents: number;
  status: "draft" | "active" | "inactive" | "archived" | "discontinued";
  productType: "simple" | "variant_product" | "combo" | "bundle" | "service_item" | "custom";
  imageUrl?: string | null;
};

export type PriceCandidate = {
  priceCents: number;
  scope: "organization" | "brand" | "region" | "store";
  scopeId?: string | null;
  channel?: CatalogChannel | null;
  fulfillmentMethod?: string | null;
  effectiveFrom?: string | null;
  effectiveUntil?: string | null;
  sourceId?: string;
};

export type PriceContext = {
  now: Date;
  organizationId: string;
  brandId?: string | null;
  regionId?: string | null;
  storeId: string;
  channel?: CatalogChannel | null;
  fulfillmentMethod?: string | null;
  timezone?: string;
};

const activeAt = (candidate: PriceCandidate, now: Date) =>
  (!candidate.effectiveFrom || new Date(candidate.effectiveFrom) <= now) &&
  (!candidate.effectiveUntil || new Date(candidate.effectiveUntil) > now);

export class CatalogPriceResolver {
  static resolve(candidates: PriceCandidate[], context: PriceContext, defaultPriceCents: number) {
    const eligible = candidates.filter((candidate) => {
      if (!activeAt(candidate, context.now)) return false;
      if (candidate.scope === "store" && candidate.scopeId !== context.storeId) return false;
      if (candidate.scope === "region" && candidate.scopeId !== context.regionId) return false;
      if (candidate.scope === "brand" && candidate.scopeId !== context.brandId) return false;
      if (candidate.scope === "organization" && candidate.scopeId && candidate.scopeId !== context.organizationId) return false;
      if (candidate.channel && candidate.channel !== context.channel) return false;
      if (candidate.fulfillmentMethod && candidate.fulfillmentMethod !== context.fulfillmentMethod) return false;
      return true;
    });
    const rank = (candidate: PriceCandidate) => {
      let value = candidate.scope === "store" ? 400 : candidate.scope === "region" ? 300 : candidate.scope === "brand" ? 200 : 100;
      if (candidate.scope === "store" && candidate.channel) value += 40;
      if (candidate.fulfillmentMethod) value += 20;
      return value;
    };
    const winner = [...eligible].sort((a, b) => rank(b) - rank(a) || Number(new Date(b.effectiveFrom || 0)) - Number(new Date(a.effectiveFrom || 0)))[0];
    return { priceCents: winner?.priceCents ?? defaultPriceCents, source: winner?.sourceId ?? "product_default", precedence: winner ? rank(winner) : 0 };
  }
}

export type AvailabilityInput = {
  manualActive: boolean;
  storeOpen: boolean;
  channelEnabled: boolean;
  withinSchedule: boolean;
  temporaryBlocked?: boolean;
  stockAvailable?: boolean;
  recipeComponentsAvailable?: boolean;
  stockPolicy?: "warn_only" | "auto_disable" | "manual_control";
};

export class CatalogAvailabilityResolver {
  static resolve(input: AvailabilityInput) {
    if (!input.manualActive) return { available: false, reason: "manual_disabled", customerMessage: "Temporariamente indisponível." };
    if (!input.storeOpen) return { available: false, reason: "store_closed", customerMessage: "Loja fechada no momento." };
    if (!input.channelEnabled) return { available: false, reason: "channel_disabled", customerMessage: "Indisponível neste canal." };
    if (!input.withinSchedule) return { available: false, reason: "schedule", customerMessage: "Indisponível neste horário." };
    if (input.temporaryBlocked) return { available: false, reason: "temporary_block", customerMessage: "Temporariamente indisponível." };
    if (input.stockPolicy === "auto_disable" && input.stockAvailable === false) return { available: false, reason: "out_of_stock", customerMessage: "Temporariamente indisponível." };
    if (input.stockPolicy === "auto_disable" && input.recipeComponentsAvailable === false) return { available: false, reason: "recipe_component_unavailable", customerMessage: "Temporariamente indisponível." };
    return { available: true, reason: null, customerMessage: null, warning: input.stockPolicy === "warn_only" && input.stockAvailable === false ? "low_or_missing_stock" : null };
  }
}

export class CatalogFieldResolver {
  static resolve(master: Record<string, unknown>, override: Record<string, unknown>, policies: Record<string, FieldPolicy>) {
    const result: Record<string, unknown> = { ...master };
    const blocked: string[] = [];
    for (const [field, value] of Object.entries(override)) {
      const policy = policies[field] ?? "inherit";
      if (policy === "locked" || policy === "inherit") blocked.push(field);
      else result[field] = value;
    }
    return { value: result, blockedFields: blocked, drift: Object.keys(override).map((field) => ({ field, status: blocked.includes(field) ? "conflict" : "expected" })) };
  }
}

type ValidationIssue = { severity: "error" | "warning" | "info"; code: string; entityId?: string; message: string };

export class CatalogValidationService {
  static validate(input: {
    products: CatalogProduct[];
    modifierGroups?: Array<{ id: string; minSelect: number; maxSelect: number }>;
    combos?: Array<{ id: string; components: Array<{ minSelect: number; maxSelect: number; sourceId?: string | null }> }>;
    channelAssignments?: Array<{ productId: string; channels: string[] }>;
  }) {
    const issues: ValidationIssue[] = [];
    const keys = new Map<string, string>();
    for (const product of input.products) {
      if (!product.categoryId) issues.push({ severity: "error", code: "missing_category", entityId: product.id, message: `${product.name} não possui categoria.` });
      if (!Number.isInteger(product.priceCents) || product.priceCents < 0) issues.push({ severity: "error", code: "invalid_price", entityId: product.id, message: `${product.name} possui preço inválido.` });
      if (!product.imageUrl) issues.push({ severity: "warning", code: "missing_image", entityId: product.id, message: `${product.name} está sem imagem.` });
      const identifiers = [["sku", product.sku], ["barcode", product.barcode], ["internal_code", product.internalCode]] as const;
      for (const [kind, raw] of identifiers) {
        const value = raw?.trim().toLocaleLowerCase("pt-BR");
        if (!value) continue;
        const key = `${kind}:${product.organizationId}:${value}`;
        if (keys.has(key)) issues.push({ severity: "error", code: `duplicate_${kind}`, entityId: product.id, message: `${kind.toUpperCase()} duplicado com ${keys.get(key)}.` });
        else keys.set(key, product.name);
      }
    }
    for (const group of input.modifierGroups ?? []) if (group.minSelect < 0 || group.maxSelect < group.minSelect) issues.push({ severity: "error", code: "invalid_modifier_limits", entityId: group.id, message: "O mínimo do modificador deve ser menor ou igual ao máximo." });
    for (const combo of input.combos ?? []) for (const component of combo.components) if (!component.sourceId || component.minSelect < 0 || component.maxSelect < component.minSelect) issues.push({ severity: "error", code: "broken_combo", entityId: combo.id, message: "Combo possui componente ou limites inválidos." });
    for (const product of input.products) if (!(input.channelAssignments ?? []).some((assignment) => assignment.productId === product.id && assignment.channels.length)) issues.push({ severity: "warning", code: "missing_channel_assignment", entityId: product.id, message: `${product.name} não possui canal configurado.` });
    return { valid: !issues.some((issue) => issue.severity === "error"), issues, counts: { errors: issues.filter((i) => i.severity === "error").length, warnings: issues.filter((i) => i.severity === "warning").length, info: issues.filter((i) => i.severity === "info").length } };
  }
}

export class CatalogChangesetService {
  static diff(before: Record<string, unknown>, after: Record<string, unknown>) {
    return [...new Set([...Object.keys(before), ...Object.keys(after)])].flatMap((field) => Object.is(before[field], after[field]) ? [] : [{ field, before: before[field] ?? null, after: after[field] ?? null }]);
  }
  static preview(items: Array<{ entityType: string; operation: string; before?: Record<string, unknown>; after?: Record<string, unknown>; storeIds?: string[] }>) {
    const stores = new Set(items.flatMap((item) => item.storeIds ?? []));
    const priceChanges = items.filter((item) => item.entityType === "price" || Object.prototype.hasOwnProperty.call(item.after ?? {}, "price_cents"));
    return { affectedItems: items.length, affectedStores: stores.size, priceChanges: priceChanges.length, destructiveOperations: items.filter((item) => ["archive", "disable", "remove"].includes(item.operation)).length, requiresConfirmation: true, noActionsExecuted: true };
  }
  static rollback(items: Array<{ entityType: string; entityId: string; before?: Record<string, unknown>; after?: Record<string, unknown> }>) {
    return items.map((item) => ({ entityType: item.entityType, entityId: item.entityId, before: item.after ?? {}, after: item.before ?? {}, operation: "rollback" }));
  }
}

export class CatalogDistributionService {
  static resolveConflict(policy: "preserve_local" | "overwrite_allowed_fields" | "require_review", localOverrides: Record<string, unknown>, allowedFields: string[]) {
    if (!Object.keys(localOverrides).length) return { status: "applied", patch: {}, conflicts: [] as string[] };
    if (policy === "preserve_local") return { status: "skipped", patch: {}, conflicts: Object.keys(localOverrides) };
    if (policy === "require_review") return { status: "conflict", patch: {}, conflicts: Object.keys(localOverrides) };
    const patch = Object.fromEntries(Object.entries(localOverrides).filter(([field]) => allowedFields.includes(field)));
    const conflicts = Object.keys(localOverrides).filter((field) => !allowedFields.includes(field));
    return { status: conflicts.length ? "conflict" : "applied", patch, conflicts };
  }
}

export class CatalogImportService {
  static sanitizeCell(value: unknown) {
    const text = String(value ?? "").trim();
    return /^[=+\-@]/.test(text) ? `'${text}` : text;
  }
  static duplicateKey(row: { sku?: string | null; barcode?: string | null; internalCode?: string | null }) {
    if (row.sku?.trim()) return `sku:${row.sku.trim().toLowerCase()}`;
    if (row.barcode?.trim()) return `barcode:${row.barcode.trim().toLowerCase()}`;
    if (row.internalCode?.trim()) return `internal:${row.internalCode.trim().toLowerCase()}`;
    return null;
  }
  static validateRows(rows: Array<Record<string, unknown>>, mode: "create_only" | "update_existing" | "create_and_update") {
    const seen = new Map<string, number>();
    return rows.map((row, index) => {
      const key = this.duplicateKey({ sku: String(row.sku ?? "") || null, barcode: String(row.barcode ?? "") || null, internalCode: String(row.internal_code ?? "") || null });
      const errors: string[] = [];
      if (!String(row.name ?? "").trim()) errors.push("missing_name");
      if (mode === "update_existing" && !key) errors.push("reliable_identifier_required");
      if (key && seen.has(key)) errors.push(`duplicate_row:${seen.get(key)}`);
      if (key) seen.set(key, index + 1);
      return { rowNumber: index + 1, identifier: key, valid: errors.length === 0, errors, sanitized: Object.fromEntries(Object.entries(row).map(([field, value]) => [field, this.sanitizeCell(value)])) };
    });
  }
}

export class CatalogReadModelService {
  static versionHash(payload: unknown) { return createHash("sha256").update(JSON.stringify(payload)).digest("hex"); }
  static materialize(input: { storeId: string; channel: string; menuVersionId: string; products: Array<Record<string, unknown>> }) {
    const payload = { storeId: input.storeId, channel: input.channel, menuVersionId: input.menuVersionId, products: input.products };
    return { ...payload, versionHash: this.versionHash(payload), fallbackSafe: input.products.length > 0, generatedAt: new Date().toISOString() };
  }
}

export class CatalogHealthService {
  static summarize(products: Array<{ imageUrl?: string | null; description?: string | null; active: boolean; recipeLinked?: boolean; channels?: string[] }>, invalidModifiers = 0, duplicateCandidates = 0) {
    return {
      totalProducts: products.length,
      productsWithoutImage: products.filter((p) => !p.imageUrl).length,
      productsWithoutDescription: products.filter((p) => !p.description).length,
      productsUnavailable: products.filter((p) => !p.active).length,
      productsWithoutRecipe: products.filter((p) => !p.recipeLinked).length,
      missingChannelAssignment: products.filter((p) => !(p.channels ?? []).length).length,
      invalidModifiers,
      duplicateCandidates,
      transparentChecklist: true,
    };
  }
}

export function validateCategoryDepth(parentById: Map<string, string | null>, categoryId: string, maxDepth = 3) {
  let current: string | null | undefined = categoryId;
  let depth = 0;
  const visited = new Set<string>();
  while (current) {
    if (visited.has(current)) return { valid: false, reason: "cycle", depth };
    visited.add(current); depth += 1;
    if (depth > maxDepth) return { valid: false, reason: "max_depth", depth };
    current = parentById.get(current);
  }
  return { valid: true, reason: null, depth };
}

export function validateOrderSnapshot(item: { product_name?: string; unit_price_cents?: number; quantity?: number; addons?: unknown }) {
  return Boolean(item.product_name && Number.isInteger(item.unit_price_cents) && Number(item.unit_price_cents) >= 0 && Number(item.quantity) > 0 && item.addons !== undefined);
}
