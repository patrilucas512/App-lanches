/* eslint-disable @typescript-eslint/no-explicit-any */
import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { CATALOG_PERMISSIONS, CatalogAvailabilityResolver, CatalogChangesetService, CatalogHealthService, CatalogImportService, CatalogPriceResolver, CatalogValidationService } from "@/lib/catalog-management/core";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const reply = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "cache-control": "private, no-store" } });
const safeReason = (value: unknown) => String(value || "").trim().slice(0, 500) || null;

async function context(storeId: string) {
  if (!UUID.test(storeId)) throw new Error("FORBIDDEN");
  const client = await createClient();
  const { data } = await client.auth.getClaims();
  const userId = String(data?.claims?.sub || "");
  if (!userId) throw new Error("AUTH");
  const admin = createAdminClient();
  const { data: store } = await admin.from("establishments").select("id,organization_id,name,slug").eq("id", storeId).maybeSingle();
  if (!store) throw new Error("FORBIDDEN");
  const [{ data: local }, { data: org }, { data: custom }] = await Promise.all([
    admin.from("establishment_members").select("role").eq("establishment_id", storeId).eq("user_id", userId).eq("status", "active").maybeSingle(),
    admin.from("organization_members").select("role,all_stores").eq("organization_id", store.organization_id).eq("user_id", userId).eq("active", true).maybeSingle(),
    admin.from("catalog_member_permissions").select("permissions,scope_type,scope_id").eq("organization_id", store.organization_id).eq("user_id", userId).eq("active", true),
  ]);
  if (!local && !org) throw new Error("FORBIDDEN");
  const role = String(org?.role || local?.role || "member");
  const permissions = new Set<string>();
  if (["owner", "admin", "manager"].includes(role)) CATALOG_PERMISSIONS.forEach((permission) => permissions.add(permission));
  if (role === "catalog_editor") ["catalog:view", "catalog:create_product", "catalog:edit_product", "catalog:manage_categories", "catalog:manage_modifiers", "catalog:manage_combos", "catalog:import", "catalog:export"].forEach((permission) => permissions.add(permission));
  for (const row of custom || []) for (const permission of row.permissions || []) permissions.add(permission);
  return { admin, userId, store, storeId, organizationId: store.organization_id, permissions, network: Boolean(org?.all_stores) && permissions.has("catalog:manage_network") };
}

const requirePermission = (contextValue: any, permission: string) => { if (!contextValue.permissions.has(permission)) throw new Error("FORBIDDEN"); };
async function audit(c: any, eventType: string, entityType: string, entityId?: string | null, reason?: unknown, before?: unknown, after?: unknown) {
  await c.admin.from("catalog_audit_events").insert({ organization_id: c.organizationId, store_id: c.storeId, actor_user_id: c.userId, event_type: eventType, entity_type: entityType, entity_id: entityId || null, reason: safeReason(reason), before_state: before ?? null, after_state: after ?? null, metadata: {} });
}
async function ownedChangeset(c: any, id: string) {
  const { data } = await c.admin.from("catalog_changesets").select("*").eq("id", id).eq("organization_id", c.organizationId).maybeSingle();
  if (!data) throw new Error("FORBIDDEN");
  if (data.scope_type === "store" && data.scope_id !== c.storeId && !c.network) throw new Error("FORBIDDEN");
  return data;
}

