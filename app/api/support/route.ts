import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { SUPPORT_SAFE_ACTIONS } from "@/lib/saas-support";

async function context(organizationId?: string) {
  const supabase = await createClient();
  const { data: claims } = await (supabase.auth as any).getClaims();
  const userId = claims?.claims?.sub;
  if (!userId) throw new Error("Não autenticado.");
  const { data: profile } = await supabase.from("profiles").select("is_superadmin").eq("id", userId).maybeSingle();
  if (profile?.is_superadmin) return { supabase, admin: createAdminClient(), userId, superadmin: true, member: null };
  if (!organizationId) throw new Error("Organização obrigatória.");
  const { data: member } = await supabase.from("organization_members").select("role,active").eq("organization_id", organizationId).eq("user_id", userId).maybeSingle();
  if (!member?.active) throw new Error("Sem acesso à organização.");
  return { supabase, admin: createAdminClient(), userId, superadmin: false, member };
}
async function audit(admin: ReturnType<typeof createAdminClient>, organizationId: string | null, ticketId: string | null, userId: string, eventType: string, metadata: object = {}) {
  await admin.from("saas_support_audit_events").insert({ organization_id: organizationId, ticket_id: ticketId, actor_user_id: userId, event_type: eventType, metadata });
}
export async function POST(request: Request) {
  try {
    const body = await request.json(); const action = String(body.action || ""); const organizationId = body.organization_id ? String(body.organization_id) : undefined;
    const ctx = await context(organizationId);
    if (action === "create_ticket") {
      const technicalContext = { plan: body.plan || null, browser: request.headers.get("user-agent")?.slice(0, 300), app_version: "phase-24", module: body.module || "painel/suporte", feature_flags: body.feature_flags || {}, captured_at: new Date().toISOString() };
      const { data: ticketId, error } = await ctx.supabase.rpc("create_masterapp_support_ticket", { requested_organization_id: organizationId, requested_establishment_id: body.establishment_id || null, requested_subject: String(body.subject || ""), requested_description: String(body.description || ""), requested_category: String(body.category || "other"), requested_priority: String(body.priority || "normal"), requested_context: technicalContext });
      if (error) throw error;
      if (["whatsapp", "integrations", "fiscal", "payments", "technical", "ai"].includes(body.category)) await ctx.supabase.rpc("run_masterapp_support_diagnostic", { requested_organization_id: organizationId, requested_establishment_id: body.establishment_id || null, requested_ticket_id: ticketId });
      return NextResponse.json({ ok: true, ticket_id: ticketId });
    }
    if (action === "message") {
      const { data, error } = await ctx.supabase.rpc("post_masterapp_support_message", { requested_ticket_id: body.ticket_id, requested_message: String(body.message || ""), requested_internal: Boolean(body.internal_note) }); if (error) throw error;
      return NextResponse.json({ ok: true, message_id: data });
    }
    if (action === "diagnostic") {
      const { data: id, error } = await ctx.supabase.rpc("run_masterapp_support_diagnostic", { requested_organization_id: organizationId, requested_establishment_id: body.establishment_id || null, requested_ticket_id: body.ticket_id || null }); if (error) throw error;
      const { data } = await ctx.admin.from("support_diagnostic_snapshots").select("id,overall_status,customer_result,technical_result,created_at").eq("id", id).single();
      return NextResponse.json({ ok: true, diagnostic: ctx.superadmin ? data : { id: data?.id, overall_status: data?.overall_status, customer_result: data?.customer_result, created_at: data?.created_at } });
    }
    if (action === "assistant") {
      const query = String(body.query || "").trim(); if (query.length < 2) throw new Error("Digite sua dúvida.");
      const { data, error } = await ctx.supabase.rpc("search_masterapp_support_articles", { requested_query: query }); if (error) throw error;
      const sources = (data || []).slice(0, 3); const answer = sources.length ? `Encontrei orientações aprovadas: ${sources.map((x: any) => x.title).join("; ")}. ${sources[0].excerpt}` : "Não encontrei uma resposta confiável. Posso abrir um chamado.";
      await audit(ctx.admin, organizationId || null, null, ctx.userId, "help_assistant_used", { query: query.slice(0, 200), article_ids: sources.map((x: any) => x.id), grounded: sources.length > 0 });
      return NextResponse.json({ ok: true, answer, sources });
    }
    if (action === "rate") { const { error } = await ctx.supabase.rpc("rate_masterapp_support_ticket", { requested_ticket_id: body.ticket_id, requested_rating: Number(body.rating), requested_feedback: String(body.feedback || "") || null }); if (error) throw error; return NextResponse.json({ ok: true }); }
    if (action === "reopen") {
      const { data: ticket } = await ctx.admin.from("support_tickets").select("id,organization_id,status,reopen_until").eq("id", body.ticket_id).single();
      if (!ticket || ticket.organization_id !== organizationId || !["resolved", "closed"].includes(ticket.status) || (ticket.reopen_until && new Date(ticket.reopen_until) < new Date())) throw new Error("Este chamado não pode ser reaberto.");
      await ctx.admin.from("support_tickets").update({ status: "waiting_support", resolved_at: null, closed_at: null, updated_at: new Date().toISOString() }).eq("id", ticket.id); await audit(ctx.admin, ticket.organization_id, ticket.id, ctx.userId, "ticket_reopened"); return NextResponse.json({ ok: true });
    }
    if (!ctx.superadmin) throw new Error("Ação restrita à equipe MasterApp.");
    if (action === "update_ticket") {
      const allowedStatus = ["open","waiting_support","waiting_customer","in_progress","resolved","closed"]; const allowedPriority=["low","normal","high","urgent"];
      const patch: Record<string,unknown> = { updated_at: new Date().toISOString() };
      if (allowedStatus.includes(body.status)) patch.status=body.status; if (allowedPriority.includes(body.priority)) patch.priority=body.priority;
      if (body.queue_id) patch.queue_id=body.queue_id; if (body.assigned_to_user_id) patch.assigned_to_user_id=body.assigned_to_user_id;
      if (["n1","n2","engineering","finance","specialist"].includes(body.escalation_level)) patch.escalation_level=body.escalation_level;
      if (body.status === "waiting_customer") patch.sla_paused_at = new Date().toISOString();
      if (body.status === "resolved") { patch.resolved_at=new Date().toISOString(); patch.reopen_until=new Date(Date.now()+7*86400000).toISOString(); }
      if (body.status === "closed") patch.closed_at=new Date().toISOString();
      const { data: ticket, error } = await ctx.admin.from("support_tickets").update(patch).eq("id", body.ticket_id).select("id,organization_id").single(); if(error)throw error;
      await audit(ctx.admin,ticket.organization_id,ticket.id,ctx.userId,"ticket_updated",patch); return NextResponse.json({ok:true});
    }
    if (action === "link_incident") { const { data: ticket }=await ctx.admin.from("support_tickets").select("organization_id").eq("id",body.ticket_id).single(); const {error}=await ctx.admin.from("support_ticket_incidents").upsert({ticket_id:body.ticket_id,incident_id:body.incident_id,linked_by:ctx.userId});if(error)throw error;await audit(ctx.admin,ticket?.organization_id||null,body.ticket_id,ctx.userId,"incident_linked",{incident_id:body.incident_id});return NextResponse.json({ok:true}); }
    if (action === "create_incident") { const {data,error}=await ctx.admin.from("support_incidents").insert({title:String(body.title||""),description:String(body.description||""),public_summary:String(body.public_summary||body.description||""),severity:body.severity||"minor",affected_components:Array.isArray(body.affected_components)?body.affected_components:[],is_public:Boolean(body.is_public),created_by:ctx.userId}).select("id").single();if(error)throw error;await audit(ctx.admin,null,null,ctx.userId,"incident_created",{incident_id:data.id});return NextResponse.json({ok:true,id:data.id}); }
    if (action === "save_article") { const slug=String(body.slug||body.title||"").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,""); const payload={title:String(body.title||""),slug,category:String(body.category||"Geral"),content:String(body.content||""),status:body.status||"draft",audience:body.audience||"customer",updated_by:ctx.userId,published_at:body.status==="published"?new Date().toISOString():null};const {error}=await ctx.admin.from("support_articles").upsert(payload,{onConflict:"slug"});if(error)throw error;await audit(ctx.admin,null,null,ctx.userId,"article_saved",{slug});return NextResponse.json({ok:true}); }
    if (action === "safe_action") { if (!(SUPPORT_SAFE_ACTIONS as readonly string[]).includes(body.action_type)) throw new Error("Ação não permitida."); const {data:ticket}=await ctx.admin.from("support_tickets").select("organization_id").eq("id",body.ticket_id).single();if(!ticket)throw new Error("Chamado não encontrado.");const {data,error}=await ctx.admin.from("saas_support_safe_actions").insert({ticket_id:body.ticket_id,organization_id:ticket.organization_id,action_type:body.action_type,status:"preview",preview:{summary:"Prévia criada. Confirmação explícita é obrigatória; nenhum dado sensível será exibido."},requested_by:ctx.userId,expires_at:new Date(Date.now()+15*60000).toISOString()}).select("id,preview,status,expires_at").single();if(error)throw error;await audit(ctx.admin,ticket.organization_id,body.ticket_id,ctx.userId,"safe_action_previewed",{action_id:data.id,action_type:body.action_type});return NextResponse.json({ok:true,action:data}); }
    throw new Error("Ação inválida.");
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Falha na Central de Suporte." }, { status: 400 }); }
}
