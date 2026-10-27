import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { answerManagerQuestion } from "@/lib/intelligence/copilot-tools";
import { planManagerAction, prohibitedOperationalIntent } from "@/lib/intelligence/action-planner";
import { resolveManagerPeriod } from "@/lib/intelligence/periods";
import type { ManagerPeriodKey, ManagerSnapshot } from "@/lib/intelligence/types";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const allowedPeriods = new Set<ManagerPeriodKey>(["today", "yesterday", "7d", "30d", "month", "previous_month", "custom"]);

export async function POST(request: Request) {
  const started = Date.now();
  try {
    const body = await request.json() as Record<string, unknown>;
    const establishmentId = String(body.establishment_id || "");
    if (!uuid.test(establishmentId)) return NextResponse.json({ error: "Estabelecimento inválido." }, { status: 400 });
    const supabase = await createClient();
    const { data: claims } = await (supabase.auth as any).getClaims();
    if (!claims?.claims?.sub) return NextResponse.json({ error: "Sessão expirada." }, { status: 401 });

    if (body.action === "feedback") {
      const queryAuditId = String(body.query_audit_id || "");
      if (!uuid.test(queryAuditId)) return NextResponse.json({ error: "Consulta inválida." }, { status: 400 });
      const { error } = await supabase.rpc("save_manager_copilot_feedback", { requested_establishment_id: establishmentId, requested_query_audit_id: queryAuditId, requested_useful: Boolean(body.useful), requested_comment: String(body.comment || "").slice(0, 1000) || null });
      if (error) return NextResponse.json({ error: error.message }, { status: 403 });
      return NextResponse.json({ ok: true });
    }

    if (body.action === "settings") {
      const { data, error } = await supabase.rpc("configure_manager_copilot_alerts", { requested_establishment_id: establishmentId, requested_settings: body.settings || {} });
      if (error) return NextResponse.json({ error: error.message }, { status: 403 });
      return NextResponse.json({ settings: data });
    }

    const question = String(body.question || "").trim().slice(0, 1000);
    if (!question) return NextResponse.json({ error: "Digite uma pergunta." }, { status: 400 });
    const { data: establishment } = await supabase.from("establishments").select("timezone").eq("id", establishmentId).maybeSingle();
    if (!establishment) return NextResponse.json({ error: "Sem acesso a este estabelecimento." }, { status: 403 });
    const requestedKey = String(body.period || "today") as ManagerPeriodKey;
    const period = resolveManagerPeriod(allowedPeriods.has(requestedKey) ? requestedKey : "today", establishment.timezone || "America/Sao_Paulo", new Date(), String(body.custom_start || "") || undefined, String(body.custom_end || "") || undefined);
    const { data, error } = await supabase.rpc("get_manager_copilot_snapshot", {
      requested_establishment_id: establishmentId, requested_start: period.start, requested_end: period.end,
      requested_compare_start: period.compareStart, requested_compare_end: period.compareEnd, requested_all_units: Boolean(body.all_units),
    });
    if (error) return NextResponse.json({ error: error.message }, { status: 403 });
    const snapshot = data as ManagerSnapshot;
    if (/estoque|insumo|custo|cmv|margem|comprar|compra|fornecedor|desperd|perda/i.test(question)) {
      const [inventoryResult,costResult]=await Promise.all([supabase.rpc("inventory_phase16_summary",{requested_establishment_id:establishmentId,requested_days:30}),supabase.rpc("inventory_product_costs",{requested_establishment_id:establishmentId})]);
      if(!inventoryResult.error) snapshot.inventory={...snapshot.inventory,...(inventoryResult.data as Record<string,unknown>),critical_count:Number((inventoryResult.data as Record<string,unknown>)?.low_stock||snapshot.inventory.critical_count)} as ManagerSnapshot["inventory"];
      if(!costResult.error) snapshot.inventory.product_costs=(costResult.data||[]) as Array<Record<string,string|number|null>>;
    }
    if (/financeir|conta.*pagar|conta.*receber|fluxo.*caixa|dre|concilia|taxa.*cart|quanto sobrou|orçamento|caixa fech/i.test(question)) {
      const {data:financial,error:financialError}=await supabase.rpc("financial_phase17_summary",{requested_establishment_id:establishmentId,requested_start:period.start.slice(0,10),requested_end:period.end.slice(0,10),requested_all_units:Boolean(body.all_units)});
      if(!financialError)snapshot.financial=financial as ManagerSnapshot["financial"];
    }
    if (/funcionário|funcionario|equipe|escala|turno|ponto|pausa|hora extra|mão de obra|mao de obra|ausência|ausencia|falta|cobertura/i.test(question)) {
      const {data:workforce,error:workforceError}=await supabase.rpc("workforce_phase18_summary",{requested_establishment_id:establishmentId,requested_start:period.start.slice(0,10),requested_end:period.end.slice(0,10),requested_all_units:Boolean(body.all_units)});
      if(!workforceError)snapshot.workforce=workforce as ManagerSnapshot["workforce"];
    }
    if (/previs|amanhã|amanha|próxim|proxim|pico.*futur|vai vender|motoboy.*dispon|reforçar equipe|reforcar equipe|risco.*faltar/i.test(question)) {
      const {data:prediction}=await supabase.from("forecast_predictions").select("predicted_value,lower_bound,upper_bound,confidence_level,forecast_for,context,forecast_models(model_type,health)").eq("organization_id",snapshot.scope.organization_id).in("store_id",snapshot.scope.store_ids).eq("forecast_type","orders").gte("forecast_for",new Date().toISOString()).order("forecast_for").limit(1).maybeSingle();
      if(prediction)snapshot.forecasting={predicted_value:Number(prediction.predicted_value),lower_bound:Number(prediction.lower_bound),upper_bound:Number(prediction.upper_bound),confidence_level:String(prediction.confidence_level),forecast_for:String(prediction.forecast_for),model_type:String((prediction.forecast_models as any)?.model_type||"seasonal_naive"),health:String((prediction.forecast_models as any)?.health||"insufficient_data"),factors:Array.isArray((prediction.context as any)?.factors)?(prediction.context as any).factors:[]};
    }
    if (/margem|rentabil|preço.*revis|preco.*revis|menu engineering|engenharia.*cardápio|engenharia.*cardapio|combo.*sentido|marketplace.*compens|d[aá] retorno/i.test(question)) {
      const {data:costs,error:costError}=await supabase.rpc("inventory_product_costs",{requested_establishment_id:establishmentId});
      if(!costError){const products=(costs||[]) as Array<Record<string,string|number|null>>;snapshot.profitability={products,cost_quality:products.length&&products.every(p=>Number(p.cost_cents||0)>0)?"complete":products.length?"partial":"insufficient_data"};}
    }
    if (/fiscal|nota|documento.*(emitido|recebido)|xml|contabil|contábil|rejei[cç][aã]o|provedor fiscal/i.test(question)) {
      const {data:fiscal,error:fiscalError}=await supabase.rpc("fiscal_phase19_summary",{requested_establishment_id:establishmentId,requested_start:period.start.slice(0,10),requested_end:period.end.slice(0,10)});
      if(!fiscalError)snapshot.fiscal=fiscal as ManagerSnapshot["fiscal"];
    }
    const plan = planManagerAction(question);
    let answer = answerManagerQuestion(question, snapshot);
    if (prohibitedOperationalIntent(question)) {
      answer = { intent: "prohibited_action", title: "Ação protegida", answer: "Essa alteração é sensível e continua restrita ao fluxo administrativo oficial.", facts: [], hypotheses: [], recommendations: ["Abra a tela correspondente para revisão humana."], tools: ["GlobalSafetyPolicy"], sources: ["políticas globais do MasterApp"], action: { label: "Voltar ao painel", href: "/painel" }, fallback: false, prohibitedAction: true };
    } else if (plan) {
      const { data: proposal, error: proposalError } = await supabase.rpc("preview_copilot_action", { requested_establishment_id: establishmentId, requested_action_type: plan.actionType, requested_payload: plan.payload });
      if (proposalError) return NextResponse.json({ error: proposalError.message }, { status: 409 });
      answer = { intent: "operational_action", title: "Ação sugerida", answer: plan.summary, facts: [], hypotheses: [], recommendations: ["Revise o impacto abaixo antes de confirmar."], tools: ["ActionPlanner", "ActionEngine.preview"], sources: ["estado operacional atual", "permissões e plano"], fallback: false, actionProposal: proposal };
    }
    const { data: queryAuditId } = await supabase.rpc("record_manager_copilot_query", {
      requested_establishment_id: establishmentId, requested_question: question, requested_intent: answer.intent,
      requested_period: { ...period, all_units: snapshot.scope.all_units }, requested_tools: answer.tools,
      requested_sources: answer.sources, requested_success: true, requested_fallback: answer.fallback,
      requested_latency_ms: Date.now() - started,
    });
    return NextResponse.json({ answer: { ...answer, queryAuditId }, snapshot, period });
  } catch {
    return NextResponse.json({ error: "O Copiloto não conseguiu concluir a análise. As métricas estruturadas continuam disponíveis." }, { status: 500 });
  }
}