async function catalogSnapshot(c: any) {
  const [products, categories, assignments, channels, recipes, modifiers, combos] = await Promise.all([
    c.admin.from("products").select("id,organization_id,establishment_id,category_id,master_product_id,sku,internal_code,barcode,name,short_name,description,image_url,price_cents,compare_at_price_cents,active,featured,sort_order,product_type,lifecycle_status,catalog_version,updated_at").eq("organization_id", c.organizationId).order("updated_at", { ascending: false }).limit(1000),
    c.admin.from("categories").select("id,organization_id,establishment_id,parent_id,name,description,image_url,active,sort_order,catalog_version").eq("organization_id", c.organizationId).order("sort_order").limit(500),
    c.admin.from("catalog_product_assignments").select("*").eq("organization_id", c.organizationId).eq("store_id", c.storeId).limit(2000),
    c.admin.from("product_channel_availability").select("product_id,store_id,channel,fulfillment_method,enabled,temporary_block_until").eq("organization_id", c.organizationId).or(`store_id.is.null,store_id.eq.${c.storeId}`).limit(5000),
    c.admin.from("inventory_recipes").select("product_id,variation_id").eq("establishment_id", c.storeId).limit(5000),
    c.admin.from("addon_groups").select("id,name,min_choices,max_choices,required,selection_type,status").eq("establishment_id", c.storeId).limit(500),
    c.admin.from("product_combos").select("*,combo_components(*)").eq("organization_id", c.organizationId).limit(500),
  ]);
  return { products: products.data || [], categories: categories.data || [], assignments: assignments.data || [], channels: channels.data || [], recipes: recipes.data || [], modifiers: modifiers.data || [], combos: combos.data || [] };
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const c = await context(String(url.searchParams.get("store_id") || ""));
    requirePermission(c, "catalog:view");
    const snapshot = await catalogSnapshot(c);
    const productId = url.searchParams.get("product_id");
    if (productId) {
      const product = snapshot.products.find((row: any) => row.id === productId);
      if (!product) return reply({ error: "Produto não encontrado." }, 404);
      const [versions, attributes, media, variations, modifierAssignments, priceHistory, priceItems, availability, stationMapping] = await Promise.all([
        c.admin.from("catalog_product_versions").select("version,field_diff,changeset_id,created_at,created_by").eq("product_id", productId).order("version", { ascending: false }).limit(100),
        c.admin.from("product_attributes").select("*,product_attribute_registry(attribute_key,display_name,attribute_type)").eq("product_id", productId),
        c.admin.from("catalog_product_media").select("id,variant_type,storage_bucket,storage_path,alt_text,display_order,width,height").eq("product_id", productId).order("display_order"),
        c.admin.from("product_variations").select("*").eq("product_id", productId).order("sort_order"),
        c.admin.from("product_modifier_assignments").select("*,addon_groups(name,min_choices,max_choices,required,selection_type,status)").eq("product_id", productId).order("display_order"),
        c.admin.from("product_price_history").select("*").eq("product_id", productId).eq("store_id", c.storeId).order("effective_at", { ascending: false }).limit(100),
        c.admin.from("price_book_items").select("*,price_books(name,scope_type,scope_id,status,effective_from,effective_until)").eq("product_id", productId).eq("organization_id", c.organizationId).limit(200),
        c.admin.from("product_channel_availability").select("*").eq("product_id", productId).eq("organization_id", c.organizationId),
        c.admin.from("product_station_assignments").select("id,station_id,variation_id,preparation_sequence,estimated_prep_time,primary_station,kitchen_stations(name,code)").eq("store_id", c.storeId).eq("product_id", productId),
      ]);
      return reply({ product, versions: versions.data || [], attributes: attributes.data || [], media: media.data || [], variations: variations.data || [], modifierAssignments: modifierAssignments.data || [], priceHistory: priceHistory.data || [], priceItems: priceItems.data || [], availability: availability.data || [], stationMapping: stationMapping.data || [], costVisible: c.permissions.has("catalog:view_cost"), orderSnapshotPolicy: "historical_order_items_are_immutable" });
    }
    const [changesets, distributions, priceBooks, menus, profiles, policies, validations, published] = await Promise.all([
      c.admin.from("catalog_changesets").select("*,catalog_changeset_items(id,entity_type,operation,target_store_ids,requires_action_engine)").eq("organization_id", c.organizationId).order("updated_at", { ascending: false }).limit(100),
      c.admin.from("catalog_distribution_jobs").select("*,catalog_distribution_results(store_id,status,conflicts,error_message,attempt_count)").eq("organization_id", c.organizationId).order("created_at", { ascending: false }).limit(50),
      c.admin.from("price_books").select("*,price_book_items(id,product_id,variant_id,channel,fulfillment_method,price_cents,effective_from,effective_until)").eq("organization_id", c.organizationId).order("updated_at", { ascending: false }).limit(100),
      c.admin.from("menu_collections").select("*,menu_versions(id,version,status,version_hash,published_at),menu_assignments(store_id,channel,active_version_id,active)").eq("organization_id", c.organizationId).limit(100),
      c.admin.from("catalog_availability_profiles").select("*").eq("organization_id", c.organizationId).order("name"),
      c.admin.from("catalog_field_policies").select("*").eq("organization_id", c.organizationId).limit(1000),
      c.admin.from("catalog_validation_results").select("*").eq("organization_id", c.organizationId).is("resolved_at", null).order("created_at", { ascending: false }).limit(500),
      c.admin.from("published_catalog_read_models").select("store_id,channel,version_hash,product_count,published_at,status").eq("organization_id", c.organizationId).eq("status", "published").order("published_at", { ascending: false }),
    ]);
    const health = CatalogHealthService.summarize(snapshot.products.map((product: any) => ({ imageUrl: product.image_url, description: product.description, active: product.active, recipeLinked: snapshot.recipes.some((recipe: any) => recipe.product_id === product.id), channels: snapshot.channels.filter((row: any) => row.product_id === product.id && row.enabled).map((row: any) => row.channel) })), snapshot.modifiers.filter((group: any) => Number(group.max_choices) < Number(group.min_choices)).length, 0);
    return reply({ ...snapshot, changesets: changesets.data || [], distributions: distributions.data || [], priceBooks: priceBooks.data || [], menus: menus.data || [], availabilityProfiles: profiles.data || [], fieldPolicies: policies.data || [], validationResults: validations.data || [], publishedCatalogs: published.data || [], health, permissions: [...c.permissions], scope: c.network ? "network" : "store", architecture: { productSourceOfTruth: "products", inventorySourceOfTruth: "inventory_items/inventory_recipes", pricingEngineReused: true, publishedReadModel: true, historicalOrderSnapshots: true } });
  } catch (error: any) {
    const message = error?.message || "Falha ao carregar o catálogo.";
    return reply({ error: message }, message === "AUTH" ? 401 : message === "FORBIDDEN" ? 403 : 500);
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const c = await context(String(body.store_id || ""));
    const action = String(body.action || "");

    if (action === "create_changeset") {
      requirePermission(c, "catalog:edit_product");
      const scopeType = String(body.scope_type || "store");
      if (scopeType !== "store" && !c.network) throw new Error("FORBIDDEN");
      const { data, error } = await c.admin.from("catalog_changesets").insert({ organization_id: c.organizationId, name: String(body.name || "Nova alteração de catálogo").trim().slice(0, 140), description: String(body.description || "").trim() || null, scope_type: scopeType, scope_id: scopeType === "store" ? c.storeId : body.scope_id || null, two_person_rule: Boolean(body.two_person_rule), created_by: c.userId }).select().single();
      if (error) throw error;
      await audit(c, "changeset_created", "catalog_changeset", data.id, body.reason, null, data);
      return reply({ changeset: data }, 201);
    }

    if (action === "add_change") {
      requirePermission(c, String(body.entity_type) === "price" ? "catalog:manage_prices" : "catalog:edit_product");
      const changeset = await ownedChangeset(c, body.changeset_id);
      if (!["draft", "review"].includes(changeset.status)) return reply({ error: "Somente changesets em rascunho ou revisão podem ser alterados." }, 409);
      const before = body.before_state && typeof body.before_state === "object" ? body.before_state : {};
      const after = body.after_state && typeof body.after_state === "object" ? body.after_state : {};
      const requiresActionEngine = String(body.entity_type) === "price" || Boolean(body.requires_action_engine);
      const { data, error } = await c.admin.from("catalog_changeset_items").insert({ changeset_id: changeset.id, organization_id: c.organizationId, entity_type: body.entity_type, entity_id: body.entity_id || null, operation: body.operation || "update", before_state: before, after_state: after, target_store_ids: Array.isArray(body.target_store_ids) ? body.target_store_ids : [c.storeId], requires_action_engine: requiresActionEngine, action_approval_id: body.action_approval_id || null, created_by: c.userId }).select().single();
      if (error) throw error;
      await c.admin.from("catalog_changesets").update({ status: "draft", updated_at: new Date().toISOString() }).eq("id", changeset.id);
      await audit(c, "changeset_item_added", body.entity_type, body.entity_id, body.reason, before, after);
      return reply({ item: data, diff: CatalogChangesetService.diff(before, after), actionEngineRequired: requiresActionEngine }, 201);
    }

    if (action === "validate") {
      requirePermission(c, "catalog:view");
      const changeset = await ownedChangeset(c, body.changeset_id);
      const snapshot = await catalogSnapshot(c);
      const result = CatalogValidationService.validate({ products: snapshot.products.map((product: any) => ({ id: product.id, organizationId: product.organization_id, storeId: product.establishment_id, categoryId: product.category_id, masterProductId: product.master_product_id, sku: product.sku, barcode: product.barcode, internalCode: product.internal_code, name: product.name, description: product.description, priceCents: Number(product.price_cents), status: product.lifecycle_status, productType: product.product_type, imageUrl: product.image_url })), modifierGroups: snapshot.modifiers.map((group: any) => ({ id: group.id, minSelect: Number(group.min_choices), maxSelect: Number(group.max_choices) })), combos: snapshot.combos.map((combo: any) => ({ id: combo.id, components: (combo.combo_components || []).map((component: any) => ({ minSelect: Number(component.min_select), maxSelect: Number(component.max_select), sourceId: component.source_id })) })), channelAssignments: snapshot.channels.filter((row: any) => row.enabled).map((row: any) => ({ productId: row.product_id, channels: [row.channel] })) });
      await c.admin.from("catalog_validation_results").delete().eq("changeset_id", changeset.id);
      if (result.issues.length) await c.admin.from("catalog_validation_results").insert(result.issues.map((issue) => ({ organization_id: c.organizationId, changeset_id: changeset.id, entity_type: "catalog", entity_id: issue.entityId || null, severity: issue.severity, rule_code: issue.code, message: issue.message })));
      await c.admin.from("catalog_changesets").update({ status: result.valid ? "review" : "draft", validation_summary: result, updated_at: new Date().toISOString() }).eq("id", changeset.id);
      await audit(c, "changeset_validated", "catalog_changeset", changeset.id, body.reason, null, result);
      return reply({ validation: result });
    }

    if (action === "preview") {
      requirePermission(c, "catalog:view");
      const changeset = await ownedChangeset(c, body.changeset_id);
      const { data: items } = await c.admin.from("catalog_changeset_items").select("*").eq("changeset_id", changeset.id).order("created_at");
      const preview = CatalogChangesetService.preview((items || []).map((item: any) => ({ entityType: item.entity_type, operation: item.operation, before: item.before_state, after: item.after_state, storeIds: item.target_store_ids })));
      const conflicts = (items || []).filter((item: any) => item.requires_action_engine && !item.action_approval_id).map((item: any) => ({ itemId: item.id, reason: "action_engine_approval_required" }));
      const result = { ...preview, conflicts, warnings: [], affectedChannels: [...new Set((items || []).flatMap((item: any) => item.after_state?.channels || []))], keepsLastPublishedOnFailure: true };
      await c.admin.from("catalog_changesets").update({ preview_summary: result, updated_at: new Date().toISOString() }).eq("id", changeset.id);
      await audit(c, "changeset_previewed", "catalog_changeset", changeset.id, body.reason, null, result);
      return reply({ preview: result, notice: "Prévia concluída sem publicar, alterar preço, estoque ou receita." });
    }

    if (action === "publish" || action === "schedule_publish") {
      requirePermission(c, action === "schedule_publish" ? "catalog:schedule_publish" : "catalog:publish");
      if (!body.human_confirmed) return reply({ error: "Publicação exige confirmação humana após a prévia." }, 409);
      const changeset = await ownedChangeset(c, body.changeset_id);
      const [{ data: errors }, { data: items }] = await Promise.all([
        c.admin.from("catalog_validation_results").select("id").eq("changeset_id", changeset.id).eq("severity", "error").is("resolved_at", null),
        c.admin.from("catalog_changeset_items").select("id,requires_action_engine,action_approval_id,target_store_ids").eq("changeset_id", changeset.id),
      ]);
      if (errors?.length) return reply({ error: "A publicação está bloqueada por erros de validação." }, 409);
      if (!changeset.preview_summary?.requiresConfirmation) return reply({ error: "Gere a prévia antes de publicar." }, 409);
      const approvalIds = [...new Set((items || []).filter((item: any) => item.requires_action_engine && item.action_approval_id).map((item: any) => item.action_approval_id))];
      const { data: approvalRows } = approvalIds.length ? await c.admin.from("internal_approvals").select("id,status,resolved_at").in("id", approvalIds).eq("status", "approved") : { data: [] };
      const validApprovals = new Set((approvalRows || []).filter((row: any) => row.resolved_at).map((row: any) => row.id));
      const unapproved = (items || []).filter((item: any) => item.requires_action_engine && (!item.action_approval_id || !validApprovals.has(item.action_approval_id)));
      if (unapproved.length) return reply({ error: "Alterações de preço ou alto risco aguardam ActionEngine/aprovação.", items: unapproved.map((item: any) => item.id) }, 409);
      if (changeset.two_person_rule && (!changeset.approved_by || changeset.approved_by === c.userId)) return reply({ error: "A regra de duas pessoas exige aprovação de outro usuário." }, 409);
      const scheduledFor = action === "schedule_publish" ? new Date(body.scheduled_for) : new Date();
      if (Number.isNaN(scheduledFor.getTime())) return reply({ error: "Data de publicação inválida." }, 400);
      const idempotency = `catalog:${changeset.id}:${action}:${scheduledFor.toISOString()}`;
      const { data: job, error } = await c.admin.from("catalog_publish_jobs").upsert({ organization_id: c.organizationId, changeset_id: changeset.id, store_id: changeset.scope_type === "store" ? c.storeId : null, job_type: action === "schedule_publish" ? "scheduled_publish" : "publish_changeset", status: "pending", available_at: scheduledFor.toISOString(), payload: { scope_type: changeset.scope_type, scope_id: changeset.scope_id, requested_by: c.userId }, idempotency_key: idempotency }, { onConflict: "organization_id,idempotency_key" }).select().single();
      if (error) throw error;
      await c.admin.from("catalog_changesets").update({ status: action === "schedule_publish" ? "approved" : "publishing", scheduled_for: action === "schedule_publish" ? scheduledFor.toISOString() : null, published_by: action === "publish" ? c.userId : null, updated_at: new Date().toISOString() }).eq("id", changeset.id);
      await audit(c, action === "schedule_publish" ? "changeset_scheduled" : "changeset_publish_queued", "catalog_changeset", changeset.id, body.reason, changeset, { job_id: job.id, scheduled_for: scheduledFor.toISOString() });
      return reply({ job, asynchronous: true, lastPublishedCatalogRemainsAvailable: true }, 202);
    }

    if (action === "rollback_preview") {
      requirePermission(c, "catalog:publish");
      const changeset = await ownedChangeset(c, body.changeset_id);
      const { data: items } = await c.admin.from("catalog_changeset_items").select("entity_type,entity_id,before_state,after_state").eq("changeset_id", changeset.id);
      const rollbackItems = CatalogChangesetService.rollback((items || []).map((item: any) => ({ entityType: item.entity_type, entityId: item.entity_id, before: item.before_state, after: item.after_state })));
      return reply({ rollback: { items: rollbackItems, affectsHistoricalOrders: false, requiresConfirmation: true, supportedFields: ["price", "availability", "content"] }, noActionsExecuted: true });
    }

    if (action === "assign_product") {
      requirePermission(c, "catalog:manage_network");
      const storeId = String(body.target_store_id || c.storeId);
      const { data: target } = await c.admin.from("establishments").select("id").eq("id", storeId).eq("organization_id", c.organizationId).maybeSingle();
      if (!target) throw new Error("FORBIDDEN");
      const { data, error } = await c.admin.from("catalog_product_assignments").upsert({ organization_id: c.organizationId, product_id: body.product_id, store_id: storeId, enabled: body.enabled !== false, local_name_override: body.local_name_override || null, local_description_override: body.local_description_override || null, local_price_override_cents: body.local_price_override_cents ?? null, local_status: body.local_status || "active", override_policy: body.override_policy || "partial", overrides: body.overrides || {} }, { onConflict: "product_id,store_id" }).select().single();
      if (error) throw error;
      await audit(c, "product_assignment_updated", "product", body.product_id, body.reason, null, data);
      return reply({ assignment: data });
    }

    if (action === "set_field_policy") {
      requirePermission(c, "catalog:manage_governance");
      const { data, error } = await c.admin.from("catalog_field_policies").upsert({ organization_id: c.organizationId, scope_type: body.scope_type, scope_id: body.scope_id, field_name: body.field_name, policy: body.policy, allowed_override_scope: body.allowed_override_scope || [], created_by: c.userId, updated_at: new Date().toISOString() }, { onConflict: "organization_id,scope_type,scope_id,field_name" }).select().single();
      if (error) throw error;
      await audit(c, "field_policy_updated", "catalog_field_policy", data.id, body.reason, null, data);
      return reply({ policy: data });
    }

    if (action === "create_price_book") {
      requirePermission(c, "catalog:manage_prices");
      const { data, error } = await c.admin.from("price_books").insert({ organization_id: c.organizationId, name: String(body.name || "Tabela de preços").trim(), scope_type: body.scope_type || "store", scope_id: body.scope_id || c.storeId, currency: "BRL", status: "draft", effective_from: body.effective_from || new Date().toISOString(), effective_until: body.effective_until || null, created_by: c.userId }).select().single();
      if (error) throw error;
      await audit(c, "price_book_created", "price_book", data.id, body.reason, null, data);
      return reply({ priceBook: data, pricingEngineReused: true }, 201);
    }

    if (action === "create_availability_profile") {
      requirePermission(c, "catalog:edit_product");
      const { data, error } = await c.admin.from("catalog_availability_profiles").insert({ organization_id: c.organizationId, name: String(body.name || "Novo horário").trim(), days_of_week: body.days_of_week || [0, 1, 2, 3, 4, 5, 6], time_windows: body.time_windows || [], channel_scope: body.channel_scope || [], fulfillment_scope: body.fulfillment_scope || [], start_date: body.start_date || null, end_date: body.end_date || null, timezone: body.timezone || "America/Sao_Paulo", stock_policy: body.stock_policy || "manual_control" }).select().single();
      if (error) throw error;
      await audit(c, "availability_profile_created", "availability_profile", data.id, body.reason, null, data);
      return reply({ profile: data }, 201);
    }

    if (action === "import_preview") {
      requirePermission(c, "catalog:import");
      const rows = Array.isArray(body.rows) ? body.rows.slice(0, 10000) : [];
      const result = CatalogImportService.validateRows(rows, body.mode || "create_and_update");
      const summary = { total: result.length, valid: result.filter((row) => row.valid).length, invalid: result.filter((row) => !row.valid).length, duplicateCandidates: result.filter((row) => row.errors.some((error) => error.startsWith("duplicate_row"))).length, imported: 0 };
      await audit(c, "catalog_import_previewed", "catalog_import", null, body.reason, null, summary);
      return reply({ rows: result, summary, noRowsImported: true, formulaInjectionProtected: true });
    }

    if (action === "resolve_price_preview") {
      requirePermission(c, "catalog:view");
      return reply(CatalogPriceResolver.resolve(body.candidates || [], { now: new Date(body.now || Date.now()), organizationId: c.organizationId, brandId: body.brand_id || null, regionId: body.region_id || null, storeId: c.storeId, channel: body.channel || "web", fulfillmentMethod: body.fulfillment_method || null, timezone: body.timezone || "America/Sao_Paulo" }, Number(body.default_price_cents || 0)));
    }

    if (action === "resolve_availability_preview") {
      requirePermission(c, "catalog:view");
      return reply(CatalogAvailabilityResolver.resolve(body.input || { manualActive: true, storeOpen: true, channelEnabled: true, withinSchedule: true }));
    }

    if (action === "ai_content_draft") {
      requirePermission(c, "catalog:edit_product");
      const draft = { id: randomUUID(), product_id: body.product_id || null, name: String(body.name || "Produto").trim(), description: `Descrição sugerida para ${String(body.name || "produto").trim()}. Revise ingredientes, atributos e informações declaradas antes de usar.`, suggestedCategory: body.category_hint || null, status: "draft", automaticPublish: false, priceChanged: false };
      await audit(c, "ai_content_draft_created", "product_content_draft", null, body.reason, null, { product_id: body.product_id || null });
      return reply({ draft, notice: "A IA apenas criou um rascunho; nenhum produto, preço ou catálogo foi alterado." }, 201);
    }

    if (action === "archive_preview") {
      requirePermission(c, "catalog:edit_product");
      const productId = String(body.product_id || "");
      const [menus, combos, campaigns, recipes, assignments] = await Promise.all([
        c.admin.from("menu_items").select("id,menu_version_id").eq("source_id", productId).eq("item_type", "product"),
        c.admin.from("combo_components").select("id,combo_id").eq("source_id", productId).eq("component_type", "product"),
        c.admin.from("marketing_campaign_plans").select("campaign_id,product_scope").eq("organization_id", c.organizationId).contains("product_scope", { product_ids: [productId] }).limit(100),
        c.admin.from("inventory_recipes").select("id").eq("product_id", productId),
        c.admin.from("catalog_product_assignments").select("store_id,enabled,local_status").eq("product_id", productId),
      ]);
      const links = { activeMenus: menus.data || [], combos: combos.data || [], campaigns: campaigns.data || [], recipes: recipes.data || [], storeAssignments: assignments.data || [] };
      return reply({ archivePreview: links, canArchive: !Object.values(links).some((rows) => rows.length), hardDelete: false, affectsActiveOrders: false, requiresConfirmation: true });
    }

    return reply({ error: "Ação de catálogo não reconhecida." }, 400);
  } catch (error: any) {
    const message = error?.message || "Falha na operação de catálogo.";
    return reply({ error: message }, message === "AUTH" ? 401 : message === "FORBIDDEN" ? 403 : 500);
  }
}
