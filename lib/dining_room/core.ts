export const DINING_PERMISSIONS = [
  "dining:view", "dining:operate", "dining:assign_waiter", "dining:transfer_table",
  "dining:manage_tabs", "dining:discount", "dining:payments", "dining:reopen",
  "dining:analytics", "dining:settings",
] as const;

export const DINING_ACTIONS = {
  transfer_table: { permission: "dining:transfer_table", confirmation: true },
  transfer_tab: { permission: "dining:manage_tabs", confirmation: true },
  assign_waiter: { permission: "dining:assign_waiter", confirmation: true },
  merge_tables: { permission: "dining:transfer_table", confirmation: true },
  reopen_table: { permission: "dining:reopen", confirmation: true },
  apply_discount: { permission: "dining:discount", confirmation: true },
  block_table: { permission: "dining:settings", confirmation: true },
} as const;

export type TableSnapshot = {
  id: string; status: string; capacity: number; partySize?: number; areaId?: string | null;
  assignedWaiterId?: string | null; openedAt?: string | null; billRequestedAt?: string | null;
  totalCents?: number; lastOrderAt?: string | null; pendingRequests?: number;
};

export function splitEqually(totalCents: number, people: number) {
  if (!Number.isInteger(totalCents) || totalCents < 0 || !Number.isInteger(people) || people < 1) throw new Error("Divisão inválida");
  const base = Math.floor(totalCents / people), remainder = totalCents % people;
  return Array.from({ length: people }, (_, index) => base + (index < remainder ? 1 : 0));
}

export function calculateBalance(totalCents: number, confirmedPayments: number[]) {
  if (confirmedPayments.some(value => !Number.isInteger(value) || value < 0)) throw new Error("Pagamento inválido");
  return Math.max(0, totalCents - confirmedPayments.reduce((sum, value) => sum + value, 0));
}

export function cashChange(amountCents: number, receivedCents: number) {
  if (!Number.isInteger(amountCents) || !Number.isInteger(receivedCents) || receivedCents < amountCents) throw new Error("Valor recebido insuficiente");
  return receivedCents - amountCents;
}

export function tableAttention(snapshot: TableSnapshot, now = Date.now()) {
  const minutes = (value?: string | null) => value ? Math.max(0, Math.floor((now - new Date(value).getTime()) / 60000)) : 0;
  const risks: string[] = [];
  if (snapshot.billRequestedAt && minutes(snapshot.billRequestedAt) >= 5) risks.push("Conta aguardando fechamento");
  if (snapshot.lastOrderAt && minutes(snapshot.lastOrderAt) >= 18 && snapshot.status === "in_service") risks.push("Mesa sem novo atendimento");
  if ((snapshot.pendingRequests || 0) > 0) risks.push("Solicitação pendente");
  if ((snapshot.partySize || 0) > snapshot.capacity) risks.push("Grupo acima da capacidade recomendada");
  return { needsAttention: risks.length > 0, risks };
}

export function suggestWaiter(waiters: { id: string; activeTables: number; areaIds: string[]; active: boolean }[], areaId?: string | null) {
  return waiters.filter(w => w.active && (!areaId || !w.areaIds.length || w.areaIds.includes(areaId)))
    .sort((a, b) => a.activeTables - b.activeTables || a.id.localeCompare(b.id))[0] || null;
}

export const DINING_COPILOT_TOOLS = [
  "getDiningRoomStatus", "getOpenTables", "getTablesWaitingForService", "getBillsRequested",
  "getWaiterLoad", "getTableConsumption", "getDiningRoomBottlenecks", "getDiningRoomRevenueSummary",
] as const;

export function copilotAnswer(tool: typeof DINING_COPILOT_TOOLS[number], tables: TableSnapshot[]) {
  const open = tables.filter(t => !["available", "free", "closed"].includes(t.status));
  if (tool === "getOpenTables") return open;
  if (tool === "getBillsRequested") return open.filter(t => t.status === "bill_requested" || t.billRequestedAt);
  if (tool === "getTablesWaitingForService") return open.filter(t => tableAttention(t).needsAttention);
  if (tool === "getDiningRoomRevenueSummary") return { currentConsumptionCents: open.reduce((sum, t) => sum + (t.totalCents || 0), 0) };
  return { open: open.length, available: tables.length - open.length, attention: open.filter(t => tableAttention(t).needsAttention).length };
}
