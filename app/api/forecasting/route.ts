/* eslint-disable @typescript-eslint/no-explicit-any,@typescript-eslint/ban-ts-comment */
// @ts-nocheck -- Forecast orchestration joins the certified analytical mart and operational context.
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { backtest, buildRecommendation, chooseGranularity, convertRecipes, detectDrift, inventoryRequirements, movingAverageForecast, productDemandForecast, qualityGate, scenarioForecast, seasonalNaiveForecast, selectChampion, staffingForecast, deliveryLoadForecast } from "@/lib/forecasting/core";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const rows = (result: any) => result?.error ? [] : result?.data || [];
const nowIso = () => new Date().toISOString();

async function authorize(storeId: string) {
  if (!uuid.test(storeId)) throw new Error("Unidade inválida.");
  const client = await createClient();
  const { data: claims } = await client.auth.getClaims();
  const userId = String(claims?.claims?.sub || "");
  if (!userId) throw new Error("Sessão expirada.");
  const { data: store } = await client.from("establishments").select("id,name,organization_id,timezone").eq("id", storeId).maybeSingle();
  if (!store) throw new Error("Unidade não encontrada.");
  const organizationId = store.organization_id || store.id;
  const [{ data: profile }, { data: member }] = await Promise.all([
    client.from("profiles").select("is_superadmin").eq("id", userId).maybeSingle(),
    client.from("organization_members").select("role,status").eq("organization_id", organizationId).eq("user_id", userId).maybeSingle(),
  ]);
  if (!profile?.is_superadmin && !member) throw new Error("Sem acesso à previsão desta organização.");
  return { userId, store, organizationId, role: member?.role || "superadmin" };
}

function aggregateOrders(orderRows: any[]) {
  const daily = new Map<string, { timestamp: string; value: number; revenueCents: number }>();
  const hourly = new Map<string, { timestamp: string; value: number; revenueCents: number }>();
  for (const order of orderRows.filter(row => row.is_approved && !row.deleted_at)) {
    const date = String(order.local_date), hourDate = new Date(order.event_timestamp_utc); hourDate.setUTCMinutes(0, 0, 0);
    const day = daily.get(date) || { timestamp: `${date}T12:00:00Z`, value: 0, revenueCents: 0 };
    day.value += 1; day.revenueCents += Number(order.total_cents || 0); daily.set(date, day);
    const hourKey = hourDate.toISOString(); const hour = hourly.get(hourKey) || { timestamp: hourKey, value: 0, revenueCents: 0 };
    hour.value += 1; hour.revenueCents += Number(order.total_cents || 0); hourly.set(hourKey, hour);
  }
  return { daily: [...daily.values()].sort((a, b) => a.timestamp.localeCompare(b.timestamp)), hourly: [...hourly.values()].sort((a, b) => a.timestamp.localeCompare(b.timestamp)) };
}

