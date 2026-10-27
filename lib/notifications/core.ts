import { createHash, randomUUID } from "node:crypto";

export const NOTIFICATION_PRIORITIES = ["info", "low", "medium", "high", "critical"] as const;
export const NOTIFICATION_CATEGORIES = ["orders", "payments", "inventory", "approvals", "operation", "security", "automation", "system", "executive"] as const;
export type NotificationPriority = typeof NOTIFICATION_PRIORITIES[number];

export type NotificationEvent = {
  organizationId: string;
  storeId?: string | null;
  eventType: string;
  sourceType: string;
  sourceId: string;
  title: string;
  summary?: string | null;
  priority?: NotificationPriority;
  recipientUserId?: string | null;
  recipientRole?: string | null;
  recipientTeamId?: string | null;
  requiresAction?: boolean;
  actionDeadline?: string | null;
  route?: string | null;
  allowedActions?: string[];
  metadata?: Record<string, unknown>;
  dedupWindowMinutes?: number;
  groupKey?: string | null;
};

const SENSITIVE_KEYS = /token|secret|password|authorization|document|cpf|card|email|phone/i;
export function redactNotificationMetadata(value: unknown): unknown {
  if (Array.isArray(value)) return value.slice(0, 50).map(redactNotificationMetadata);
  if (!value || typeof value !== "object") return typeof value === "string" ? value.slice(0, 500) : value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).slice(0, 60).map(([key, item]) => [key, SENSITIVE_KEYS.test(key) ? "[PROTEGIDO]" : redactNotificationMetadata(item)]));
}

export function buildDedupKey(event: Pick<NotificationEvent, "eventType" | "sourceType" | "sourceId" | "recipientUserId" | "recipientRole" | "recipientTeamId">) {
  const recipient = event.recipientUserId || event.recipientTeamId || event.recipientRole || "unresolved";
  return createHash("sha256").update(`${event.eventType}:${event.sourceType}:${event.sourceId}:${recipient}`).digest("hex");
}

export function notificationPriorityRank(priority: string) {
  return ({ info: 0, low: 1, medium: 2, high: 3, critical: 4 } as Record<string, number>)[priority] ?? 2;
}

export function canSnooze(priority: string, mandatory = false) {
  return !mandatory && priority !== "critical";
}

export function canDismiss(priority: string, requiresAction: boolean) {
  return !requiresAction && ["info", "low"].includes(priority);
}

export function quietHoursActive(quietHours: Record<string, unknown> | null | undefined, now = new Date()) {
  if (!quietHours?.enabled) return false;
  const start = String(quietHours.start || "22:00");
  const end = String(quietHours.end || "07:00");
  const minutes = now.getHours() * 60 + now.getMinutes();
  const parse = (value: string) => { const [h, m] = value.split(":").map(Number); return h * 60 + m; };
  const from = parse(start), to = parse(end);
  return from <= to ? minutes >= from && minutes < to : minutes >= from || minutes < to;
}

export function effectiveChannels(priority: string, mandatory: boolean, preferences?: { inbox_enabled?: boolean; email_enabled?: boolean; push_enabled?: boolean; whatsapp_enabled?: boolean; quiet_hours?: Record<string, unknown> }) {
  const critical = priority === "critical";
  const channels = new Set<string>(["in_app"]);
  if (preferences?.email_enabled) channels.add("email");
  if (preferences?.push_enabled || critical) channels.add("push");
  if (preferences?.whatsapp_enabled && (critical || !quietHoursActive(preferences.quiet_hours))) channels.add("whatsapp");
  if (mandatory || critical) channels.add("in_app");
  return [...channels];
}

export function escalationDue(item: { priority: string; created_at: string; acknowledged_at?: string | null; resolved_at?: string | null }, now = Date.now()) {
  if (item.resolved_at || item.acknowledged_at) return false;
  const minutes = ({ critical: 5, high: 20, medium: 120, low: 480, info: 1440 } as Record<string, number>)[item.priority] ?? 120;
  return now - new Date(item.created_at).getTime() >= minutes * 60_000;
}

export function nextRetryAt(attempt: number, now = Date.now()) {
  return new Date(now + Math.min(3_600_000, 30_000 * 2 ** Math.max(0, attempt))).toISOString();
}

export function safeNotificationEvent(input: NotificationEvent) {
  if (!input.organizationId || !input.eventType || !input.sourceType || !input.sourceId || !input.title) throw new Error("INVALID_NOTIFICATION_EVENT");
  if (!input.recipientUserId && !input.recipientRole && !input.recipientTeamId) throw new Error("RECIPIENT_REQUIRED");
  if (input.route && !input.route.startsWith("/")) throw new Error("INVALID_INTERNAL_ROUTE");
  const priority = NOTIFICATION_PRIORITIES.includes(input.priority as NotificationPriority) ? input.priority! : "medium";
  return {
    organization_id: input.organizationId,
    store_id: input.storeId || null,
    recipient_user_id: input.recipientUserId || null,
    recipient_role_id: input.recipientRole || null,
    recipient_team_id: input.recipientTeamId || null,
    source_type: input.sourceType,
    source_id: String(input.sourceId),
    event_type: input.eventType,
    category: input.eventType.split(".")[0] || "system",
    title: input.title.slice(0, 180),
    summary: input.summary?.slice(0, 500) || null,
    priority,
    requires_action: Boolean(input.requiresAction),
    action_deadline: input.actionDeadline || null,
    route: input.route || null,
    allowed_actions: input.allowedActions || ["open", "acknowledge"],
    metadata: redactNotificationMetadata(input.metadata || {}),
    dedup_key: buildDedupKey(input),
    group_key: input.groupKey || null,
    correlation_id: randomUUID(),
  };
}

export const NOTIFICATION_COPILOT_TOOLS = [
  "getMyNotifications", "summarizeCriticalNotifications", "explainNotification", "findNotificationSource", "draftActionPlanFromNotification",
] as const;

export function fatigueScore(metrics: { unread: number; critical: number; repeated: number; oldestMinutes: number }) {
  return Math.min(100, Math.round(metrics.unread * 1.2 + metrics.critical * 8 + metrics.repeated * 2 + Math.min(30, metrics.oldestMinutes / 60)));
}
