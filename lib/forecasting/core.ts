export type ForecastPoint = {
  timestamp: string;
  value: number;
  revenueCents?: number;
  entityId?: string | null;
};

export type ForecastResult = {
  predictedValue: number;
  lowerBound: number;
  upperBound: number;
  confidenceLevel: "high" | "medium" | "low";
  modelType: "moving_average" | "seasonal_naive" | "exponential_smoothing";
  sampleSize: number;
  factors: string[];
};

export type BacktestMetrics = {
  mae: number;
  rmse: number;
  wape: number;
  bias: number;
  underforecastRate: number;
  overforecastRate: number;
  observations: number;
};

const mean = (values: number[]) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
const finite = (value: unknown) => Number.isFinite(Number(value)) ? Number(value) : 0;
const clamp = (value: number, min = 0, max = Number.POSITIVE_INFINITY) => Math.min(max, Math.max(min, value));

export function splitTrainValidation<T extends { timestamp: string }>(rows: T[], validationRatio = 0.2) {
  const sorted = [...rows].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
  if (sorted.length < 2) return { train: sorted, validation: [] as T[] };
  const validationSize = Math.max(1, Math.floor(sorted.length * clamp(validationRatio, 0.1, 0.4)));
  return { train: sorted.slice(0, -validationSize), validation: sorted.slice(-validationSize) };
}

export function chooseGranularity(orderCount: number, activeDays: number) {
  const perDay = activeDays > 0 ? orderCount / activeDays : 0;
  if (perDay >= 240) return "15_min";
  if (perDay >= 80) return "30_min";
  if (perDay >= 20) return "hour";
  return "day";
}

export function qualityGate(input: { activeDays: number; observations: number; freshnessHours?: number; criticalFailures?: number }) {
  const reasons: string[] = [];
  if (input.activeDays < 28) reasons.push("menos de 28 dias ativos");
  if (input.observations < 60) reasons.push("menos de 60 observações");
  if ((input.freshnessHours ?? 0) > 48) reasons.push("dados desatualizados");
  if ((input.criticalFailures ?? 0) > 0) reasons.push("falha crítica de qualidade");
  const status = input.criticalFailures ? "blocked" : input.activeDays < 14 || input.observations < 20 ? "insufficient_data" : reasons.length ? "low_data" : "ready";
  return { allowed: status !== "blocked", status, confidence: status === "ready" ? "high" : status === "low_data" ? "medium" : "low", reasons } as const;
}

function residualDeviation(actual: number[], predicted: number[]) {
  if (!actual.length) return 0;
  const residuals = actual.map((value, index) => value - finite(predicted[index]));
  const center = mean(residuals);
  return Math.sqrt(mean(residuals.map(value => (value - center) ** 2)));
}

export function confidenceInterval(predictedValue: number, actual: number[], fitted: number[], confidence = 0.8, horizon = 1) {
  const z = confidence >= 0.95 ? 1.96 : confidence >= 0.9 ? 1.645 : 1.282;
  const deviation = residualDeviation(actual, fitted) || Math.sqrt(Math.max(predictedValue, 1));
  const margin = z * deviation * Math.sqrt(Math.max(1, horizon));
  return { lowerBound: Math.max(0, predictedValue - margin), upperBound: Math.max(0, predictedValue + margin), confidenceLevel: confidence };
}

export function movingAverageForecast(values: number[], window = 4, horizon = 1): ForecastResult {
  const clean = values.map(finite).filter(value => value >= 0);
  const selected = clean.slice(-Math.max(1, window));
  const predictedValue = mean(selected);
  const fitted = clean.map((_, index) => mean(clean.slice(Math.max(0, index - window), index || 1)));
  const interval = confidenceInterval(predictedValue, clean, fitted, clean.length >= 28 ? 0.9 : 0.8, horizon);
  return { predictedValue, lowerBound: interval.lowerBound, upperBound: interval.upperBound, confidenceLevel: clean.length >= 28 ? "high" : clean.length >= 8 ? "medium" : "low", modelType: "moving_average", sampleSize: clean.length, factors: [`média das últimas ${selected.length} observações`, "tendência recente"] };
}

