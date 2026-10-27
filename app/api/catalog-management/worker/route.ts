/* eslint-disable @typescript-eslint/no-explicit-any */
import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

const workerId = `catalog-worker-${process.pid}`;
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const productFields = new Set(["name", "short_name", "description", "image_url", "category_id", "active", "featured", "sort_order", "sku", "internal_code", "barcode", "product_type", "lifecycle_status", "tax_reference"]);

async function approved(admin: any, id: string | null) {
  if (!id) return false;
  const { data } = await admin.from("internal_approvals").select("id,status,resolved_at").eq("id", id).eq("status", "approved").maybeSingle();
  return Boolean(data?.resolved_at);
}

async function recordOutbox(admin: any, organizationId: string, storeId: string | null, eventType: string, aggregateType: string, aggregateId: string | null, payload: unknown, key: string) {
  await admin.from("catalog_outbox").upsert({ organization_id: organizationId, store_id: storeId, event_type: eventType, aggregate_type: aggregateType, aggregate_id: aggregateId, payload, idempotency_key: key }, { onConflict: "organization_id,idempotency_key", ignoreDuplicates: true });
}

async function applyItem(admin: any, job: any, item: any, storeId: string) {
  if (item.entity_type === "product" && item.entity_id) {
    const { data: current } = await admin.from("products").select("*").eq("id", item.entity_id).eq("organization_id", job.organization_id).maybeSingle();
    if (!current) throw new Error(`Produto ${item.entity_id} não encontrado.`);
    const patch = Object.fromEntries(Object.entries(item.after_state || {}).filter(([field]) => productFields.has(field)));
    const nextVersion = Number(current.catalog_version || 1) + 1;
    await admin.from("catalog_product_versions").upsert({ organization_id: job.organization_id, product_id: current.id, version: Number(current.catalog_version || 1), snapshot: current, field_diff: Object.keys(patch).map((field) => ({ field, before: current[field], after: patch[field] })), changeset_id: job.changeset_id, created_by: job.payload?.requested_by || null }, { onConflict: "product_id,version", ignoreDuplicates: true });
    const { error } = await admin.from("products").update({ ...patch, catalog_version: nextVersion, updated_at: new Date().toISOString() }).eq("id", current.id).eq("organization_id", job.organization_id);
    if (error) throw error;
    await recordOutbox(admin, job.organization_id, storeId, current.created_at === current.updated_at ? "catalog.product.created" : "catalog.product.updated", "product", current.id, { product_id: current.id, store_id: storeId, changed_fields: Object.keys(patch), catalog_version: nextVersion }, `catalog-product:${job.id}:${item.id}:${storeId}`);
    return;
  }
  if (item.entity_type === "price" && item.entity_id) {
    if (!await approved(admin, item.action_approval_id)) throw new Error(`Preço ${item.id} sem aprovação válida do ActionEngine.`);
    const { data: product } = await admin.from("products").select("id,establishment_id,price_cents,catalog_version").eq("id", item.entity_id).eq("organization_id", job.organization_id).maybeSingle();
    if (!product) throw new Error("Produto da alteração de preço não encontrado.");
    const newPrice = Number(item.after_state?.price_cents);
    if (!Number.isInteger(newPrice) || newPrice < 0) throw new Error("Novo preço inválido.");
    if (product.establishment_id === storeId) await admin.from("products").update({ price_cents: newPrice, catalog_version: Number(product.catalog_version || 1) + 1, updated_at: new Date().toISOString() }).eq("id", product.id);
    else await admin.from("catalog_product_assignments").update({ local_price_override_cents: newPrice, updated_at: new Date().toISOString() }).eq("product_id", product.id).eq("store_id", storeId);
    await admin.from("product_price_history").insert({ organization_id: job.organization_id, store_id: storeId, product_id: product.id, old_price_cents: Number(product.price_cents), new_price_cents: newPrice, changed_by: job.payload?.requested_by || null, reason: String(item.after_state?.reason || "Alteração publicada pelo catálogo central"), source: "bulk_manager", preview_id: item.action_approval_id, effective_at: new Date().toISOString() });
    await recordOutbox(admin, job.organization_id, storeId, "catalog.price.changed", "product", product.id, { product_id: product.id, old_price_cents: product.price_cents, new_price_cents: newPrice }, `catalog-price:${job.id}:${item.id}:${storeId}`);
    return;
  }
  if (item.entity_type === "availability" && item.entity_id) {
    const channel = String(item.after_state?.channel || "web");
    await admin.from("product_channel_availability").upsert({ organization_id: job.organization_id, product_id: item.entity_id, store_id: storeId, channel, fulfillment_method: item.after_state?.fulfillment_method || "all", enabled: item.after_state?.enabled !== false, availability_profile_id: item.after_state?.availability_profile_id || null, temporary_block_until: item.after_state?.temporary_block_until || null, temporary_block_reason: item.after_state?.temporary_block_reason || null, updated_at: new Date().toISOString() }, { onConflict: "product_id,store_id,channel,fulfillment_method" });
    await recordOutbox(admin, job.organization_id, storeId, "catalog.availability.changed", "product", item.entity_id, { product_id: item.entity_id, channel, available: item.after_state?.enabled !== false }, `catalog-availability:${job.id}:${item.id}:${storeId}`);
  }
}

