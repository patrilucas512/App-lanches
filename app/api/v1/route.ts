import { NextResponse } from "next/server";
export async function GET() {
  return NextResponse.json({
    name: "MasterApp Public API", version: "v1", base_url: "/api/v1", authentication: "Authorization: Bearer ma_live_<client_id>.<secret>",
    idempotency: "Idempotency-Key é obrigatório em POST /orders e POST /reservations.",
    pagination: { parameters: ["limit", "cursor"], maximum_limit: 100, delta_sync: "updated_since" },
    errors: { format: { error: { code: "string", message: "string", details: "optional" }, request_id: "string" }, statuses: [400, 401, 403, 404, 409, 422, 429, 500] },
    scopes: { orders: ["orders:read", "orders:write"], products: ["products:read", "products:write"], customers: ["customers:read"], inventory: ["inventory:read", "inventory:write"], reservations: ["reservations:read", "reservations:write"], finance: ["finance:read"], webhooks: ["webhooks:manage"] },
    endpoints: [
      "GET /orders", "GET /orders/{id}", "POST /orders", "PATCH /orders/{id}/status",
      "GET /products", "GET /products/{id}", "PATCH /products/{id}/availability",
      "GET /customers", "GET /customers/{id}", "GET /inventory", "GET /inventory/{id}",
      "GET /reservations", "POST /reservations", "PATCH /reservations/{id}", "GET /finance/summary",
    ],
    webhook_signature: "X-MasterApp-Signature: t=<unix>,v1=<hmac_sha256(timestamp.payload)>", environments: ["production", "sandbox"],
  });
}