export function seasonalNaiveForecast(rows: ForecastPoint[], target: Date, horizon = 1): ForecastResult {
  const targetWeekday = target.getUTCDay();
  const targetHour = target.getUTCHours();
  const sameSlot = rows.filter(row => { const date = new Date(row.timestamp); return date.getUTCDay() === targetWeekday && date.getUTCHours() === targetHour; });
  const sample = sameSlot.length ? sameSlot : rows;
  const values = sample.map(row => finite(row.value));
  const predictedValue = mean(values.slice(-8));
  const fitted = values.map((_, index) => index ? values[index - 1] : values[0]);
  const interval = confidenceInterval(predictedValue, values, fitted, values.length >= 8 ? 0.9 : 0.8, horizon);
  return { predictedValue, lowerBound: interval.lowerBound, upperBound: interval.upperBound, confidenceLevel: sameSlot.length >= 8 ? "high" : sameSlot.length >= 3 ? "medium" : "low", modelType: "seasonal_naive", sampleSize: sameSlot.length, factors: sameSlot.length ? ["mesmo dia da semana", "mesma faixa horária", "histórico recente"] : ["histórico disponível", "modo de baixa amostra"] };
}

export function exponentialSmoothingForecast(values: number[], alpha = 0.35, horizon = 1): ForecastResult {
  const clean = values.map(finite).filter(value => value >= 0);
  let level = clean[0] ?? 0;
  const fitted: number[] = [];
  for (const value of clean) { fitted.push(level); level = alpha * value + (1 - alpha) * level; }
  const interval = confidenceInterval(level, clean, fitted, clean.length >= 35 ? 0.9 : 0.8, horizon);
  return { predictedValue: level, lowerBound: interval.lowerBound, upperBound: interval.upperBound, confidenceLevel: clean.length >= 35 ? "high" : clean.length >= 12 ? "medium" : "low", modelType: "exponential_smoothing", sampleSize: clean.length, factors: ["nível suavizado", "maior peso para dados recentes"] };
}

export function calculateAccuracy(actual: number[], predicted: number[]): BacktestMetrics {
  const pairs = actual.map((value, index) => [finite(value), finite(predicted[index])] as const).filter(([a, p]) => Number.isFinite(a) && Number.isFinite(p));
  if (!pairs.length) return { mae: 0, rmse: 0, wape: 0, bias: 0, underforecastRate: 0, overforecastRate: 0, observations: 0 };
  const errors = pairs.map(([a, p]) => p - a);
  const absolute = errors.map(Math.abs);
  const actualTotal = pairs.reduce((sum, [a]) => sum + Math.abs(a), 0);
  return {
    mae: mean(absolute), rmse: Math.sqrt(mean(errors.map(error => error ** 2))),
    wape: actualTotal ? absolute.reduce((sum, value) => sum + value, 0) / actualTotal * 100 : 0,
    bias: mean(errors), underforecastRate: errors.filter(error => error < 0).length / pairs.length * 100,
    overforecastRate: errors.filter(error => error > 0).length / pairs.length * 100, observations: pairs.length,
  };
}

export function backtest(rows: ForecastPoint[], modelType: "moving_average" | "seasonal_naive" | "exponential_smoothing") {
  const { train, validation } = splitTrainValidation(rows);
  const predicted: number[] = [];
  const evolving = [...train];
  for (const point of validation) {
    const result = modelType === "seasonal_naive" ? seasonalNaiveForecast(evolving, new Date(point.timestamp)) : modelType === "exponential_smoothing" ? exponentialSmoothingForecast(evolving.map(item => item.value)) : movingAverageForecast(evolving.map(item => item.value));
    predicted.push(result.predictedValue);
    evolving.push(point);
  }
  return { modelType, metrics: calculateAccuracy(validation.map(point => point.value), predicted), trainSize: train.length, validationSize: validation.length, noDataLeakage: train.every(row => !validation.length || new Date(row.timestamp) < new Date(validation[0].timestamp)) };
}

