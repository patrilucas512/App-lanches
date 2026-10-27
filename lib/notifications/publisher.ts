import { effectiveChannels, safeNotificationEvent, type NotificationEvent } from "@/lib/notifications/core";

export async function publishNotification(admin: any, input: NotificationEvent) {
  const safe: any = safeNotificationEvent(input), correlationId = safe.correlation_id;
  delete safe.correlation_id;
  const existing = await admin.from("notification_inbox_items").select("*").eq("organization_id", safe.organization_id).eq("dedup_key", safe.dedup_key).not("status", "in", '("resolved","dismissed","expired")').maybeSingle();
  let item: any;
  if (existing.data) {
    const update = await admin.from("notification_inbox_items").update({ occurrence_count: Number(existing.data.occurrence_count || 1) + 1, last_occurrence_at: new Date().toISOString(), summary: safe.summary || existing.data.summary, priority: safe.priority, status: existing.data.status === "snoozed" ? "snoozed" : "unread", metadata: { ...(existing.data.metadata || {}), ...(safe.metadata || {}) } }).eq("id", existing.data.id).select().single();
    if (update.error) throw update.error; item = update.data;
  } else {
    const created = await admin.from("notification_inbox_items").insert(safe).select().single();
    if (created.error) throw created.error; item = created.data;
  }
  const pref = input.recipientUserId ? (await admin.from("notification_user_preferences").select("*").eq("organization_id", input.organizationId).eq("user_id", input.recipientUserId).eq("category", safe.category).maybeSingle()).data : null;
  const channels = effectiveChannels(safe.priority, Boolean(safe.metadata?.mandatory), pref || undefined);
  const deliveries = channels.filter(channel => channel !== "in_app").map(channel => ({ inbox_item_id: item.id, organization_id: input.organizationId, channel, recipient: input.recipientUserId || input.recipientRole || input.recipientTeamId, idempotency_key: `${item.id}:${channel}:${item.occurrence_count}` }));
  if (deliveries.length) await admin.from("notification_deliveries").upsert(deliveries, { onConflict: "channel,idempotency_key", ignoreDuplicates: true });
  await admin.from("notification_audit_events").insert({ organization_id: input.organizationId, inbox_item_id: item.id, action: existing.data ? "deduplicated" : "published", after_state: { event_type: input.eventType, channels }, correlation_id: correlationId });
  return { item, channels, deduplicated: Boolean(existing.data) };
}
