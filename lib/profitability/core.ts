export type CostStatus = "complete" | "partial" | "missing" | "outdated";
export type MenuClass = "star" | "popular_low_margin" | "profitable_low_sales" | "low_sales_low_margin";
export type ProductHealth = "strong" | "watch" | "critical" | "insufficient_data";

export type RecipeCostLine = {
  inventoryItemId: string;
  name?: string;
  quantity: number;
  averageCostCents: number | null;
  updatedAt?: string | null;
};

export type CostConfig = {
  packagingCents?: number;
  marketplaceFeeCents?: number;
  gatewayFeeCents?: number;
  deliverySubsidyCents?: number;
  otherVariableCents?: number;
};

const finite = (value: unknown) => Number.isFinite(Number(value)) ? Number(value) : 0;
const round = (value: number) => Math.round(value * 100) / 100;
const median = (values: number[]) => {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b), middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};

export function calculateProductCost(lines: RecipeCostLine[], config: CostConfig = {}, now = new Date()) {
  const variableExtras = finite(config.packagingCents) + finite(config.marketplaceFeeCents) + finite(config.gatewayFeeCents) + finite(config.deliverySubsidyCents) + finite(config.otherVariableCents);
  if (!lines.length) return { ingredientCostCents: null, additionalVariableCostCents: variableExtras, totalVariableCostCents: null, status: "missing" as CostStatus, completeness: 0, components: [] };
  let known = 0, ingredientCost = 0, outdated = false;
  const components = lines.map(line => {
    const hasCost = line.averageCostCents !== null && Number.isFinite(Number(line.averageCostCents));
    if (hasCost) known += 1;
    const costCents = hasCost ? finite(line.quantity) * finite(line.averageCostCents) : null;
    if (costCents !== null) ingredientCost += costCents;
    if (line.updatedAt && now.getTime() - new Date(line.updatedAt).getTime() > 90 * 86400000) outdated = true;
    return { ...line, costCents: costCents === null ? null : round(costCents), sharePercent: 0 };
  });
  const total = ingredientCost + variableExtras;
  const withShares = components.map(item => ({ ...item, sharePercent: item.costCents === null || ingredientCost <= 0 ? 0 : round(item.costCents / ingredientCost * 100) }));
  const status: CostStatus = known === 0 ? "missing" : known < lines.length ? "partial" : outdated ? "outdated" : "complete";
  return { ingredientCostCents: round(ingredientCost), additionalVariableCostCents: round(variableExtras), totalVariableCostCents: round(total), status, completeness: round(known / lines.length * 100), components: withShares };
}

export function calculateMargins(salePriceCents: number, variableCostCents: number | null) {
  if (variableCostCents === null || salePriceCents <= 0) return { grossProductMarginCents: null, contributionMarginEstimateCents: null, marginPercent: null };
  const contribution = finite(salePriceCents) - finite(variableCostCents);
  return { grossProductMarginCents: round(contribution), contributionMarginEstimateCents: round(contribution), marginPercent: round(contribution / salePriceCents * 100) };
}

export function channelAdjustedMargin(input: { salePriceCents: number; productCostCents: number | null; channelFeeCents?: number; channelFeePercent?: number; subsidyCents?: number }) {
  if (input.productCostCents === null || input.salePriceCents <= 0) return { channelAdjustedMarginCents: null, marginPercent: null, channelCostCents: null };
  const channelCost = finite(input.channelFeeCents) + input.salePriceCents * finite(input.channelFeePercent) / 100 + finite(input.subsidyCents);
  const margin = input.salePriceCents - input.productCostCents - channelCost;
  return { channelAdjustedMarginCents: round(margin), marginPercent: round(margin / input.salePriceCents * 100), channelCostCents: round(channelCost) };
}

export function classifyMenuItem(popularity: number, marginPercent: number, popularityThreshold: number, marginThreshold: number): MenuClass {
  if (popularity >= popularityThreshold && marginPercent >= marginThreshold) return "star";
  if (popularity >= popularityThreshold) return "popular_low_margin";
  if (marginPercent >= marginThreshold) return "profitable_low_sales";
  return "low_sales_low_margin";
}

export function normalizeCategoryPopularity<T extends { categoryId: string | null; quantity: number }>(items: T[]) {
  const grouped = new Map<string, number[]>();
  for (const item of items) { const key = item.categoryId || "uncategorized"; grouped.set(key, [...(grouped.get(key) || []), finite(item.quantity)]); }
  return items.map(item => { const values = grouped.get(item.categoryId || "uncategorized") || []; const threshold = median(values); return { ...item, categoryMedianQuantity: threshold, popularityIndex: threshold > 0 ? round(finite(item.quantity) / threshold * 100) : 0 }; });
}

