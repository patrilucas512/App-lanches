export const API_SCOPES = [
  "orders:read", "orders:write", "customers:read", "products:read", "products:write",
  "inventory:read", "inventory:write", "reservations:read", "reservations:write",
  "finance:read", "webhooks:manage",
] as const;
export type ApiScope = typeof API_SCOPES[number];
export type IntegrationEnvironment = "production" | "sandbox";

export type NormalizedOrder = {
  externalId?: string;
  storeId: string;
  customerName: string;
  customerPhone?: string;
  fulfillmentType: "pickup" | "takeaway" | "delivery" | "dine_in";
  items: Array<{ product_id: string; quantity: number; addons?: unknown[]; removed_ingredients?: unknown[]; notes?: string }>;
  notes?: string;
  paymentMethod?: string;
  deliveryAddress?: Record<string, unknown>;
};

export interface MarketplaceConnector {
  fetchOrders(updatedSince?: string): Promise<NormalizedOrder[]>;
  pushOrderStatus(externalOrderId: string, status: string): Promise<void>;
  syncProducts(): Promise<{ processed: number; errors: number }>;
  syncAvailability(productIds?: string[]): Promise<{ processed: number; errors: number }>;
}

export interface AccountingConnector {
  exportSales(range: { from: string; to: string }): Promise<unknown>;
  exportPurchases(range: { from: string; to: string }): Promise<unknown>;
  exportDocuments(range: { from: string; to: string }): Promise<unknown>;
  exportPayments(range: { from: string; to: string }): Promise<unknown>;
}

export interface LogisticsConnector {
  dispatch(input: { orderId: string; address: Record<string, unknown>; readyAt?: string }): Promise<{ externalDeliveryId: string }>;
  readStatus(externalDeliveryId: string): Promise<string>;
}

export type ConnectorExecutionContext = {
  integrationId: string; organizationId: string; storeId?: string; environment: IntegrationEnvironment;
  correlationId: string; timeoutMs: number; origin: "masterapp" | "external";
};