export function selectChampion(results: ReturnType<typeof backtest>[]) {
  const eligible = results.filter(result => result.validationSize > 0 && result.noDataLeakage);
  return [...eligible].sort((a, b) => (a.metrics.wape || a.metrics.mae) - (b.metrics.wape || b.metrics.mae))[0] ?? null;
}

export function applyManualAdjustment(systemForecast: number, adjustment: { mode: "absolute" | "percent"; value: number; reason: string; userId: string }) {
  if (!adjustment.reason.trim() || !adjustment.userId) throw new Error("Override exige motivo e usuário.");
  const delta = adjustment.mode === "percent" ? systemForecast * adjustment.value / 100 : adjustment.value;
  return { systemForecast, manualAdjustment: delta, finalOperationalForecast: Math.max(0, systemForecast + delta), trainingValue: systemForecast };
}

export function scenarioForecast(base: number, changePercent: number) {
  return { base, low: Math.max(0, base * 0.85), high: base * 1.15, scenario: Math.max(0, base * (1 + changePercent / 100)), label: "cenário, não previsão" };
}

export function productDemandForecast(items: Array<{ productId: string; quantity: number; timestamp: string }>, target: Date) {
  const grouped = new Map<string, ForecastPoint[]>();
  for (const item of items) grouped.set(item.productId, [...(grouped.get(item.productId) ?? []), { timestamp: item.timestamp, value: item.quantity, entityId: item.productId }]);
  return [...grouped.entries()].map(([productId, rows]) => ({ productId, ...seasonalNaiveForecast(rows, target) })).sort((a, b) => b.predictedValue - a.predictedValue);
}

export function convertRecipes(productForecasts: Array<{ productId: string; predictedValue: number }>, recipes: Array<{ productId: string; inventoryItemId: string; quantity: number }>) {
  const result = new Map<string, number>();
  for (const forecast of productForecasts) for (const recipe of recipes.filter(row => row.productId === forecast.productId)) result.set(recipe.inventoryItemId, (result.get(recipe.inventoryItemId) ?? 0) + forecast.predictedValue * finite(recipe.quantity));
  return [...result.entries()].map(([inventoryItemId, requiredQuantity]) => ({ inventoryItemId, requiredQuantity }));
}

export function inventoryRequirements(requirements: Array<{ inventoryItemId: string; requiredQuantity: number }>, stock: Array<{ id: string; balance: number; inbound?: number; safetyStock?: number }>) {
  return requirements.map(requirement => { const item = stock.find(row => row.id === requirement.inventoryItemId); const currentStock = finite(item?.balance), inboundQuantity = finite(item?.inbound), safetyStock = finite(item?.safetyStock), expectedRemaining = currentStock + inboundQuantity - requirement.requiredQuantity, deficit = Math.max(0, safetyStock - expectedRemaining); return { ...requirement, currentStock, inboundQuantity, expectedRemaining, deficit, riskLevel: deficit > requirement.requiredQuantity * 0.3 ? "high" : deficit > 0 ? "medium" : "low", purchaseSuggestion: deficit > 0 ? deficit : 0, automaticPurchase: false }; });
}

export function staffingForecast(predictedOrders: number, historicalOrdersPerWorkerHour: number, scheduledWorkers: number) {
  const throughput = Math.max(1, historicalOrdersPerWorkerHour || 10), recommendedCapacity = Math.ceil(predictedOrders / throughput), coverage = recommendedCapacity ? scheduledWorkers / recommendedCapacity * 100 : 100;
  return { predictedOrders, recommendedCapacity, scheduledWorkers, coveragePercent: coverage, riskLevel: coverage < 75 ? "high" : coverage < 100 ? "medium" : "low", recommendation: coverage < 100 ? "Considere reforço de equipe." : "Escala compatível com a faixa prevista.", automaticScheduling: false };
}