async function snapshot(admin: any, context: any) {
  const org = context.organizationId, store = context.store.id;
  const [ordersResult, itemsResult, productsResult, categoriesResult, recipesResult, stockResult, shiftsResult, deliveriesResult, reservationsResult, modelsResult, predictionsResult, recommendationsResult, driftResult, qualityResult, settingsResult] = await Promise.all([
    admin.from("analytics_fact_orders").select("*").eq("organization_id", org).eq("store_id", store).order("event_timestamp_utc").limit(10000),
    admin.from("analytics_fact_order_items").select("*").eq("organization_id", org).eq("store_id", store).limit(20000),
    admin.from("analytics_dim_products").select("product_id,name,category_id").eq("organization_id", org).eq("store_id", store).eq("is_current", true),
    admin.from("categories").select("id,name").eq("establishment_id", store),
    admin.from("inventory_recipes").select("product_id,stock_item_id,quantity_base,quantity").eq("establishment_id", store),
    admin.from("inventory_items").select("id,name,unit,balance,safety_stock,minimum").eq("establishment_id", store).eq("active", true),
    admin.from("work_shifts").select("shift_date,starts_at,ends_at,role_context,status,publication_status").eq("organization_id", org).eq("store_id", store).gte("shift_date", new Date().toISOString().slice(0, 10)),
    admin.from("analytics_fact_delivery").select("*").eq("organization_id", org).eq("store_id", store).order("event_timestamp_utc"),
    admin.from("reservations").select("starts_at,party_size,status").eq("organization_id", org).eq("establishment_id", store).gte("starts_at", nowIso()),
    admin.from("forecast_models").select("*").eq("organization_id", org).or(`store_id.eq.${store},store_id.is.null`).order("created_at", { ascending: false }),
    admin.from("forecast_predictions").select("*").eq("organization_id", org).or(`store_id.eq.${store},store_id.is.null`).gte("forecast_for", new Date(Date.now() - 86400000).toISOString()).order("forecast_for"),
    admin.from("forecast_recommendations").select("*").eq("organization_id", org).or(`store_id.eq.${store},store_id.is.null`).order("created_at", { ascending: false }).limit(30),
    admin.from("forecast_drift_events").select("*").eq("organization_id", org).or(`store_id.eq.${store},store_id.is.null`).order("created_at", { ascending: false }).limit(20),
    admin.from("analytics_quality_results").select("status,invalid_rows,checked_at,analytics_quality_rules(severity)").order("checked_at", { ascending: false }).limit(100),
    admin.from("forecast_settings").select("*").eq("organization_id", org).eq("store_id", store).maybeSingle(),
  ]);
  const orderRows = rows(ordersResult), aggregates = aggregateOrders(orderRows), activeDays = new Set(orderRows.map(row => row.local_date)).size;
  const lastLoaded = orderRows.map(row => new Date(row.loaded_at).getTime()).filter(Number.isFinite).sort((a, b) => b - a)[0];
  const criticalFailures = rows(qualityResult).filter((item: any) => item.status === "failed" && item.analytics_quality_rules?.severity === "critical").length;
  const gate = qualityGate({ activeDays, observations: orderRows.length, freshnessHours: lastLoaded ? (Date.now() - lastLoaded) / 3600000 : 9999, criticalFailures });
  const target = new Date(); target.setUTCDate(target.getUTCDate() + 1); target.setUTCHours(12, 0, 0, 0);
  const orderForecast = seasonalNaiveForecast(aggregates.daily, target);
  const revenueForecast = seasonalNaiveForecast(aggregates.daily.map(point => ({ ...point, value: point.revenueCents })), target);
  const movingBacktest = backtest(aggregates.daily, "moving_average"), seasonalBacktest = backtest(aggregates.daily, "seasonal_naive"), smoothingBacktest = backtest(aggregates.daily, "exponential_smoothing");
  const champion = selectChampion([movingBacktest, seasonalBacktest, smoothingBacktest]);
  const orderMap = new Map(orderRows.map(row => [row.order_id, row]));
  const itemHistory = rows(itemsResult).map((item: any) => ({ productId: item.product_id, quantity: Number(item.quantity || 0), timestamp: orderMap.get(item.order_id)?.event_timestamp_utc || new Date(Number(item.date_key?.toString().slice(0, 4)), Number(item.date_key?.toString().slice(4, 6)) - 1, Number(item.date_key?.toString().slice(6, 8))).toISOString() })).filter((item: any) => item.productId);
  const productForecasts = productDemandForecast(itemHistory, target);
  const productNames = new Map(rows(productsResult).map((row: any) => [row.product_id, row]));
  const categoryNames = new Map(rows(categoriesResult).map((row: any) => [row.id, row.name]));
  const products = productForecasts.map(item => ({ ...item, name: productNames.get(item.productId)?.name || "Produto", category: categoryNames.get(productNames.get(item.productId)?.category_id) || "Sem categoria" }));
  const categoryMap = new Map<string, { predictedValue: number; lowerBound: number; upperBound: number }>();
  for (const item of products) { const current = categoryMap.get(item.category) || { predictedValue: 0, lowerBound: 0, upperBound: 0 }; current.predictedValue += item.predictedValue; current.lowerBound += item.lowerBound; current.upperBound += item.upperBound; categoryMap.set(item.category, current); }
  const requirements = convertRecipes(products, rows(recipesResult).map((row: any) => ({ productId: row.product_id, inventoryItemId: row.stock_item_id, quantity: Number(row.quantity_base || row.quantity || 0) })));
  const inventory = inventoryRequirements(requirements, rows(stockResult).map((row: any) => ({ id: row.id, balance: Number(row.balance || 0), safetyStock: Number(row.safety_stock || row.minimum || 0) }))).map(item => ({ ...item, name: rows(stockResult).find((row: any) => row.id === item.inventoryItemId)?.name || "Insumo", unit: rows(stockResult).find((row: any) => row.id === item.inventoryItemId)?.unit || "un" }));
  const tomorrow = target.toISOString().slice(0, 10), scheduledWorkers = new Set(rows(shiftsResult).filter((row: any) => row.shift_date === tomorrow && row.status !== "cancelled").map((row: any) => row.starts_at + row.role_context)).size;
  const staffing = staffingForecast(orderForecast.predictedValue, activeDays ? Math.max(1, orderRows.length / activeDays / 4) : 10, scheduledWorkers);
  const deliveryShare = orderRows.length ? orderRows.filter(row => row.fulfillment_type === "delivery").length / orderRows.length : 0;
  const delivery = deliveryLoadForecast(orderForecast.predictedValue * deliveryShare, 0, rows(deliveriesResult).length ? 3 : 3);
  const reservations = rows(reservationsResult).filter((row: any) => row.starts_at.slice(0, 10) === tomorrow && !["cancelled", "no_show"].includes(row.status));
  const recent = aggregates.daily.slice(-3).map(point => point.value), reference = aggregates.daily.slice(-10, -3).map(point => point.value);
  const drift = detectDrift(reference, recent);
  const nowcastActual = orderRows.filter(row => row.local_date === new Date().toISOString().slice(0, 10) && row.is_approved).length;
  const nowcastExpected = orderForecast.predictedValue * ((new Date().getHours() + 1) / 24);
  const recommendations = [
    ...(inventory.filter(item => item.riskLevel !== "low").map(item => buildRecommendation("stock", `Considere revisar ${item.name}: déficit estimado de ${item.deficit.toFixed(2)} ${item.unit}.`, { inventoryItemId: item.inventoryItemId, deficit: item.deficit }))),
    ...(staffing.riskLevel !== "low" ? [buildRecommendation("staffing", staffing.recommendation, { coveragePercent: staffing.coveragePercent })] : []),
    ...(delivery.riskLevel !== "low" ? [buildRecommendation("delivery", `Considere ${delivery.recommendedDrivers} motoboy(s) disponível(is) para a faixa prevista.`, { coveragePercent: delivery.coveragePercent })] : []),
  ];
  return {
    generatedAt: nowIso(), source: "Phase 34 certified warehouse", scope: { organizationId: org, storeId: store, storeName: context.store.name },
    diagnosis: { orders: orderRows.length, orderItems: rows(itemsResult).length, activeDays, inventoryMovements: 0, deliveryFacts: rows(deliveriesResult).length, futureShifts: rows(shiftsResult).length, futureReservations: rows(reservationsResult).length, criticalQualityFailures: criticalFailures, granularity: chooseGranularity(orderRows.length, activeDays), quality: gate },
    orderForecast, revenueForecast, ticketForecast: { predictedValue: orderForecast.predictedValue ? revenueForecast.predictedValue / orderForecast.predictedValue : 0, lowerBound: orderForecast.upperBound ? revenueForecast.lowerBound / orderForecast.upperBound : 0, upperBound: orderForecast.lowerBound ? revenueForecast.upperBound / Math.max(1, orderForecast.lowerBound) : 0, confidenceLevel: gate.confidence },
    products: products.slice(0, 12), categories: [...categoryMap.entries()].map(([name, values]) => ({ name, ...values })).sort((a, b) => b.predictedValue - a.predictedValue), inventory, staffing, delivery,
    reservations: { expectedGuests: reservations.reduce((sum: number, row: any) => sum + Number(row.party_size || 0), 0), reservations: reservations.length, strongSignal: reservations.length > 0 },
    accuracy: { current: champion, candidates: [movingBacktest, seasonalBacktest, smoothingBacktest], drift, health: gate.status === "insufficient_data" ? "insufficient_data" : drift.status },
    nowcast: { actual: nowcastActual, expected: nowcastExpected, differencePercent: nowcastExpected ? (nowcastActual - nowcastExpected) / nowcastExpected * 100 : null },
    history: aggregates.daily.slice(-14), hourly: aggregates.hourly.slice(-48), models: rows(modelsResult), predictions: rows(predictionsResult), persistedRecommendations: rows(recommendationsResult), driftEvents: rows(driftResult), recommendations, settings: settingsResult.data || null,
    safeguards: { automaticStockChange: false, automaticPurchase: false, automaticStaffing: false, automaticDispatch: false, customerFacingEnabled: gate.status === "ready" && gate.confidence === "high" },
  };
}

