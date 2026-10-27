import { NextResponse } from "next/server";
import { assertOrganizationAccess, assertSameOrigin, assertSecurityEntitlement, deviceLabel, enforceOrganizationIpPolicy, recoveryCode, requestIp, requestRegion, requireSecurityUser, secureDigest, securityAudit, SecurityError } from "@/lib/security/core";
import { validateWebhookUrl } from "@/lib/integrations/security";

export const dynamic = "force-dynamic";

function responseError(error: unknown) {
  const status = error instanceof SecurityError ? error.status : 400;
  const message = error instanceof Error ? error.message : "Não foi possível concluir a ação de segurança.";
  return NextResponse.json({ error: message }, { status });
}

function cleanPolicy(body: Record<string, unknown>) {
  const text = (key: string, values: string[]) => values.includes(String(body[key])) ? String(body[key]) : undefined;
  const number = (key: string, min: number, max: number) => Math.max(min, Math.min(max, Number(body[key])));
  const allowlist=String(body.admin_ip_allowlist||"").split(",").map(item=>item.trim()).filter(Boolean);
  if(allowlist.some(item=>!/^[0-9a-f:.]+(?:\/\d{1,3})?$/i.test(item)))throw new SecurityError(400,"A lista de IP contém um valor inválido.");
  return {
    mfa_requirement: text("mfa_requirement", ["optional", "owners", "admins", "all"]),
    mfa_grace_period_days: number("mfa_grace_period_days", 0, 90),
    max_session_hours: number("max_session_hours", 1, 8760),
    inactivity_minutes: number("inactivity_minutes", 5, 43200),
    remember_me_enabled: Boolean(body.remember_me_enabled),
    trusted_device_days: number("trusted_device_days", 1, 90),
    audit_retention_days: number("audit_retention_days", 30, 3650),
    login_alerts_enabled: Boolean(body.login_alerts_enabled),
    maintenance_mode: Boolean(body.maintenance_mode),
    read_only_mode: Boolean(body.read_only_mode),
    maintenance_message: String(body.maintenance_message || "Estamos realizando manutenção.").slice(0, 240),
    rpo_target_minutes: body.rpo_target_minutes ? number("rpo_target_minutes", 1, 525600) : null,
    rto_target_minutes: body.rto_target_minutes ? number("rto_target_minutes", 1, 525600) : null,
    backup_retention_days: number("backup_retention_days", 1, 3650),
    admin_ip_allowlist: allowlist,
  };
}