export function buildMenuMatrix<T extends { quantity: number; marginPercent: number | null; categoryId?: string | null }>(items: T[], mode: "global" | "category" = "category") {
  const normalized = mode === "category" ? normalizeCategoryPopularity(items.map(item => ({ ...item, categoryId: item.categoryId || null }))) : items.map(item => ({ ...item, categoryMedianQuantity: median(items.map(row => finite(row.quantity))), popularityIndex: 0 }));
  const globalMargin = median(items.map(item => item.marginPercent).filter((value): value is number => value !== null));
  return normalized.map(item => ({ ...item, classification: item.marginPercent === null ? null : classifyMenuItem(item.quantity, item.marginPercent, item.categoryMedianQuantity, globalMargin), thresholds: { popularity: item.categoryMedianQuantity, marginPercent: globalMargin } }));
}

export function detectMarginCompression(input: { previousPriceCents: number; currentPriceCents: number; previousCostCents: number; currentCostCents: number }) {
  const previous = calculateMargins(input.previousPriceCents, input.previousCostCents).marginPercent || 0;
  const current = calculateMargins(input.currentPriceCents, input.currentCostCents).marginPercent || 0;
  const priceStable = Math.abs(input.currentPriceCents - input.previousPriceCents) / Math.max(1, input.previousPriceCents) < 0.03;
  return { compressed: priceStable && input.currentCostCents > input.previousCostCents && current < previous, previousMarginPercent: previous, currentMarginPercent: current, changePercentagePoints: round(current - previous), costChangePercent: round((input.currentCostCents - input.previousCostCents) / Math.max(1, input.previousCostCents) * 100) };
}

export function targetPriceForMargin(variableCostCents: number, targetMarginPercent: number) {
  if (targetMarginPercent < 0 || targetMarginPercent >= 100) throw new Error("Meta de margem inválida.");
  return Math.ceil(variableCostCents / (1 - targetMarginPercent / 100));
}

export function simulatePriceChange(input: { currentPriceCents: number; newPriceCents: number; variableCostCents: number | null; baselineQuantity?: number; elasticity?: number | null; elasticitySampleSize?: number }) {
  const current = calculateMargins(input.currentPriceCents, input.variableCostCents), next = calculateMargins(input.newPriceCents, input.variableCostCents);
  const elasticityReliable = input.elasticity !== null && input.elasticity !== undefined && finite(input.elasticitySampleSize) >= 30;
  const baseline = finite(input.baselineQuantity), priceChange = input.currentPriceCents > 0 ? (input.newPriceCents - input.currentPriceCents) / input.currentPriceCents : 0;
  const estimatedQuantity = elasticityReliable ? Math.max(0, baseline * (1 + finite(input.elasticity) * priceChange)) : null;
  return { current, next, priceChangePercent: round(priceChange * 100), elasticityReliable, estimatedQuantity: estimatedQuantity === null ? null : round(estimatedQuantity), currentRevenueCents: baseline ? round(baseline * input.currentPriceCents) : null, estimatedRevenueCents: estimatedQuantity === null ? null : round(estimatedQuantity * input.newPriceCents), disclaimer: elasticityReliable ? "Estimativa baseada no histórico disponível; não é garantia." : "Dados insuficientes para estimar impacto na demanda; exibido apenas o impacto matemático na margem." };
}

export function frequentlyBoughtTogether(orders: Array<{ orderId: string; productId: string }>, minimumOrders = 5) {
  const baskets = new Map<string, Set<string>>();
  for (const row of orders) baskets.set(row.orderId, new Set([...(baskets.get(row.orderId) || []), row.productId]));
  const productOrders = new Map<string, number>(), pairs = new Map<string, number>();
  for (const basket of baskets.values()) { const ids = [...basket].sort(); for (const id of ids) productOrders.set(id, (productOrders.get(id) || 0) + 1); for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) pairs.set(`${ids[i]}|${ids[j]}`, (pairs.get(`${ids[i]}|${ids[j]}`) || 0) + 1); }
  return [...pairs.entries()].filter(([, count]) => count >= minimumOrders).map(([key, count]) => { const [productA, productB] = key.split("|"); return { productA, productB, pairOrders: count, support: round(count / Math.max(1, baskets.size)), confidence: round(count / Math.max(1, productOrders.get(productA) || 0)), sampleOrders: baskets.size }; }).sort((a, b) => b.support - a.support);
}

export function simulateCombo(items: Array<{ priceCents: number; costCents: number | null }>, comboPriceCents: number) {
  const individualPriceCents = items.reduce((sum, item) => sum + finite(item.priceCents), 0), known = items.filter(item => item.costCents !== null), totalCostCents = known.length === items.length ? known.reduce((sum, item) => sum + finite(item.costCents), 0) : null;
  const margins = calculateMargins(comboPriceCents, totalCostCents);
  return { individualPriceCents, comboPriceCents, discountCents: individualPriceCents - comboPriceCents, discountPercent: individualPriceCents ? round((individualPriceCents - comboPriceCents) / individualPriceCents * 100) : 0, totalCostCents, ...margins, automaticCreation: false };
}