async function train(admin: any, context: any, payload: any) {
  const snap = await snapshot(admin, context), org = context.organizationId, store = context.store.id;
  const { data: run, error: runError } = await admin.from("forecast_training_runs").insert({ organization_id: org, store_id: store, status: "training", data_quality_status: snap.diagnosis.quality.status === "blocked" ? "blocked" : snap.diagnosis.quality.status === "ready" ? "passed" : "low_data", rows_read: snap.diagnosis.orders, started_at: nowIso(), requested_by: context.userId }).select().single();
  if (runError) throw runError;
  if (!snap.diagnosis.quality.allowed) { await admin.from("forecast_training_runs").update({ status: "blocked", failure_reason: snap.diagnosis.quality.reasons.join(", "), finished_at: nowIso() }).eq("id", run.id); throw new Error("Treino bloqueado pela qualidade dos dados."); }
  const champion = snap.accuracy.current || snap.accuracy.candidates[0], dates = snap.history.map((row: any) => row.timestamp).sort(), versionResult = await admin.from("forecast_models").select("version").eq("organization_id", org).eq("store_id", store).eq("forecast_type", "orders").order("version", { ascending: false }).limit(1), version = Number(versionResult.data?.[0]?.version || 0) + 1;
  await admin.from("forecast_models").update({ status: "challenger", updated_at: nowIso() }).eq("organization_id", org).eq("store_id", store).eq("forecast_type", "orders").eq("status", "champion");
  const { data: model, error: modelError } = await admin.from("forecast_models").insert({ organization_id: org, store_id: store, forecast_type: "orders", model_type: champion.modelType, version, training_start: dates[0] || null, training_end: dates.at(-1) || null, status: "champion", health: snap.diagnosis.quality.status === "insufficient_data" ? "insufficient_data" : snap.accuracy.drift.status, metrics: champion.metrics, training_scope: { source: "analytics_fact_orders", active_days: snap.diagnosis.activeDays, observations: snap.diagnosis.orders, no_data_leakage: champion.noDataLeakage }, published_at: nowIso() }).select().single();
  if (modelError) throw modelError;
  await admin.from("forecast_backtests").insert({ organization_id: org, store_id: store, model_id: model.id, training_run_id: run.id, validation_start: dates[Math.max(0, dates.length - champion.validationSize)] || dates[0] || nowIso(), validation_end: dates.at(-1) || nowIso(), mae: champion.metrics.mae, rmse: champion.metrics.rmse, wape: champion.metrics.wape, bias: champion.metrics.bias, underforecast_rate: champion.metrics.underforecastRate, overforecast_rate: champion.metrics.overforecastRate, observations: champion.metrics.observations, passed: champion.noDataLeakage && champion.validationSize > 0 });
  const predictions = [];
  for (let day = 1; day <= 7; day++) { const date = new Date(); date.setUTCDate(date.getUTCDate() + day); date.setUTCHours(12, 0, 0, 0); const forecast = champion.modelType === "moving_average" ? movingAverageForecast(snap.history.map((row: any) => row.value), 4, day) : seasonalNaiveForecast(snap.history, date, day); predictions.push({ organization_id: org, store_id: store, forecast_type: "orders", entity_type: "store", forecast_for: date.toISOString(), horizon: day === 1 ? "tomorrow" : "7_days", granularity: snap.diagnosis.granularity === "day" ? "day" : "hour", predicted_value: forecast.predictedValue, lower_bound: forecast.lowerBound, upper_bound: forecast.upperBound, confidence_level: forecast.confidenceLevel, quality_score: Math.max(0, 1 - Number(champion.metrics.wape || 100) / 100), model_id: model.id, context: { factors: forecast.factors, reservations: snap.reservations.reservations }, system_forecast: forecast.predictedValue }); }
  await admin.from("forecast_predictions").insert(predictions);
  await admin.from("forecast_training_runs").update({ model_id: model.id, status: "succeeded", validation_start: dates[Math.max(0, dates.length - champion.validationSize)] || null, validation_end: dates.at(-1) || null, train_start: dates[0] || null, train_end: dates[Math.max(0, dates.length - champion.validationSize - 1)] || null, duration_ms: 1, finished_at: nowIso() }).eq("id", run.id);
  await admin.from("forecast_audit_events").insert([{ organization_id: org, store_id: store, actor_user_id: context.userId, event_type: "model_trained", entity_type: "forecast_model", entity_id: model.id, metadata: { baseline_candidates: snap.accuracy.candidates.map((item: any) => item.modelType), selected: champion.modelType } }, { organization_id: org, store_id: store, actor_user_id: context.userId, event_type: "model_published", entity_type: "forecast_model", entity_id: model.id, metadata: { backtested: true, confidence: snap.orderForecast.confidenceLevel } }]);
  return { runId: run.id, model, predictions: predictions.length, quality: snap.diagnosis.quality };
}