async function materialize(admin: any, organizationId: string, storeId: string, channel: string) {
  const [{ data: store }, { data: settings }, { data: assignments }, { data: categories }, { data: channelRows }] = await Promise.all([
    admin.from("establishments").select("id,name,slug,accent_color,logo_url,cover_url,active").eq("id", storeId).eq("organization_id", organizationId).single(),
    admin.from("establishment_settings").select("delivery_enabled,pickup_enabled,dine_in_enabled,timezone,currency,locale").eq("establishment_id", storeId).maybeSingle(),
    admin.from("catalog_product_assignments").select("product_id,enabled,local_name_override,local_description_override,local_price_override_cents,local_status,overrides,products(id,category_id,name,description,image_url,price_cents,compare_at_price_cents,active,featured,sort_order,ingredients,addon_options,barcode,lifecycle_status)").eq("organization_id", organizationId).eq("store_id", storeId).eq("enabled", true).eq("local_status", "active").limit(10000),
    admin.from("categories").select("id,parent_id,name,description,image_url,active,sort_order").eq("organization_id", organizationId).eq("active", true).order("sort_order").limit(2000),
    admin.from("product_channel_availability").select("product_id,enabled,temporary_block_until").eq("organization_id", organizationId).eq("store_id", storeId).eq("channel", channel).limit(10000),
  ]);
  const channelMap = new Map((channelRows || []).map((row: any) => [row.product_id, row]));
  const visible = (assignments || []).flatMap((assignment: any) => {
    const product = Array.isArray(assignment.products) ? assignment.products[0] : assignment.products;
    const channelConfig: any = channelMap.get(assignment.product_id);
    const blocked = channelConfig?.enabled === false || (channelConfig?.temporary_block_until && new Date(channelConfig.temporary_block_until) > new Date());
    if (!product || !product.active || product.lifecycle_status !== "active" || blocked) return [];
    return [{ ...product, name: assignment.local_name_override || product.name, description: assignment.local_description_override || product.description, price_cents: assignment.local_price_override_cents ?? product.price_cents, ...(assignment.overrides || {}) }];
  });
  const payload = { establishment: store, settings: settings || {}, categories: (categories || []).flatMap((category: any) => { const products = visible.filter((product: any) => product.category_id === category.id).sort((a: any, b: any) => Number(a.sort_order || 0) - Number(b.sort_order || 0)); return products.length ? [{ ...category, products }] : []; }), catalog_meta: { source: "published_catalog_read_model", channel, generated_at: new Date().toISOString() } };
  const versionHash = hash(payload);
  const { data, error } = await admin.rpc("publish_catalog_read_model", { requested_org: organizationId, requested_store: storeId, requested_channel: channel, requested_menu: null, requested_menu_version: null, requested_hash: versionHash, requested_payload: payload });
  if (error) throw error;
  return data;
}

