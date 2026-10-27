import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const read=(path)=>readFileSync(new URL(`../${path}`,import.meta.url),"utf8");
const sql=read("supabase/migrations/20261009052202_whatsapp_crm_phase5.sql");
const conversation=read("lib/ai-attendant/order-conversation.ts");
const campaignEdge=read("supabase/functions/process-whatsapp-campaign-batch/index.ts");
const automationEdge=read("supabase/functions/process-whatsapp-relationship-automation/index.ts");
const webhook=read("app/api/whatsapp/webhook/route.ts");
const templateSync=read("app/api/whatsapp/crm/templates/route.ts");
const ui=read("components/crm-manager.tsx");
const checks=[
 ["1. cliente único usa telefone normalizado",()=>assert.match(sql,/normalize_customer_phone[\s\S]*customers_normalized_phone_idx/)],
 ["2. contato vincula customer_id",()=>assert.match(sql,/link_whatsapp_customer[\s\S]*new\.customer_id/)],
 ["3. última compra vem do cliente oficial",()=>assert.match(sql,/c\.last_order_at/)],
 ["4. total gasto vem do cliente oficial",()=>assert.match(sql,/c\.total_spent_cents/)],
 ["5. segmento inativo é dinâmico",()=>assert.match(sql,/inactive_days[\s\S]*make_interval/)],
 ["6. VIP usa regra determinística",()=>assert.match(sql,/vip_min_spent_cents[\s\S]*return 'vip'/)],
 ["7. segmento por produto consulta order_items",()=>assert.match(sql,/filters\?'product_id'[\s\S]*order_items/)],
 ["8. isolamento usa establishment_id e RLS",()=>assert.match(sql,/enable row level security[\s\S]*has_crm_permission/)],
 ["9. campanha materializa somente o segmento",()=>assert.match(sql,/crm_segment_customer_ids\(campaign\.segment_id\)/)],
 ["10. opt-out bloqueia campanhas",()=>{assert.match(conversation,/requested_status:"opted_out"/);assert.match(campaignEdge,/marketing_opt_out/)}],
 ["11. opt-in registra novo consentimento",()=>assert.match(conversation,/requested_status:"opted_in"/)],
 ["12. template rejeitado não envia",()=>assert.match(sql,/status='approved'[\s\S]*Template oficial não está aprovado/)],
 ["13. produto indisponível impede aprovação",()=>assert.match(sql,/Produto indisponível/)],
 ["14. cupom ativo é validado",()=>assert.match(sql,/Cupom inválido[\s\S]*crm_coupon_tokens/)],
 ["15. cupom individual usa token não previsível",()=>assert.match(sql,/token_hash[\s\S]*display_code/)],
 ["16. agendamento guarda timezone e job",()=>assert.match(sql,/timezone text[\s\S]*masterapp-crm-campaigns/)],
 ["17. cancelamento pula pendentes",()=>assert.match(sql,/status='cancelled'[\s\S]*status='skipped'/)],
 ["18. destinatário é deduplicado",()=>assert.match(sql,/unique\(campaign_id,customer_id\)/)],
 ["19. fila processa lote limitado",()=>assert.match(campaignEdge,/limit\(25\)/)],
 ["20. retry é limitado a três",()=>{assert.match(campaignEdge,/attempts>=3|lt\("attempts",3\)/);assert.match(automationEdge,/attempts between 0 and 3|lt\("attempts",3\)/)}],
 ["21. pesquisa de satisfação aceita 1 a 5",()=>assert.match(conversation,/\^\[1-5\]\$/)],
 ["22. feedback negativo chama humano",()=>assert.match(conversation,/needsHuman=rating<=3[\s\S]*human_controlled:true/)],
 ["23. pedido é atribuído uma vez",()=>assert.match(sql,/crm_campaign_attributions[\s\S]*unique\(order_id\)/)],
 ["24. receita atribuída usa valor real",()=>assert.match(sql,/attributed_revenue_cents=attributed_revenue_cents\+new\.total_cents/)],
 ["25. fidelidade é idempotente e consultável",()=>{assert.match(sql,/idempotency_key[\s\S]*get_loyalty_balance/);assert.match(conversation,/getLoyaltyBalance/)}],
 ["26. permissões são granulares",()=>assert.match(sql,/can_view[\s\S]*can_edit_customer[\s\S]*can_approve_campaign[\s\S]*can_configure_loyalty/)],
 ["status Meta atualizam entrega e leitura",()=>{assert.match(webhook,/crm_campaign_recipients/);assert.match(webhook,/delivered_at/);assert.match(webhook,/read_at/)}],
 ["IA não autoenvia e UI exige aprovação",()=>{assert.match(ui,/Criar rascunho/);assert.match(ui,/Revisar e aprovar/)}],
 ["aprovação de template é sincronizada da Meta",()=>{assert.match(templateSync,/message_templates\?fields=/);assert.match(templateSync,/item\.status\.toLowerCase/);assert.match(ui,/Sincronizar Meta/)}],
];
for(const [name,run] of checks)test(name,run);
