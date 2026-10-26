export const operationsCopilotTools = ["getSystemHealth", "getSlowEndpoints", "getQueueHealth", "getDatabaseHealth", "getIntegrationLatency", "getErrorRate", "getCapacitySummary"] as const;
export type OperationsCopilotTool = typeof operationsCopilotTools[number];

export function operationsToolIsReadOnly(tool: string) { return operationsCopilotTools.includes(tool as OperationsCopilotTool); }

export function explainOperationsQuestion(question: string) {
  const text = question.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  if (/fila|acumulad|job|dlq/.test(text)) return { tool: "getQueueHealth", source: "operational_jobs", action: null };
  if (/banco|query|conexao/.test(text)) return { tool: "getDatabaseHealth", source: "pg_stat_statements", action: null };
  if (/integracao|whatsapp|meta|gateway|latencia/.test(text)) return { tool: "getIntegrationLatency", source: "observability_metrics", action: null };
  if (/erro|falha/.test(text)) return { tool: "getErrorRate", source: "observability_metrics", action: null };
  if (/capacidade|escala|limite/.test(text)) return { tool: "getCapacitySummary", source: "performance_baselines", action: null };
  if (/lento|endpoint|rota/.test(text)) return { tool: "getSlowEndpoints", source: "observability_trace_spans", action: null };
  return { tool: "getSystemHealth", source: "dependency_health_snapshots", action: null };
}
