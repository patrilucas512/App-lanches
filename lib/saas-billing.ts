import type { createAdminClient } from "@/lib/supabase/admin";

type AdminClient = ReturnType<typeof createAdminClient>;

export type EffectiveEntitlement = {
  feature: string;
  name?: string;
  enabled: boolean;
  limit: number | null;
  base_limit?: number | null;
  addon_limit?: number;
  hard_limit?: boolean;
  fallback?: string;
  subscription_status?: string;
  plan?: string;
  reason?: string;
};

export class EntitlementService {
  constructor(private readonly admin: AdminClient, private readonly organizationId: string) {}

  async getLimit(feature: string): Promise<EffectiveEntitlement> {
    const { data, error } = await this.admin.rpc("saas_effective_entitlement", {
      requested_organization_id: this.organizationId,
      requested_feature: feature,
    });
    if (error) throw error;
    return data as EffectiveEntitlement;
  }

  async hasFeature(feature: string): Promise<boolean> {
    return (await this.getLimit(feature)).enabled;
  }

  async assertFeature(feature: string, currentUsage?: number) {
    const entitlement = await this.getLimit(feature);
    if (!entitlement.enabled) throw new Error(`O recurso ${entitlement.name || feature} não está incluído no plano atual. Faça upgrade para continuar.`);
    if (currentUsage != null && entitlement.limit != null && currentUsage >= entitlement.limit)
      throw new Error(`O limite de ${entitlement.name || feature} foi atingido. Faça upgrade ou contrate um adicional.`);
    return entitlement;
  }

  async recordUsage(input: { meter: string; quantity: number; idempotencyKey: string; establishmentId?: string | null; providerCostMicros?: number; metadata?: Record<string, unknown> }) {
    const { data, error } = await this.admin.rpc("record_saas_usage", {
      requested_organization_id: this.organizationId,
      requested_establishment_id: input.establishmentId || null,
      requested_meter: input.meter,
      requested_quantity: input.quantity,
      requested_idempotency_key: input.idempotencyKey,
      requested_provider_cost_micros: input.providerCostMicros || 0,
      requested_metadata: input.metadata || {},
    });
    if (error) throw error;
    return data;
  }
}