async function processJob(admin: any, job: any) {
  if (!["publish_changeset", "scheduled_publish", "materialize_store"].includes(job.job_type)) return { skipped: true, reason: "unsupported_job_type" };
  const { data: changeset } = job.changeset_id ? await admin.from("catalog_changesets").select("*").eq("id", job.changeset_id).eq("organization_id", job.organization_id).single() : { data: null };
  const { data: items } = job.changeset_id ? await admin.from("catalog_changeset_items").select("*").eq("changeset_id", job.changeset_id).order("created_at") : { data: [] };
  let storeIds: string[] = job.store_id ? [job.store_id] : [...new Set((items || []).flatMap((item: any) => item.target_store_ids || []))] as string[];
  if (!storeIds.length) {
    const { data: stores } = await admin.from("establishments").select("id").eq("organization_id", job.organization_id).eq("active", true).limit(500);
    storeIds = (stores || []).map((store: any) => store.id);
  }
  let distributionId: string | null = job.distribution_job_id || null;
  if (changeset && changeset.scope_type !== "store" && !distributionId) {
    const { data: distribution, error } = await admin.from("catalog_distribution_jobs").upsert({ organization_id: job.organization_id, changeset_id: changeset.id, target_scope: changeset.scope_type === "organization" ? "stores_selected" : changeset.scope_type, target_ids: storeIds, conflict_policy: job.payload?.conflict_policy || "preserve_local", status: "processing", idempotency_key: `distribution:${changeset.id}`, started_at: new Date().toISOString(), created_by: job.payload?.requested_by || null }, { onConflict: "organization_id,idempotency_key" }).select().single();
    if (error) throw error; distributionId = distribution.id;
  }
  const results: any[] = [];
  for (const storeId of storeIds) {
    try {
      const relevant = (items || []).filter((item: any) => !(item.target_store_ids || []).length || item.target_store_ids.includes(storeId));
      for (const item of relevant) await applyItem(admin, job, item, storeId);
      const models = [];
      for (const channel of ["web", "delivery", "pickup", "qr", "kiosk", "whatsapp"]) models.push(await materialize(admin, job.organization_id, storeId, channel));
      if (distributionId) await admin.from("catalog_distribution_results").upsert({ distribution_job_id: distributionId, organization_id: job.organization_id, store_id: storeId, status: "applied", conflicts: [], attempt_count: job.attempts, applied_version_hash: models[0]?.version_hash || null, started_at: job.locked_at, completed_at: new Date().toISOString() }, { onConflict: "distribution_job_id,store_id" });
      results.push({ storeId, status: "applied", versionHash: models[0]?.version_hash || null });
    } catch (error: any) {
      if (distributionId) await admin.from("catalog_distribution_results").upsert({ distribution_job_id: distributionId, organization_id: job.organization_id, store_id: storeId, status: "failed", conflicts: [], error_message: String(error?.message || error).slice(0, 500), attempt_count: job.attempts, next_attempt_at: new Date(Date.now() + 5 * 60_000).toISOString(), started_at: job.locked_at }, { onConflict: "distribution_job_id,store_id" });
      results.push({ storeId, status: "failed", error: String(error?.message || error).slice(0, 500) });
      await recordOutbox(admin, job.organization_id, storeId, "catalog.distribution.failed", "catalog_distribution_job", distributionId, { distribution_job_id: distributionId, store_id: storeId, error_code: "STORE_PUBLISH_FAILED" }, `catalog-distribution-failed:${job.id}:${storeId}:${job.attempts}`);
    }
  }
  const failures = results.filter((result) => result.status === "failed");
  if (distributionId) await admin.from("catalog_distribution_jobs").update({ status: failures.length ? "partially_failed" : "completed", error_count: failures.length, completed_at: new Date().toISOString() }).eq("id", distributionId);
  if (changeset) await admin.from("catalog_changesets").update({ status: failures.length ? "partially_failed" : "published", published_at: failures.length === storeIds.length ? null : new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", changeset.id);
  if (changeset && failures.length !== storeIds.length) await recordOutbox(admin, job.organization_id, job.store_id, "catalog.changeset.published", "catalog_changeset", changeset.id, { changeset_id: changeset.id, stores: results, partial: failures.length > 0 }, `catalog-changeset-published:${job.id}`);
  return { changesetId: changeset?.id || null, distributionId, stores: results, partialFailure: failures.length > 0 };
}

export async function POST(request: Request) {
  const expected = process.env.CATALOG_WORKER_SECRET || process.env.AUTOMATION_WORKER_SECRET;
  if (!expected || request.headers.get("authorization") !== `Bearer ${expected}`) return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  const admin = createAdminClient();
  const { data: jobs, error } = await admin.rpc("claim_catalog_publish_jobs", { requested_worker: workerId, requested_limit: 10 });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const results = [];
  for (const job of jobs || []) {
    try {
      const result = await processJob(admin, job);
      await admin.from("catalog_publish_jobs").update({ status: "completed", result, completed_at: new Date().toISOString(), locked_at: null, locked_by: null }).eq("id", job.id);
      results.push({ id: job.id, status: "completed", result });
    } catch (errorValue: any) {
      const terminal = Number(job.attempts || 0) >= Number(job.max_attempts || 5);
      await admin.from("catalog_publish_jobs").update({ status: terminal ? "dead_letter" : "retrying", error_message: String(errorValue?.message || errorValue).slice(0, 1000), available_at: new Date(Date.now() + Math.min(60, 2 ** Number(job.attempts || 1)) * 60_000).toISOString(), locked_at: null, locked_by: null }).eq("id", job.id);
      results.push({ id: job.id, status: terminal ? "dead_letter" : "retrying" });
    }
  }
  return NextResponse.json({ processed: results.length, results });
}