export async function GET(request: Request) {
  try {
    const { userId, supabase } = await requireSecurityUser();
    const organizationId = new URL(request.url).searchParams.get("organization_id") || "";
    await assertOrganizationAccess(userId, organizationId, false);
    const [{ data: summary }, { data: factors }, settings, sessions, sso, events, audits, backups, restores, incidents] = await Promise.all([
      supabase.rpc("get_security_summary", { requested_organization_id: organizationId }),
      supabase.auth.mfa.listFactors(),
      supabase.from("organization_security_settings").select("*").eq("organization_id", organizationId).maybeSingle(),
      supabase.from("security_sessions").select("id,device_label,browser_label,ip_region,last_seen_at,is_current,expires_at,revoked_at,created_at").eq("organization_id", organizationId).order("last_seen_at", { ascending: false }).limit(25),
      supabase.from("sso_connections").select("id,provider_type,display_name,issuer,client_id,metadata_url,certificate_fingerprint,domain,status,jit_provisioning,default_role,enforce_sso,last_tested_at,last_error,updated_at").eq("organization_id", organizationId).order("updated_at", { ascending: false }),
      supabase.from("security_events").select("id,event_type,severity,title,description,status,detected_at,resolved_at").eq("organization_id", organizationId).order("detected_at", { ascending: false }).limit(30),
      supabase.from("security_audit_logs").select("id,action,target_type,target_id,created_at,correlation_id").eq("organization_id", organizationId).order("created_at", { ascending: false }).limit(30),
      supabase.from("backup_runs").select("id,backup_type,provider,started_at,completed_at,status,size_bytes,encrypted,retention_until,error_summary").eq("organization_id", organizationId).order("started_at", { ascending: false }).limit(20),
      supabase.from("restore_test_runs").select("id,backup_run_id,test_environment,started_at,completed_at,status,duration_seconds,inconsistencies,validation_summary").eq("organization_id", organizationId).order("started_at", { ascending: false }).limit(20),
      supabase.from("security_incidents").select("id,title,severity,status,detected_at,affected_components,impact,containment,resolution,resolved_at,updated_at").eq("organization_id", organizationId).order("detected_at", { ascending: false }).limit(20),
    ]);
    return NextResponse.json({ summary, factors, settings: settings.data, sessions: sessions.data || [], sso: sso.data || [], events: events.data || [], audits: audits.data || [], backups: backups.data || [], restores: restores.data || [], incidents: incidents.data || [] });
  } catch (error) { return responseError(error); }
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const body = await request.json() as Record<string, unknown>;
    const action = String(body.action || "");
    const organizationId = String(body.organization_id || "");
    const { userId, claims } = await requireSecurityUser();
    const { admin, isSuperadmin, member } = await assertOrganizationAccess(userId, organizationId, action !== "session_ping" && action !== "mfa_state" && action !== "recovery_generate" && action !== "recovery_use" && action !== "revoke_session");
    const organizationAdmin=isSuperadmin||Boolean(member?.active&&["owner","admin"].includes(member.role));
    if(organizationAdmin&&!isSuperadmin&&!["session_ping","mfa_state","recovery_generate","recovery_use"].includes(action))await enforceOrganizationIpPolicy(admin,organizationId,userId,request);

    if (action === "session_ping") {
      const rawDevice = String(body.device_id || "").slice(0, 200);
      if (rawDevice.length < 16) throw new SecurityError(400, "Identificador do dispositivo inválido.");
      const userAgent = request.headers.get("user-agent") || "";
      const labels = deviceLabel(userAgent);
      const deviceHash = secureDigest(`device:${userId}:${rawDevice}`);
      await admin.from("security_sessions").update({ is_current: false }).eq("user_id", userId);
      const { data: session, error } = await admin.from("security_sessions").upsert({
        organization_id: organizationId, user_id: userId, auth_session_id: claims.session_id || null,
        device_id_hash: deviceHash, device_label: labels.device, browser_label: labels.browser,
        ip_hash: secureDigest(`security-ip:${requestIp(request)}`), ip_region: requestRegion(request),
        user_agent: userAgent.slice(0, 500), is_current: true, last_seen_at: new Date().toISOString(), revoked_at: null,
      }, { onConflict: "user_id,device_id_hash" }).select("id").single();
      if (error) throw error;
      return NextResponse.json({ ok: true, session_id: session.id });
    }

    if (action === "mfa_state") {
      const enabled = Boolean(body.enabled);
      await admin.from("user_security_profiles").upsert({ user_id: userId, mfa_enabled: enabled, mfa_enabled_at: enabled ? new Date().toISOString() : null, updated_at: new Date().toISOString() });
      await securityAudit({ admin, userId, organizationId, action: enabled ? "security.mfa_enabled" : "security.mfa_disabled", targetType: "user", targetId: userId, request });
      if (!enabled) await admin.from("security_events").insert({ organization_id: organizationId, user_id: userId, event_type: "mfa_disabled", severity: "warning", title: "MFA desativado", description: "Um usuário desativou a autenticação em duas etapas." });
      return NextResponse.json({ ok: true });
    }

    if (action === "recovery_generate") {
      const codes = Array.from({ length: 10 }, recoveryCode);
      await admin.from("mfa_recovery_codes").delete().eq("user_id", userId);
      const { error } = await admin.from("mfa_recovery_codes").insert(codes.map(code => ({ user_id: userId, code_hash: secureDigest(`recovery:${userId}:${code}`) })));
      if (error) throw error;
      await admin.from("user_security_profiles").upsert({ user_id: userId, recovery_codes_generated_at: new Date().toISOString(), updated_at: new Date().toISOString() });
      await securityAudit({ admin, userId, organizationId, action: "security.recovery_codes_regenerated", targetType: "user", targetId: userId, request });
      return NextResponse.json({ codes, shown_once: true });
    }

    if (action === "recovery_use") {
      const digest = secureDigest(`recovery:${userId}:${String(body.code || "").trim().toUpperCase()}`);
      const { data: code } = await admin.from("mfa_recovery_codes").select("id").eq("user_id", userId).eq("code_hash", digest).is("used_at", null).maybeSingle();
      if (!code) throw new SecurityError(403, "Código de recuperação inválido ou já utilizado.");
      await admin.from("mfa_recovery_codes").update({ used_at: new Date().toISOString() }).eq("id", code.id).is("used_at", null);
      const { data: listed } = await admin.auth.admin.mfa.listFactors({ userId });
      for (const factor of listed?.factors || []) await admin.auth.admin.mfa.deleteFactor({ userId, id: factor.id });
      await admin.from("user_security_profiles").upsert({ user_id: userId, mfa_enabled: false, updated_at: new Date().toISOString() });
      await securityAudit({ admin, userId, organizationId, action: "security.mfa_recovered", targetType: "user", targetId: userId, request });
      return NextResponse.json({ ok: true, require_new_mfa: true });
    }

    if (action === "revoke_session") {
      const sessionId = String(body.session_id || "");
      const { data: session } = await admin.from("security_sessions").select("id,user_id,is_current").eq("id", sessionId).maybeSingle();
      if (!session || session.user_id !== userId && !organizationAdmin) throw new SecurityError(403, "Sessão não encontrada ou não autorizada.");
      await admin.from("security_sessions").update({ revoked_at: new Date().toISOString(), revoke_reason: "user_request", is_current: false }).eq("id", sessionId);
      await securityAudit({ admin, userId, organizationId, action: "security.session_revoked", targetType: "session", targetId: sessionId, request });
      return NextResponse.json({ ok: true, current: session.is_current });
    }

    if (action === "logout_others") {
      await admin.from("security_sessions").update({ revoked_at: new Date().toISOString(), revoke_reason: "logout_others", is_current: false }).eq("user_id", userId).eq("is_current", false).is("revoked_at", null);
      await securityAudit({ admin, userId, organizationId, action: "security.sessions_revoked_others", targetType: "user", targetId: userId, request });
      return NextResponse.json({ ok: true });
    }

    if (action === "save_policy") {
      await assertSecurityEntitlement(admin, organizationId, "enterprise_session_policy_enabled");
      if(String(body.admin_ip_allowlist||"").trim())await assertSecurityEntitlement(admin,organizationId,"ip_allowlist_enabled");
      const { data: before } = await admin.from("organization_security_settings").select("*").eq("organization_id", organizationId).maybeSingle();
      const policy = cleanPolicy(body);
      const { error } = await admin.from("organization_security_settings").upsert({ organization_id: organizationId, ...policy, updated_by: userId, updated_at: new Date().toISOString() });
      if (error) throw error;
      await securityAudit({ admin, userId, organizationId, action: "security.policy_updated", targetType: "organization", targetId: organizationId, before, after: policy, request });
      return NextResponse.json({ ok: true });
    }

    if (action === "save_sso") {
      await assertSecurityEntitlement(admin, organizationId, "sso_enabled");
      const domain = String(body.domain || "").trim().toLowerCase();
      if (!/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/i.test(domain)) throw new SecurityError(400, "Domínio corporativo inválido.");
      const metadata = String(body.metadata_url || "").trim();
      if (metadata) validateWebhookUrl(metadata);
      const enforce = Boolean(body.enforce_sso);
      const { data: settings } = await admin.from("organization_security_settings").select("break_glass_user_id").eq("organization_id", organizationId).maybeSingle();
      if (enforce && !settings?.break_glass_user_id) throw new SecurityError(400, "Defina uma conta de emergência antes de exigir SSO.");
      const record = { organization_id: organizationId, provider_type: body.provider_type === "oidc" ? "oidc" : "saml", display_name: String(body.display_name || "SSO corporativo").slice(0, 120), issuer: String(body.issuer || "").slice(0, 500) || null, client_id: String(body.client_id || "").slice(0, 300) || null, metadata_url: metadata || null, domain, status: String(body.status || "draft"), jit_provisioning: Boolean(body.jit_provisioning), default_role: ["viewer", "attendant", "supervisor", "manager", "admin"].includes(String(body.default_role)) ? String(body.default_role) : "viewer", enforce_sso: enforce, created_by: userId, updated_at: new Date().toISOString() };
      const { error } = await admin.from("sso_connections").upsert(record, { onConflict: "organization_id,domain" });
      if (error) throw error;
      await securityAudit({ admin, userId, organizationId, action: "security.sso_updated", targetType: "sso_connection", targetId: domain, after: { ...record, client_id: record.client_id ? "configured" : null }, request });
      return NextResponse.json({ ok: true });
    }

    if (action === "ack_event") {
      await admin.from("security_events").update({ status: "acknowledged", acknowledged_at: new Date().toISOString() }).eq("id", String(body.event_id)).eq("organization_id", organizationId);
      await securityAudit({ admin, userId, organizationId, action: "security.event_acknowledged", targetType: "security_event", targetId: String(body.event_id), request });
      return NextResponse.json({ ok: true });
    }

    if (action === "create_incident") {
      const { data, error } = await admin.from("security_incidents").insert({ organization_id: organizationId, title: String(body.title || "Incidente de segurança").slice(0, 180), severity: ["info", "warning", "high", "critical"].includes(String(body.severity)) ? body.severity : "warning", status: "investigating", affected_components: Array.isArray(body.affected_components) ? body.affected_components.slice(0, 20) : [], impact: String(body.impact || "").slice(0, 4000), owner_user_id: userId }).select("id").single();
      if (error) throw error;
      await securityAudit({ admin, userId, organizationId, action: "security.incident_created", targetType: "security_incident", targetId: data.id, request });
      return NextResponse.json({ ok: true, id: data.id });
    }

    if (action === "record_backup" || action === "record_restore_test") {
      if (!isSuperadmin) throw new SecurityError(403, "Somente o Super Administrador registra operações de continuidade.");
      if (action === "record_backup") {
        const { data, error } = await admin.from("backup_runs").insert({ organization_id: organizationId || null, backup_type: String(body.backup_type || "database"), provider: String(body.provider || "supabase"), started_at: String(body.started_at || new Date().toISOString()), completed_at: body.completed_at || null, status: String(body.status || "succeeded"), size_bytes: body.size_bytes || null, location_reference: String(body.location_reference || "").slice(0, 300) || null, checksum: String(body.checksum || "").slice(0, 200) || null, encrypted: body.encrypted !== false, retention_until: body.retention_until || null, error_summary: String(body.error_summary || "").slice(0, 1000) || null }).select("id").single();
        if (error) throw error;
        await securityAudit({ admin, userId, organizationId, action: "security.backup_recorded", targetType: "backup_run", targetId: data.id, request });
      } else {
        const { data, error } = await admin.from("restore_test_runs").insert({ organization_id: organizationId || null, backup_run_id: body.backup_run_id || null, test_environment: String(body.test_environment || "isolated-test"), started_at: String(body.started_at || new Date().toISOString()), completed_at: body.completed_at || new Date().toISOString(), status: String(body.status || "passed"), duration_seconds: Number(body.duration_seconds || 0), inconsistencies: Array.isArray(body.inconsistencies) ? body.inconsistencies : [], validation_summary: String(body.validation_summary || "").slice(0, 2000), executed_by: userId }).select("id").single();
        if (error) throw error;
        await securityAudit({ admin, userId, organizationId, action: "security.restore_test_recorded", targetType: "restore_test", targetId: data.id, request });
      }
      return NextResponse.json({ ok: true });
    }

    throw new SecurityError(400, "Ação de segurança desconhecida.");
  } catch (error) { return responseError(error); }
}
