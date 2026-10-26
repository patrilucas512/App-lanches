export const copilotActionTypes = [
  "PRODUCT_SET_AVAILABILITY", "CAMPAIGN_PAUSE", "CAMPAIGN_RESUME",
  "STORE_TEMPORARILY_CLOSE", "STORE_REOPEN", "DELIVERY_TOGGLE",
  "UPDATE_DELIVERY_ESTIMATE", "AI_TOGGLE", "WHATSAPP_AUTOMATION_TOGGLE",
  "ASSIGN_CONVERSATION", "CHANGE_CONVERSATION_PRIORITY", "QUEUE_ADJUST_CAPACITY",
] as const;

export type CopilotActionType = typeof copilotActionTypes[number];
export type CopilotRisk = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export type PlannedAction = {
  actionType: CopilotActionType;
  payload: Record<string, unknown>;
  summary: string;
};

export type CopilotActionProposal = {
  id: string;
  action_type: CopilotActionType;
  risk_level: CopilotRisk;
  status: string;
  preview: { title: string; impact: string; affected_count: number; items?: Array<Record<string, unknown>>; already_applied?: boolean };
  confirmation_token?: string | null;
  confirmation_phrase?: string | null;
  expires_at: string;
  required_approvals: number;
  undo_supported: boolean;
};

export type CopilotActionHistory = {
  actions: Array<{ id: string; action_type: CopilotActionType; risk_level: CopilotRisk; status: string; preview: Record<string, unknown>; required_approvals: number; confirmed_at?: string; executed_at?: string; undo_expires_at?: string; created_at: string }>;
  temporary: Array<{ id: string; operation_type: string; restore_at: string; status: string }>;
  metrics: Record<string, number>;
};