export function deliveryLoadForecast(predictedDeliveries: number, availableDrivers: number, historicalDeliveriesPerDriverHour = 3) {
  const recommendedDrivers = Math.ceil(predictedDeliveries / Math.max(1, historicalDeliveriesPerDriverHour)), coverage = recommendedDrivers ? availableDrivers / recommendedDrivers * 100 : 100;
  return { predictedDeliveries, availableDrivers, recommendedDrivers, coveragePercent: coverage, riskLevel: coverage < 70 ? "high" : coverage < 100 ? "medium" : "low", estimatedTimeRangeMinutes: predictedDeliveries ? [30, Math.round(45 + Math.max(0, predictedDeliveries - availableDrivers * historicalDeliveriesPerDriverHour) * 2)] : [0, 0], automaticDispatch: false };
}

export function detectDrift(reference: number[], recent: number[], threshold = 0.25) {
  const referenceMean = mean(reference.map(finite)), recentMean = mean(recent.map(finite)), ratio = referenceMean ? Math.abs(recentMean - referenceMean) / Math.abs(referenceMean) : recentMean ? 1 : 0;
  return { drifted: ratio >= threshold, driftPercent: ratio * 100, status: ratio >= threshold ? "degraded" : "healthy", fallbackRecommended: ratio >= threshold };
}

export function buildRecommendation(kind: string, message: string, impact: Record<string, unknown> = {}) {
  return { kind, message, impact, status: "suggested", requiresHumanConfirmation: true, executedAutomatically: false };
}

export class ForecastService {
  getOrderForecast(rows: ForecastPoint[], target = new Date()) { return seasonalNaiveForecast(rows, target); }
  getRevenueForecast(rows: ForecastPoint[], target = new Date()) { return seasonalNaiveForecast(rows.map(row => ({ ...row, value: finite(row.revenueCents) })), target); }
  getProductDemandForecast(items: Array<{ productId: string; quantity: number; timestamp: string }>, target = new Date()) { return productDemandForecast(items, target); }
  getInventoryRequirementForecast(products: Array<{ productId: string; predictedValue: number }>, recipes: Array<{ productId: string; inventoryItemId: string; quantity: number }>, stock: Array<{ id: string; balance: number; inbound?: number; safetyStock?: number }>) { return inventoryRequirements(convertRecipes(products, recipes), stock); }
  getStaffingForecast(predictedOrders: number, throughput: number, scheduled: number) { return staffingForecast(predictedOrders, throughput, scheduled); }
  getDeliveryForecast(predictedDeliveries: number, drivers: number, throughput?: number) { return deliveryLoadForecast(predictedDeliveries, drivers, throughput); }
  getForecastAccuracy(actual: number[], predicted: number[]) { return calculateAccuracy(actual, predicted); }
}

export const FORECAST_COPILOT_TOOLS = ["getDemandForecast", "getPeakHoursForecast", "getProductDemandForecast", "getInventoryRiskForecast", "getStaffingForecast", "getDeliveryLoadForecast", "getForecastAccuracy"] as const;

export function forecastCopilot(tool: string, context: Record<string, any>) {
  if (!FORECAST_COPILOT_TOOLS.includes(tool as any)) throw new Error("Ferramenta preditiva não aprovada.");
  return { tool, forecast: context.forecast ?? null, range: context.range ?? null, confidence: context.confidence ?? "low", factors: context.factors ?? ["histórico da própria organização"], recommendation: context.recommendation ?? "Revise a previsão antes de decidir.", requiresHumanDecision: true, certaintyClaim: false };
}