export async function GET(request: Request) {
  try { const storeId = new URL(request.url).searchParams.get("store_id") || "", context = await authorize(storeId); return NextResponse.json(await snapshot(createAdminClient(), context)); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Falha ao gerar previsão." }, { status: 403 }); }
}

export async function POST(request: Request) {
  try {
    const body = await request.json(), context = await authorize(String(body.store_id || "")), admin = createAdminClient(), action = String(body.action || "");
    if (action === "scenario") { const result = scenarioForecast(Number(body.base || 0), Number(body.change_percent || 0)); await admin.from("forecast_audit_events").insert({ organization_id: context.organizationId, store_id: context.store.id, actor_user_id: context.userId, event_type: "scenario_run", entity_type: "forecast_scenario", metadata: { change_percent: body.change_percent } }); return NextResponse.json({ ok: true, scenario: result }); }
    if (body.confirmed !== true) return NextResponse.json({ error: "Confirmação humana obrigatória." }, { status: 409 });
    if (action === "train") return NextResponse.json({ ok: true, ...(await train(admin, context, body)) });
    if (action === "manual_event") { const allowed = new Set(["local_holiday", "sports", "show", "promotion", "closure", "outage", "other"]); if (!allowed.has(body.event_type)) throw new Error("Tipo de evento inválido."); const { data, error } = await admin.from("forecast_manual_events").insert({ organization_id: context.organizationId, store_id: context.store.id, event_type: body.event_type, starts_at: body.starts_at, ends_at: body.ends_at, expected_impact_percent: Number(body.expected_impact_percent || 0), label: String(body.label || "").slice(0, 120), structured_context: { validated: true }, created_by: context.userId }).select().single(); if (error) throw error; return NextResponse.json({ ok: true, event: data }); }
    if (action === "adjustment") { const reason = String(body.reason || "").trim(); if (reason.length < 3) throw new Error("Informe o motivo do ajuste."); const { data: prediction } = await admin.from("forecast_predictions").select("*").eq("id", body.prediction_id).eq("organization_id", context.organizationId).eq("store_id", context.store.id).single(); if (!prediction) throw new Error("Previsão não encontrada."); const adjustment = body.mode === "percent" ? Number(prediction.system_forecast) * Number(body.value) / 100 : Number(body.value); await admin.from("forecast_adjustments").insert({ prediction_id: prediction.id, organization_id: context.organizationId, store_id: context.store.id, adjustment_value: Number(body.value), adjustment_mode: body.mode === "percent" ? "percent" : "absolute", reason, created_by: context.userId }); await admin.from("forecast_predictions").update({ manual_adjustment: adjustment }).eq("id", prediction.id); await admin.from("forecast_audit_events").insert({ organization_id: context.organizationId, store_id: context.store.id, actor_user_id: context.userId, event_type: "override", entity_type: "forecast_prediction", entity_id: prediction.id, metadata: { mode: body.mode, value: body.value, reason } }); return NextResponse.json({ ok: true }); }
    if (action === "recommendation") { const status = body.status === "accepted" ? "accepted" : "dismissed"; const { data, error } = await admin.from("forecast_recommendations").update({ status, decided_by: context.userId, decided_at: nowIso() }).eq("id", body.recommendation_id).eq("organization_id", context.organizationId).select().single(); if (error) throw error; await admin.from("forecast_audit_events").insert({ organization_id: context.organizationId, store_id: context.store.id, actor_user_id: context.userId, event_type: status === "accepted" ? "recommendation_accepted" : "recommendation_dismissed", entity_type: "forecast_recommendation", entity_id: data.id }); return NextResponse.json({ ok: true, recommendation: data }); }
    throw new Error("Ação inválida.");
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Falha na operação preditiva." }, { status: 400 }); }
}
