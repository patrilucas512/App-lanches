export const ATTENDANT_INTENTS = [
  "greeting", "hours", "contact", "payment_methods", "delivery", "pickup",
  "menu", "categories", "product_search", "availability", "promotions",
  "order_status", "subscriptions", "reservations", "human_handoff", "unknown",
] as const;

export type AttendantIntent = typeof ATTENDANT_INTENTS[number];
export type IntentDecision = { intent: AttendantIntent; query: string; confidence: number; source: "rule" | "ai"; inputTokens?: number; outputTokens?: number; model?: string };
export type ConversationTurn = { role: "user" | "assistant"; content: string };
export type AIContext = {
  attendantName: string; history: ConversationTurn[]; promptVersion?: string;
  style?: string; formality?: number; responseLength?: string; emojiLevel?: string;
  customTone?: string; operatingInstructions?: string; prohibitedBehaviors?: string[];
};
export type AvailableTool = { name: string; description: string };

export interface AIProvider {
  generateResponse(context: AIContext, message: string, tools: AvailableTool[]): Promise<IntentDecision>;
}

export type ToolResult = { ok: boolean; answer: string; toolName: string; shouldHandoff?: boolean };

