export type ChannelType = "whatsapp" | "voice" | "web_chat";
export type NormalizedDirection = "inbound" | "outbound" | "system";
export type NormalizedStatus = "received" | "pending" | "sent" | "delivered" | "read" | "failed";
export type NormalizedContentType = "text" | "image" | "document" | "audio" | "video" | "location" | "call" | "event" | "card" | "buttons";

export type NormalizedMessage = {
  id?: string;
  channel: ChannelType;
  channelMessageId: string;
  organizationId: string;
  establishmentId: string;
  customerId?: string | null;
  conversationId: string;
  channelThreadId: string;
  channelId: string;
  direction: NormalizedDirection;
  type: NormalizedContentType;
  text?: string | null;
  media?: Array<Record<string, unknown>>;
  status: NormalizedStatus;
  timestamp: string;
  metadata?: Record<string, unknown>;
};

export type AdapterStatus = { available: boolean; detail?: string };
export type ChannelSendInput = { conversationId: string; text: string; clientRequestId: string; actorUserId?: string };
export type ChannelSendResult = { messageId: string; status: NormalizedStatus };

export interface ChannelAdapter<Inbound = unknown, Outbound = ChannelSendInput> {
  readonly channel: ChannelType;
  receive(payload: Inbound): Promise<NormalizedMessage[]>;
  send(payload: Outbound): Promise<ChannelSendResult>;
  markRead(conversationId: string): Promise<void>;
  getStatus(): Promise<AdapterStatus>;
  normalizeInbound(payload: Inbound): Promise<NormalizedMessage[]>;
  normalizeOutbound(payload: Outbound): Promise<NormalizedMessage>;
}

