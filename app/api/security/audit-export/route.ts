import { assertOrganizationAccess, requireSecurityUser, securityAudit, SecurityError } from "@/lib/security/core";

function csv(value: unknown) { return `"${String(value ?? "").replaceAll('"', '""')}"`; }

export async function GET(request: Request) {
  try {
    const { userId, claims } = await requireSecurityUser();
    const organizationId = new URL(request.url).searchParams.get("organization_id") || "";
    const { admin } = await assertOrganizationAccess(userId, organizationId, true);
    const aal = String(claims.aal || "aal1");
    const { data: settings } = await admin.from("organization_security_settings").select("mfa_requirement").eq("organization_id", organizationId).maybeSingle();
    if (settings?.mfa_requirement !== "optional" && aal !== "aal2") throw new SecurityError(403, "Confirme o MFA antes de exportar a auditoria.");
    const { data, error } = await admin.from("security_audit_logs").select("created_at,action,target_type,target_id,actor_user_id,correlation_id").eq("organization_id", organizationId).order("created_at", { ascending: false }).limit(10000);
    if (error) throw error;
    const rows = ["data,acao,alvo_tipo,alvo_id,ator,correlacao", ...(data || []).map(row => [row.created_at, row.action, row.target_type, row.target_id, row.actor_user_id, row.correlation_id].map(csv).join(","))];
    await securityAudit({ admin, userId, organizationId, action: "security.audit_exported", targetType: "audit_log", after: { rows: data?.length || 0 }, request });
    return new Response(rows.join("\r\n"), { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="masterapp-auditoria-${new Date().toISOString().slice(0,10)}.csv"`, "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Exportação indisponível." }, { status: error instanceof SecurityError ? error.status : 400 });
  }
}
