export type WhatsAppMessageStatus = "received" | "pending" | "sent" | "delivered" | "read" | "failed";

export type MetaWebhookPayload = {
  object?: string;
  entry?: Array<{ changes?: Array<{ field?: string; value?: {
    metadata?: { phone_number_id?: string; display_phone_number?: string };
    contacts?: Array<{ wa_id?: string; profile?: { name?: string } }>;
    messages?: Array<{ id?: string; from?: string; timestamp?: string; type?: string; text?: { body?: string } }>;
    statuses?: Array<{ id?: string; status?: string; errors?: Array<{ code?: string | number; title?: string; message?: string; error_data?: { details?: string } }> }>;
  } }> }>;
};

export type WhatsAppConnectionSecret = { access_token?: string; app_secret?: string; verify_token?: string };