export function addonAttachRate(addonUses: number, eligibleOrders: number, revenueCents: number, costCents: number | null) {
  return { attachRatePercent: eligibleOrders ? round(addonUses / eligibleOrders * 100) : 0, addonUses, eligibleOrders, revenueCents, margin: calculateMargins(revenueCents, costCents) };
}

export function variantProfitability(priceCents: number, basePriceCents: number, costCents: number | null) { return { effectivePriceCents: basePriceCents + priceCents, ...calculateMargins(basePriceCents + priceCents, costCents) }; }

export function supplierCostImpact(previousCostCents: number, currentCostCents: number) { return { changeCents: round(currentCostCents - previousCostCents), changePercent: previousCostCents ? round((currentCostCents - previousCostCents) / previousCostCents * 100) : null, increasing: currentCostCents > previousCostCents }; }

export function forecastContribution(predictedQuantity: number, unitContributionCents: number | null) { return unitContributionCents === null ? null : round(predictedQuantity * unitContributionCents); }

export function productHealth(costStatus: CostStatus, marginPercent: number | null, targetMarginPercent: number, quantity: number): ProductHealth { if (costStatus === "missing" || costStatus === "partial" || marginPercent === null) return "insufficient_data"; if (marginPercent < Math.max(0, targetMarginPercent - 10)) return "critical"; if (marginPercent < targetMarginPercent || quantity <= 0 || costStatus === "outdated") return "watch"; return "strong"; }

export function buildProfitabilityRecommendations(product: { id: string; name: string; marginPercent: number | null; targetMarginPercent: number; classification: MenuClass | null; costStatus: CostStatus; salePriceCents: number; variableCostCents: number | null }) {
  const result: Array<{ productId: string; type: string; reason: string; impactEstimate: Record<string, unknown>; confidence: string; sourceMetrics: Record<string, unknown>; automaticAction: false }> = [];
  const base = { margin_percent: product.marginPercent, target_margin_percent: product.targetMarginPercent, classification: product.classification, cost_status: product.costStatus };
  if (["missing", "partial"].includes(product.costStatus)) result.push({ productId: product.id, type: "review_recipe", reason: "A ficha técnica está incompleta; não existe margem precisa sem custo confiável.", impactEstimate: {}, confidence: "high", sourceMetrics: base, automaticAction: false });
  if (product.marginPercent !== null && product.marginPercent < product.targetMarginPercent && product.variableCostCents !== null) result.push({ productId: product.id, type: "review_price", reason: "A margem estimada está abaixo da meta configurada.", impactEstimate: { suggested_price_cents: targetPriceForMargin(product.variableCostCents, product.targetMarginPercent), current_price_cents: product.salePriceCents }, confidence: product.costStatus === "complete" ? "high" : "low", sourceMetrics: base, automaticAction: false });
  if (product.classification === "profitable_low_sales") result.push({ productId: product.id, type: "promote_product", reason: "O produto tem margem acima da mediana e saída abaixo da mediana da categoria.", impactEstimate: { action: "reposition_or_campaign_draft" }, confidence: "medium", sourceMetrics: base, automaticAction: false });
  if (product.classification === "popular_low_margin") result.push({ productId: product.id, type: "reduce_cost", reason: "O produto vende acima da mediana, mas entrega margem abaixo da mediana.", impactEstimate: { action: "review_price_cost_or_portion" }, confidence: "medium", sourceMetrics: base, automaticAction: false });
  return result;
}

export function bulkPricePreview(rows: Array<{ id: string; currentPriceCents: number; newPriceCents: number; costCents: number | null }>) { return { items: rows.map(row => ({ ...row, simulation: simulatePriceChange({ currentPriceCents: row.currentPriceCents, newPriceCents: row.newPriceCents, variableCostCents: row.costCents }) })), confirmationRequired: true, reinforcedConfirmationRequired: true, changesApplied: 0 }; }

export class MenuProfitabilityService {
  productCost = calculateProductCost;
  productMargins = calculateMargins;
  channelProfitability = channelAdjustedMargin;
  engineeringMatrix = buildMenuMatrix;
  priceSimulation = simulatePriceChange;
  comboSimulation = simulateCombo;
  recommendations = buildProfitabilityRecommendations;
}

export const PROFITABILITY_COPILOT_TOOLS = ["getProductProfitability", "getMenuEngineeringMatrix", "getMarginCompression", "getPriceReviewCandidates", "getBundleOpportunities", "getAddonPerformance", "getChannelProfitability", "simulatePriceChange"] as const;
