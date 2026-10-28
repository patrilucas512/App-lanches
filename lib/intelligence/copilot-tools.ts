import type { CopilotAnswer, ManagerSnapshot } from "./types";
import { KNOWLEDGE_COPILOT_TOOLS } from "@/lib/knowledge_base/core";
import { MARKETPLACE_COPILOT_TOOLS } from "@/lib/marketplace-integrations/core";
import { CENTRAL_PRODUCTION_COPILOT_TOOLS } from "@/lib/central-production/core";
import { SUPPLY_CHAIN_COPILOT_TOOLS } from "@/lib/supply-chain-planning/core";
import { WMS_COPILOT_TOOLS } from "@/lib/warehouse-management/core";
import { TRANSPORT_COPILOT_TOOLS } from "@/lib/transport-management/core";
import { IBP_COPILOT_TOOLS } from "@/lib/integrated-business-planning/core";
import { DIGITAL_TWIN_COPILOT_TOOLS } from "@/lib/digital_twin/core";
import { REVENUE_MANAGEMENT_COPILOT_TOOLS } from "@/lib/revenue-management/core";
import { MDM_COPILOT_TOOLS } from "@/lib/master-data/core";
import { DATA_GOVERNANCE_COPILOT_TOOLS } from "@/lib/data-governance/core";
import { NOC_COPILOT_TOOLS } from "@/lib/network-operations/core";

const money = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const integer = new Intl.NumberFormat("pt-BR");
const brl = (cents: unknown) => money.format(Number(cents || 0) / 100);
const pct = (value: unknown) => `${Number(value || 0).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;
const n = (value: unknown) => integer.format(Number(value || 0));
const normalize = (text: string) => text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

export const managerCopilotTools = [
  "getSalesSummary", "getOrdersSummary", "comparePeriods", "getTopProducts", "getLowPerformingProducts",
  "getStorePerformance", "getTeamPerformance", "getQueuePerformance", "getCampaignPerformance",
  "getCustomerRetentionMetrics", "getDeliveryPerformance", "getPaymentMetrics", "getAIAttributionMetrics", "getOperationalAlerts",
  "getInventorySummary", "getLowStockItems", "getProductCost", "getProductMargin", "getPurchaseSuggestions", "getSupplierPrices", "getInventoryCoverage", "getWasteSummary",
  "getCashFlow", "getAccountsPayable", "getAccountsReceivable", "getManagementPnl", "getGatewayFees", "getReconciliationIssues", "getStoreFinancialPerformance", "getCashRegisterDifferences", "getExpenseBreakdown",
  "getCurrentStaffing", "getShiftCoverage", "getAttendanceSummary", "getOvertimeEstimate", "getLaborCost", "getTeamProductivity", "getOperationalBottlenecks", "getAbsenceSummary",
  "getFiscalDocumentStatus", "getFiscalErrors", "getIssuedDocumentsSummary", "getPurchaseDocumentSummary", "getFiscalIntegrationStatus",
  "getSecuritySummary", "getMfaCoverage", "getActiveSessions", "getBackupStatus", "getRecentSecurityEvents", "getSSOStatus",
  "getSystemHealth", "getSlowEndpoints", "getQueueHealth", "getDatabaseHealth", "getIntegrationLatency", "getErrorRate", "getCapacitySummary",
  "getDemandForecast", "getPeakHoursForecast", "getProductDemandForecast", "getInventoryRiskForecast", "getStaffingForecast", "getDeliveryLoadForecast", "getForecastAccuracy",
  "getProductProfitability", "getMenuEngineeringMatrix", "getMarginCompression", "getPriceReviewCandidates", "getBundleOpportunities", "getAddonPerformance", "getChannelProfitability", "simulatePriceChange",
  "searchCatalogProducts", "getProductDetails", "getCatalogHealth", "getPendingCatalogChanges", "getPriceHistory", "getProductAvailability", "getCatalogDistributionStatus",
  "getCurrentCapacity", "getCapacityByResource", "getFutureCapacity", "getAvailableOrderSlots", "getOrdersAtRisk", "getQueueHealth", "getCapacityOverrides", "simulateCapacityScenario",
  "getFranchiseAssessments", "getRoyaltyBreakdown", "getFranchiseSettlements", "getOutstandingFranchiseFees", "getMarketingFundStatement", "getFranchiseDisputes", "getFranchiseCloseStatus", "getProjectedRoyaltyRevenue",
  "getExpansionPipeline", "getOpeningProject", "getOpeningReadiness", "getOpeningBlockers", "getUpcomingGoLives", "getOpeningBudgetStatus", "getRampUpPerformance",
  "getUpcomingAudits", "getOverdueAudits", "getAuditResults", "getAuditFindings", "getCriticalFindings", "getAuditActionPlans", "getRecurringFindings", "getStoreAuditHistory",
  ...MARKETPLACE_COPILOT_TOOLS,
  ...KNOWLEDGE_COPILOT_TOOLS,
  ...CENTRAL_PRODUCTION_COPILOT_TOOLS,
  ...SUPPLY_CHAIN_COPILOT_TOOLS,
  ...WMS_COPILOT_TOOLS,
  ...TRANSPORT_COPILOT_TOOLS,
  ...IBP_COPILOT_TOOLS,
  ...DIGITAL_TWIN_COPILOT_TOOLS,
  ...REVENUE_MANAGEMENT_COPILOT_TOOLS,
  ...MDM_COPILOT_TOOLS,
  ...DATA_GOVERNANCE_COPILOT_TOOLS,
  ...NOC_COPILOT_TOOLS,
] as const;

function base(intent: string, title: string, answer: string, tools: string[], sources: string[]): CopilotAnswer {
  return { intent, title, answer, facts: [], hypotheses: [], recommendations: [], tools, sources, fallback: false };
}

function periodComparison(snapshot: ManagerSnapshot) {
  const revenueDelta = snapshot.sales.revenue_delta_percent;
  const orderDelta = snapshot.sales.orders_delta_percent;
  return [revenueDelta == null ? "Sem base de faturamento suficiente para comparar." : `Faturamento ${Number(revenueDelta) >= 0 ? "subiu" : "caiu"} ${pct(Math.abs(Number(revenueDelta)))}.`, orderDelta == null ? "Sem base de pedidos suficiente para comparar." : `Pedidos aprovados ${Number(orderDelta) >= 0 ? "subiram" : "caíram"} ${pct(Math.abs(Number(orderDelta)))}.`];
}

export function answerManagerQuestion(question: string, snapshot: ManagerSnapshot): CopilotAnswer {
  const text = normalize(question);
  const sales = snapshot.sales; const support = snapshot.support; const ai = snapshot.ai; const delivery = snapshot.delivery as Record<string, number>;
  if (/central da rede|noc|lojas? com problema|unidades? cr[ií]ticas?|rede offline|problema.*sist[eê]mico|pedidos em risco/.test(text)) {
    const result=base("network_operations","Central da Rede","O NOC consolida sinais atuais dos domínios oficiais, correlaciona escopo e impacto e mantém freshness explícita. Correlação não confirma causa raiz.",[...NOC_COPILOT_TOOLS],["network_operation_signals","store_operational_health","network_correlated_events","network_alerts","operational_incidents"]);
    result.facts=["Incident Management continua sendo a autoridade de incidentes e war room.","Dados stale aparecem como desconhecidos, nunca como saudáveis.","Riscos projetados ficam separados de indisponibilidades atuais."];
    result.hypotheses=["Fator comum só é exibido como possível ou suspeito até confirmação com evidência no incidente."];
    result.recommendations=["Abra a Central da Rede para conferir escopo, impacto, sinais, freshness e ações disponíveis. A IA não executa ações críticas."];
    result.action={label:"Abrir Central da Rede",href:"/painel/operacoes/central-da-rede"};return result;
  }
  if (/governanca de dados|data contract|contrato de dados|linhagem|lineage|schema drift|breaking change|freshness|catalogo de dados/.test(text)) {
    const result=base("data_governance","Governança de Dados","O catálogo empresarial explica ownership, contratos, linhagem, qualidade, freshness e impacto usando somente metadados registrados.",[...DATA_GOVERNANCE_COPILOT_TOOLS],["data_assets","data_contracts","data_contract_versions","data_lineage_edges","data_consumers","data_observability_results","data_schema_changes","data_incidents"]);
    result.facts=["Relações inferidas são sinalizadas e não provam dependência.","Breaking changes usam diff determinístico antes de qualquer resumo de IA.","A IA não publica contrato, aprova exceção nem altera schema."];
    result.hypotheses=["Dependências não registradas permanecem desconhecidas até descoberta ou confirmação humana."];
    result.recommendations=["Revise consumidores e criticidade antes de publicar mudanças incompatíveis.","Confirme ownership e sensibilidade de assets descobertos automaticamente."];
    result.action={label:"Abrir Governança de Dados",href:"/painel/governanca-dados"};return result;
  }
  if (/\bmdm\b|dados mestres|golden record|registro oficial|sku pertence|identificador externo|produto duplicado|fornecedor duplicado|qualidade de dados|linhagem de dados/.test(text)) {
    const result=base("master_data_management","Dados Mestres","O MDM resolve identidade, identificadores, qualidade, duplicidades e linhagem sem substituir os cadastros operacionais oficiais.",[...MDM_COPILOT_TOOLS],["master_entity_registry","master_entity_identifiers","master_source_records","master_match_candidates","master_golden_records","master_data_quality_issues","master_merges"]);
    result.facts=["Catalog/PIM, Customer 360, Compras, Workforce, Ativos e Organização continuam como fontes oficiais.","Matching probabilístico mostra score, regras e conflitos; ele não prova identidade.","Merges preservam histórico e usam alias para o registro canônico."];
    result.hypotheses=["Similaridade de nome ou descrição gera somente candidato para revisão humana."];
    result.recommendations=["Revise identificadores verificados, fontes, conflitos e impacto antes de aprovar qualquer merge.","Use Change Request quando o campo pertence a outro domínio."];
    result.action={label:"Abrir Dados Mestres",href:"/painel/dados-mestres"};return result;
  }
  if (/\bibp\b|s&op|planejamento integrado|consensus forecast|demand review|supply review|plan vs actual/.test(text)) {
    const result=base('integrated_business_planning','Planejamento Integrado','O IBP coordena versões do forecast, metas, orçamento, supply, capacidade e finanças sem substituir os módulos oficiais nem executar o plano automaticamente.',[...IBP_COPILOT_TOOLS],['ibp_planning_cycles','ibp_plan_versions','ibp_input_snapshots','ibp_plan_cube','ibp_supply_gaps','ibp_constraints','ibp_variances']);
    result.facts=['Target, Forecast, Plan, Budget e Actual permanecem conceitos separados.','Toda versão histórica usa snapshots e lineage; dados vivos não substituem planos aprovados.','Cenários são dry runs e sinais de execução continuam dependentes de confirmação e ActionEngine.'];
    result.hypotheses=['Explicações de variação sem decomposição certificada são apresentadas somente como hipótese.'];
    result.recommendations=['Revise premissas, frescor dos dados, gaps críticos e decisões pendentes antes de submeter o plano.'];result.action={label:'Abrir Planejamento IBP',href:'/painel/planejamento/ibp'};return result;
  }
  if (/\btms\b|transporte b2b|carga consolidada|viagem interna|transportadora|comprovante de entrega|\bpod\b/.test(text)) {
    const result=base("transport_management","Central de Transporte","O TMS coordena ordens, cargas, viagens, paradas, comprovantes e custos usando WMS, transferências, Geo, Ativos e Financeiro como fontes oficiais.",[...TRANSPORT_COPILOT_TOOLS],["transport_orders","transport_loads","transport_trips","transport_stops","transport_proof_of_delivery","transport_occurrences","transport_cost_records"]);
    result.facts=["POD confirma a entrega física, mas não recebe estoque.","Rota e ETA são estimativas quando não há provedor confirmado.","Localização só é mostrada quando o provedor confirma posição durante uma viagem ativa."];
    result.recommendations=["Revise capacidade, compatibilidade, documentos, carga e paradas antes de confirmar o despacho.","Trate ocorrências críticas com responsável humano e mantenha a reconciliação financeira separada."];
    result.action={label:"Abrir Transporte TMS",href:"/painel/transporte"};return result;
  }
  if (/wms|armaz[eé]m|endere[cç]amento|putaway|separa[cç][aã]o|picking|onda de separa[cç][aã]o|contagem cega|invent[aá]rio por local/.test(text)) {
    const result=base("warehouse_management","Operação do armazém","O WMS coordena recebimento, endereçamento, separação FEFO, embalagem, staging, expedição e contagens usando o estoque e as transferências oficiais do MasterApp.",[...WMS_COPILOT_TOOLS],["inventory_movements","warehouse_location_inventory","warehouse_tasks","warehouse_fulfillments","inventory_lots"]);
    result.facts=["inventory_movements continua sendo o único livro transacional de estoque.","Saldos por localização são derivados e nunca substituem o saldo oficial.","Lotes bloqueados, em quarentena, vencidos ou em recall não entram em separações normais."];
    result.hypotheses=["Sugestões de putaway e slotting são recomendações explicáveis e dependem das regras configuradas pelo cliente."];
    result.recommendations=["Revise exceções, tarefas vencidas e localização física antes de confirmar qualquer movimento.","Use scanner quando disponível; a digitação manual permanece validada pelo servidor."];
    result.action={label:"Abrir Armazém WMS",href:"/painel/armazem"};return result;
  }
  if (/supply chain|abastecimento.*rede|estoque.*rede|ruptura projetada|redistribui[cç][aã]o|dias de cobertura|safety stock|estoque de seguran[cç]a|lead time.*fornecedor|otif|fill rate/.test(text)) {
    const result=base("supply_chain_planning","Supply Chain da rede","A camada de planejamento combina o estoque oficial, compromissos, compras, transferências, produção e forecast para explicar riscos e sugerir alternativas. Nenhuma compra, transferência ou produção é executada automaticamente.",[...SUPPLY_CHAIN_COPILOT_TOOLS],["inventory_movements","inventory_lots","purchase_orders","inventory_transfers","production_orders","forecast_predictions","supply_recommendations"]);
    result.facts=["Saldo oficial continua sendo calculado por inventory_movements.","Lotes vencidos, bloqueados ou em quarentena nunca são oferecidos como fonte utilizável.","Entradas confirmadas, planejadas e previstas permanecem separadas na projeção."];
    result.hypotheses=["Ruptura, excesso e atraso projetados são cenários explicáveis; não são fatos consumados."];
    result.recommendations=["Revise fonte, custo, lead time, validade, capacidade e entidade legal antes de aprovar uma recomendação.","Use a simulação para comparar alternativas e gere somente rascunhos nos módulos oficiais."];
    result.action={label:"Abrir Supply Chain",href:"/painel/supply-chain"};return result;
  }
  if (/produ[cç][aã]o central|cozinha central|comiss[aá]ria|ordem de produ[cç][aã]o|requisi[cç][aã]o.*loja|lote central|transfer[eê]ncia interna|material.*produzir/.test(text)) {
    const result=base("central_production","Produção e abastecimento da rede","A Produção Central consolida requisições, estoque, capacidade, validade e transferências usando o estoque, as receitas e os lotes oficiais do MasterApp.",[...CENTRAL_PRODUCTION_COPILOT_TOOLS],["production_orders","production_batches","inventory_movements","inventory_lots","internal_requisitions","inventory_transfers"]);
    result.facts=["A movimentação de materiais e produtos acabados sempre passa pelo ledger oficial.","Lotes bloqueados, em quarentena ou vencidos não podem ser separados ou transferidos.","Custos por lote são snapshots gerenciais imutáveis depois da conclusão."];
    result.hypotheses=["Forecast, capacidade e risco de vencimento são sinais para planejamento; não confirmam demanda futura nem autorizam produção."];
    result.recommendations=["Revise materiais, capacidade, validade e destinos antes de liberar uma ordem.","Use a simulação em dry run para avaliar falta, excesso e impacto de uma indisponibilidade."];
    result.action={label:"Abrir Produção Central",href:"/painel/producao-central"};return result;
  }
  if (/marketplace|agregador|canal externo|pedido externo|repasse.*delivery|cat[aá]logo.*canal/.test(text)) {
    const result=base("marketplace_integrations","Canais externos de delivery","A Central de Marketplaces acompanha conexões, pedidos externos, mapeamentos, diferenças de catálogo, repasses e saúde sem criar um segundo sistema de pedidos ou catálogo.",[...MARKETPLACE_COPILOT_TOOLS],["marketplace_connections","marketplace_order_links","marketplace_product_mappings","marketplace_drift_records","marketplace_payouts","marketplace_health_samples"]);
    result.facts=["Pedidos entram pelo Order Service oficial e preservam os identificadores interno e externo.","Credenciais permanecem protegidas no Vault e nunca aparecem em respostas, logs ou analytics.","Falha de um provedor é isolada e não interrompe pedidos próprios do MasterApp."];
    result.recommendations=["Revise itens sem mapeamento e divergências antes de habilitar aceite ou sincronização automática.","Cancelamentos só são concluídos após confirmação do provedor."];
    result.action={label:"Abrir Canais de delivery",href:"/painel/integracoes/marketplaces"};return result;
  }
  if (/procedimento|sop|manual|como fazer|passo a passo|base de conhecimento|playbook/.test(text)) {
    const result=base("knowledge_base","Conhecimento operacional","Consulte a Central de Conhecimento para receber somente a versão publicada e autorizada do procedimento, sempre com fonte, versão e seção.",[...KNOWLEDGE_COPILOT_TOOLS],["knowledge_articles","knowledge_article_versions","knowledge_chunks"]);
    result.facts=["A busca aplica empresa, escopo, função e confidencialidade antes da recuperação.","Quando não há fonte aprovada, a resposta segura é: Não encontrei procedimento aprovado para isso."];
    result.recommendations=["Abra a Central de Conhecimento e confirme a versão vigente antes de executar o procedimento."];
    result.action={label:"Abrir Conhecimento",href:"/painel/conhecimento"};return result;
  }
  if (/auditoria|checklist|finding|n[aã]o conformidade|plano de a[cç][aã]o/.test(text)) {
    const result=base("operational_audit","Auditorias operacionais","A Central de Auditorias acompanha inspeções, evidências protegidas, findings e correções sem criar tarefas ou não conformidades duplicadas.",["getUpcomingAudits","getOverdueAudits","getAuditResults","getAuditFindings","getCriticalFindings","getAuditActionPlans","getRecurringFindings","getStoreAuditHistory"],["audits","audit_findings","audit_action_plans","audit_responses"]);
    result.facts=["Scores seguem a versão publicada do template e preservam o cálculo.","Evidências exigem permissão e usam acesso temporário.","Recorrências são observações de repetição, não diagnóstico de causa."];
    result.recommendations=["Revise findings críticos e planos vencidos na Central de Auditorias.","A IA gera somente rascunhos e não publica, aprova, verifica ou altera scores."];
    result.action={label:"Abrir Auditorias",href:"/painel/auditorias"};return result;
  }
  if (/mapa|territ[oó]rio|geocod|geogr[aá]f|[aá]rea de entrega|cobertura.*loja|loja.*cobertura/.test(text)) {
    const result=base("geo_management","Mapa, territórios e cobertura","A Gestão Geográfica reúne localizações confirmadas, áreas de atendimento, territórios versionados e análises agregadas. Resultados de distância, expansão e sobreposição são identificados como estimativas quando não vêm de rota ou medição validada.",["getStoreLocation","getTerritoryDetails","getDeliveryCoverage","getTerritoryOverlaps","getServiceableStores","getGeoDemandSummary","getExpansionGeoAnalysis","getGeoDataQuality"],["geo_locations","geo_territories","service_areas","delivery_zones","store_catchment_areas","site_candidates"]);
    result.facts=["Taxas e prazos permanecem no domínio oficial de Delivery.","Pontos individuais de clientes não são exibidos; analytics usa agregação e limiar mínimo.","Territórios são versionados e publicados somente com prévia, aprovação e confirmação humana."];
    result.hypotheses=["Sobreposição, distância em linha reta e risco de canibalização são estimativas e não garantias financeiras ou jurídicas."];
    result.recommendations=["Abra Rede · Mapa para revisar a qualidade dos endereços, conflitos e áreas de atendimento.","A IA não publica, atribui ou remove territórios automaticamente."];
    result.action={label:"Abrir Rede · Mapa",href:"/painel/rede/mapa"};return result;
  }
  if (/expans|nova unidade|abertura|go.?live|implanta|ramp.?up|prontid[aã]o/.test(text)) {
    const result=base("store_opening","Expansão e novas unidades","A Central de Novas Unidades organiza cada abertura da oportunidade ao ramp-up, com projeto, responsáveis, dependências, orçamento, testes e prontidão explicável.",["getExpansionPipeline","getOpeningProject","getOpeningReadiness","getOpeningBlockers","getUpcomingGoLives","getOpeningBudgetStatus","getRampUpPerformance"],["expansion_opportunities","store_feasibility_assessments","store_opening_projects","store_opening_milestones","opening_readiness_snapshots","store_opening_blockers","store_go_live_executions","store_ramp_up_reviews"]);
    result.facts=["O score de prontidão mostra pesos, verificações aprovadas e pendências por domínio.","Bloqueios críticos impedem o go-live até serem resolvidos ou receberem override formal, justificado e auditado.","A ativação da loja é transacional, idempotente e preserva pedidos em qualquer rollback."];
    result.hypotheses=["Datas e projeções de ramp-up são estimativas operacionais; não substituem aprovação humana nem compromisso financeiro."];
    result.recommendations=["Confira bloqueios, testes críticos, aprovação formal e orçamento antes de solicitar o go-live.","Use o plano 30/60/90 para comparar o desempenho real sem alterar metas automaticamente."];
    result.action={label:"Abrir Novas Unidades",href:"/painel/novas-unidades"};return result;
  }
  if (/royalt|franqui|fundo de marketing|fechamento da rede|taxas da rede/.test(text)) {
    const result=base("franchise_finance","Financeiro de Franquias","O Financeiro de Franquias apresenta os valores calculados com rastreabilidade contratual e mantém cobrança, conciliação e fundo de marketing separados da assinatura SaaS.",["getFranchiseAssessments","getRoyaltyBreakdown","getFranchiseSettlements","getOutstandingFranchiseFees","getMarketingFundStatement","getFranchiseDisputes","getFranchiseCloseStatus","getProjectedRoyaltyRevenue"],["franchise_financial_profiles","franchise_fee_rules","franchise_fee_assessments","franchise_settlements","financial_entries","marketing_fund_contributions","franchise_financial_ledger"]);
    result.facts=["Base: usa somente componentes elegíveis da política vigente no período.","Regra: aplica a versão efetiva vinculada ao contrato, loja, região, marca ou organização.","Cálculo: preserva base, fórmula segura, arredondamento e hash no snapshot histórico.","Ajustes: créditos, débitos e isenções dependem de motivo, documento e aprovação quando exigida.","Total: é consolidado no settlement e conciliado no Financeiro oficial.","Status: cálculo, revisão, aprovação, cobrança, conciliação e encerramento são etapas distintas."];
    result.hypotheses=["Projeções são estimativas gerenciais e não representam receita reconhecida."];
    result.recommendations=["Abra o módulo para conferir a cláusula e o snapshot do período; o Copiloto não inventa termos contratuais, aprova ajustes, emite documento fiscal nem movimenta dinheiro."];
    result.action={label:"Abrir Financeiro de Franquias",href:"/painel/franquias-financeiro"};return result;
  }
  if (/margem|rentabil|preço.*revis|preco.*revis|menu engineering|engenharia.*cardápio|engenharia.*cardapio|combo.*sentido|marketplace.*compens|d[aá] retorno/.test(text) && snapshot.profitability) {
    const products=snapshot.profitability.products||[],known=products.filter(p=>p.gross_margin_percent!==null),top=[...known].sort((a,b)=>Number(b.gross_margin_percent||0)-Number(a.gross_margin_percent||0))[0],low=[...known].sort((a,b)=>Number(a.gross_margin_percent||0)-Number(b.gross_margin_percent||0))[0];
    const result=base("menu_profitability","Rentabilidade do cardápio",top?`${String(top.product_name)} apresenta a maior margem bruta estimada conhecida: ${pct(top.gross_margin_percent)}.`:"Ainda não há custo confiável suficiente para comparar margens.",["getProductProfitability","getMenuEngineeringMatrix","getMarginCompression","getPriceReviewCandidates","getBundleOpportunities","getAddonPerformance","getChannelProfitability","simulatePriceChange"],["products","inventory_recipes","inventory_items","analytics_fact_order_items","forecast_predictions"]);
    result.facts=[`Qualidade do custo: ${snapshot.profitability.cost_quality}.`,...(top?[`${String(top.product_name)}: preço ${brl(top.sale_price_cents)}, custo ${brl(top.cost_cents)}, margem ${pct(top.gross_margin_percent)}.`]:[]),...(low?[`${String(low.product_name)} tem a menor margem conhecida: ${pct(low.gross_margin_percent)}.`]:[])];
    result.hypotheses=["Produtos sem ficha técnica não entram no ranking preciso de margem."];
    result.recommendations=["Revise os dados e use o simulador antes de confirmar qualquer alteração de preço."];
    result.action={label:"Abrir Engenharia de Cardápio",href:"/painel/engenharia-cardapio"};return result;
  }
  if (/previs|amanha|próxim|proxim|pico.*futur|vai vender|motoboy.*dispon|reforçar equipe|reforcar equipe|risco.*faltar/.test(text) && snapshot.forecasting) {
    const f=snapshot.forecasting;const result=base("demand_forecast","Previsão de demanda",`A previsão é de ${n(f.predicted_value)} pedidos, com faixa provável de ${n(f.lower_bound)} a ${n(f.upper_bound)}. A confiança é ${String(f.confidence_level||"baixa").replace("high","alta").replace("medium","média").replace("low","baixa")}.`,["getDemandForecast","getPeakHoursForecast","getProductDemandForecast","getInventoryRiskForecast","getStaffingForecast","getDeliveryLoadForecast","getForecastAccuracy"],["analytics_fact_orders","forecast_predictions","forecast_models","forecast_backtests"]);
    result.facts=[`Modelo: ${String(f.model_type||"baseline sazonal")}.`,`Saúde: ${String(f.health||"insufficient_data")}.`,...(f.factors||[]).map(x=>`Fator de contexto: ${x}.`)];result.recommendations=["Use a faixa para planejar e revise estoque, equipe e delivery antes de confirmar qualquer ajuste."];result.action={label:"Abrir Previsão",href:"/painel/previsao"};return result;
  }
  if (/performance|latencia|sistema lento|fila acumulada|banco sobrecarregado|servico.*lento|capacidade/.test(text)) {
    const result=base("operations_health","Performance e saúde operacional","O Performance Command Center reúne latência, erros, banco, filas, workers, integrações e capacidade com leitura sanitizada. O Copiloto não altera infraestrutura sozinho.",["getSystemHealth","getSlowEndpoints","getQueueHealth","getDatabaseHealth","getIntegrationLatency","getErrorRate","getCapacitySummary"],["performance_baselines","observability_metrics","observability_trace_spans","operational_jobs","dependency_health_snapshots"]);
    result.recommendations=["Abra a central interna para comparar a release atual com a baseline. Retry de DLQ, cache e modos de degradação exigem confirmação humana."];result.action={label:"Abrir Performance",href:"/superadmin/performance"};return result;
  }
  if (/seguranca|mfa|2fa|sessao|login suspeito|backup|restore|sso/.test(text)) {
    const result=base("security_summary","Segurança e continuidade","A Central de Segurança reúne cobertura MFA, sessões, SSO, alertas, backups e testes de restore com dados verificados e acesso somente leitura para o Copiloto.",["getSecuritySummary","getMfaCoverage","getActiveSessions","getBackupStatus","getRecentSecurityEvents","getSSOStatus"],["user_security_profiles","security_sessions","security_events","backup_runs","restore_test_runs","sso_connections"]);
    result.recommendations=["Abra a Central de Segurança para consultar os indicadores atuais. Alterações críticas exigem ação humana, permissão e confirmação reforçada."];result.action={label:"Abrir Segurança",href:"/painel/seguranca"};return result;
  }
  if (/fiscal|nota|documento.*(emitido|recebido)|xml|contabil|rejeicao|provedor fiscal/.test(text) && snapshot.fiscal) {
    const f=snapshot.fiscal,c=f.cards||{},docs=f.documents||[],profile=f.profile||{};const failed=docs.filter(d=>["error","rejected"].includes(String(d.status)));
    const result=base("fiscal_documents","Documentos fiscais e operacionais","Há "+n(c.authorized)+" documento(s) autorizado(s), "+n(c.received)+" recebido(s) e "+n(c.errors)+" erro(s) no período.",["getFiscalDocumentStatus","getFiscalErrors","getIssuedDocumentsSummary","getPurchaseDocumentSummary","getFiscalIntegrationStatus"],["fiscal_documents","fiscal_document_events","fiscal_jobs","fiscal_profiles","accounting_export_batches"]);
    result.facts=["Provedor: "+String(profile.provider||"não configurado")+".","Ambiente: "+String(profile.environment||"não configurado")+".","Jobs pendentes: "+n(c.pending_jobs)+"."];
    if(failed.length)result.facts.push("Erros recentes: "+failed.slice(0,3).map(d=>String(d.error_message||d.status)).join("; "));
    result.recommendations=["Abra o módulo Fiscal para revisar, pré-visualizar ou reprocessar. A IA não muda NCM, regime, impostos nem cancela documentos."];result.action={label:"Abrir Fiscal",href:"/painel/fiscal"};return result;
  }
  if (/funcionario|equipe|escala|turno|ponto|pausa|hora extra|custo.*equipe|mao de obra|ausencia|falta|cobertura/.test(text) && snapshot.workforce) {
    const w=snapshot.workforce;const c=w.cards||{};const people=w.current_staff||[];const result=base("workforce_management","Equipe, escala e ponto",`Há ${n(c.on_shift)} pessoa(s) em turno agora, ${n(c.late)} atraso(s) e ${n(c.absent)} possível(is) ausência(s).`,["getCurrentStaffing","getShiftCoverage","getAttendanceSummary","getOvertimeEstimate","getLaborCost","getTeamProductivity","getOperationalBottlenecks","getAbsenceSummary","getStaffingForecast","getScheduleCoverage","getOpenShifts","getScheduleWarnings","getLaborPlanVsBudget","getLiveCoverage","getUpcomingPeakPeriods"],["custom_staff_members","work_shifts","time_clock_entries","required_headcount_forecast","open_shifts","live_staffing_coverage","fact_schedule_coverage","fact_labor_plan_variance"]);
    result.facts=[`Funcionários ativos: ${n(c.active_employees)}.`,`Em pausa: ${n(c.on_break)}.`,`Horas extras estimadas: ${Number(c.overtime_minutes||0)/60} h.`,`Custo gerencial estimado: ${brl(c.labor_cost_cents)}.`];
    if(people.length)result.facts.push(`Trabalhando agora: ${people.slice(0,5).map(p=>String(p.name)).join(", ")}.`);
    result.recommendations=["Use estes dados como apoio gerencial. A IA pode comparar cobertura e sugerir opções explicáveis, mas não escala pessoas, publica turnos, altera salários, aplica punições, contrata ou demite."];result.action={label:"Abrir Escalas e Cobertura",href:"/painel/escalas"};return result;
  }
  if (/incidente|war room|sev1|sev2|queda|indisponibilidade|contencao|recuperacao|postmortem|causa raiz/.test(text)) {
    const result=base("incident_management","Incidentes operacionais","A Central de Incidentes separa fatos confirmados, impacto, status, ações em andamento, riscos, hipóteses e desconhecidos. Correlação não comprova causalidade.",["getActiveIncidents","getCriticalIncidents","getIncidentStatus","getIncidentTimeline","getIncidentImpact","getIncidentResponders","getIncidentTasks","getIncidentRecoveryStatus","getRecurringIncidents","getPendingPostmortems"],["operational_incidents","incident_timeline_events","incident_impacts","incident_responders","incident_task_links","incident_recovery_steps","incident_postmortems"]);
    result.facts=["Incidentes de suporte, segurança, manutenção e qualidade permanecem em suas fontes oficiais.","MTTR representa tempo até recuperação operacional, não tempo de reparo."];
    result.hypotheses=["Possíveis fatores contribuintes só podem ser apresentados como hipóteses até revisão humana com evidência."];
    result.recommendations=["Abra a Central de Incidentes para consultar o estado atual. A IA não confirma causa raiz, não executa contenção destrutiva e não resolve ou fecha incidentes críticos."];
    result.action={label:"Abrir Central de Incidentes",href:"/painel/incidentes"};return result;
  }
  if (/problema|alerta|agora|anomalia/.test(text)) {
    const alerts = snapshot.alerts || [];
    const result = base("operational_alerts", alerts.length ? "Há pontos que pedem atenção" : "Operação estável", alerts.length ? `Encontrei ${n(alerts.length)} alerta(s) baseado(s) nas regras e amostras configuradas.` : "Não encontrei alertas operacionais com amostra suficiente neste momento.", ["getOperationalAlerts"], ["support_alerts", "orders", "inventory_items", "whatsapp_connections"]);
    result.facts = alerts.slice(0, 5).map(alert => `${alert.title}: ${alert.message}`); result.action = alerts[0]?.action_href ? { label: alerts[0].action_label || "Abrir detalhes", href: alerts[0].action_href! } : undefined; return result;
  }
  if (/por que|porque|queda|caiu|menos/.test(text)) {
    const result = base("explain_change", "O que mudou no período", `Posso confirmar a variação pelos dados disponíveis: ${periodComparison(snapshot).join(" ")}`, ["comparePeriods", "getOrdersSummary", "getTopProducts", "getOperationalAlerts"], ["orders", "order_items", "manager_daily_metrics", "service_modes"]);
    result.facts = periodComparison(snapshot);
    if (Number(sales.cancelled_percent || 0) >= 15) result.facts.push(`Cancelamentos chegaram a ${pct(sales.cancelled_percent)}.`);
    if (Number(snapshot.inventory.critical_count || 0) > 0) result.facts.push(`${n(snapshot.inventory.critical_count)} item(ns) estão no estoque crítico.`);
    if (snapshot.operational.whatsapp_connected === false) result.facts.push("A conexão do WhatsApp não está verificada.");
    result.hypotheses = ["Esses fatores podem ter contribuído, mas os dados disponíveis não provam causalidade isoladamente."];
    result.recommendations = ["Abra os detalhes do período e verifique os alertas antes de alterar preço, campanha ou operação."]; result.action = { label: "Ver alertas", href: "/painel/inteligencia?tab=alertas" }; return result;
  }
  if (/estoque|insumo|custo|cmv|margem|comprar|compra|fornecedor|desperd|perda/.test(text)) {
    const inventory=snapshot.inventory;const products=inventory.product_costs||[];const mentioned=products.find(p=>text.includes(normalize(String(p.product_name||""))))||products[0];
    const result=base("inventory_costs","Estoque, custos e margem",mentioned?`${String(mentioned.product_name)} tem custo estimado de ${brl(mentioned.cost_cents)} e margem bruta estimada de ${pct(mentioned.gross_margin_percent)}.`:`Há ${n(inventory.critical_count)} item(ns) abaixo do mínimo.`,["getInventorySummary","getLowStockItems","getProductCost","getProductMargin","getPurchaseSuggestions","getInventoryCoverage","getWasteSummary"],["inventory_items","inventory_movements","inventory_recipes","inventory_waste","purchase_orders"]);
    result.facts=[`Valor estimado em estoque: ${brl(inventory.inventory_value_cents)}.`,`CMV dos últimos 30 dias: ${brl(inventory.cmv_cents)}.`,`Perdas registradas: ${brl(inventory.waste_cents)}.`,`Itens zerados: ${n(inventory.stockouts)}.`];
    const suggestions=(inventory.items||[]).filter(i=>Number(i.suggested_purchase||0)>0).slice(0,5);if(suggestions.length)result.recommendations=suggestions.map(i=>`Revisar compra de aproximadamente ${n(i.suggested_purchase)} ${String(i.unit)} de ${String(i.name)}; é uma sugestão, não uma compra automática.`);result.action={label:"Abrir estoque",href:"/painel/estoque"};return result;
  }
  if (/financeir|conta.*pagar|conta.*receber|fluxo.*caixa|dre|concilia|taxa.*cart|quanto sobrou|orcamento|caixa fech/.test(text)) {
    const financial=snapshot.financial||{};const cards=financial.cards||{};const pnl=financial.pnl||{};const issues=(financial.reconciliations||[]).filter((r:Record<string,unknown>)=>["divergent","missing"].includes(String(r.status)));
    const result=base("financial_management","Financeiro gerencial",`O resultado gerencial no período é ${brl(pnl.management_result_cents)}. Há ${brl(cards.payable_cents)} a pagar e ${brl(cards.receivable_cents)} a receber.`,["getCashFlow","getAccountsPayable","getAccountsReceivable","getManagementPnl","getGatewayFees","getReconciliationIssues","getStoreFinancialPerformance","getCashRegisterDifferences","getExpenseBreakdown"],["financial_entries","financial_entry_payments","financial_reconciliations","orders","purchase_orders","inventory_movements","cash_shifts"]);
    result.facts=[`Receita bruta: ${brl(pnl.gross_revenue_cents)}.`,`CMV: ${brl(pnl.cmv_cents)}.`,`Taxas financeiras: ${brl(pnl.gateway_fees_cents)}.`,`Divergências de conciliação: ${n(issues.length)}.`];
    const differences=(financial.cash_sessions||[]).filter((s:Record<string,unknown>)=>Number(s.difference_cents||0)!==0);if(differences.length)result.facts.push(`${n(differences.length)} fechamento(s) de caixa têm diferença registrada.`);
    result.recommendations=["Revise vencimentos e divergências no painel antes de confirmar qualquer movimentação.","A análise é gerencial e não substitui a contabilidade oficial."];result.action={label:"Abrir Financeiro",href:"/painel/financeiro"};return result;
  }
  if (/cat[aá]logo|sku|c[oó]digo de barras|produto.*sem imagem|mudan[cç]a.*publicad|pre[cç]o.*unidade|dispon[ií]vel.*delivery|distribui[cç][aã]o.*loja/.test(text)) {
    const result=base("catalog_management","Catálogo central","O catálogo central governa os produtos operacionais existentes, resolve preço e disponibilidade por loja e canal e serve apenas versões publicadas ao cliente.",["searchCatalogProducts","getProductDetails","getCatalogHealth","getPendingCatalogChanges","getPriceHistory","getProductAvailability","getCatalogDistributionStatus"],["products","categories","catalog_product_assignments","price_books","product_channel_availability","catalog_changesets","published_catalog_read_models"]);
    result.facts=["O preço padrão não deve ser confundido com o preço efetivo por loja, canal e vigência.","Pedidos históricos preservam nome, variação, modificadores, preço, descontos e taxas no momento da compra.","Alergênicos e atributos alimentares são exibidos somente quando informados explicitamente."];
    result.hypotheses=["Sugestões de categoria, descrição e possíveis duplicatas são rascunhos para revisão humana."];
    result.recommendations=["Abra o Catálogo central para revisar o escopo, a prévia, os conflitos e a versão publicada antes de alterar qualquer loja.","A IA não altera preço, receita, estoque, disponibilidade ou publicação automaticamente."];
    result.action={label:"Abrir Catálogo central",href:"/painel/catalogo-central"};return result;
  }
  if (/capacidade|satura|gargalo|pr[oó]ximo.*slot|mais pedidos|fila.*cozinha|delivery.*minuto|risco.*promo[cç][aã]o/.test(text)) {
    const result=base("capacity_management","Capacidade operacional","A capacidade combina carga real, filas do KDS, equipe, recursos, compromissos futuros e entrega sem substituir os respectivos sistemas de origem.",["getCurrentCapacity","getCapacityByResource","getFutureCapacity","getAvailableOrderSlots","getOrdersAtRisk","getQueueHealth","getCapacityOverrides","simulateCapacityScenario"],["capacity_models","capacity_slots","operational_queues","kitchen_tasks","orders","forecast_predictions"]);
    result.facts=["A carga atual pesa mais que a previsão; forecast de baixa confiança não bloqueia pedidos sozinho.","Promessas são intervalos e preservam separadamente a janela original e a estimativa atual.","Pausar canal é último recurso e depende de policy explícita, duração mínima, histerese e ActionEngine."];
    result.hypotheses=["Sobrecarga projetada é uma possibilidade, não uma certeza; revise a confiança e os fatores limitantes."];
    result.recommendations=["Abra Capacidade para confirmar qual recurso está limitando a operação e testar alternativas em dry run.","A IA apenas explica e sugere; não recalcula nem aplica capacidade automaticamente."];
    result.action={label:"Abrir Capacidade",href:"/painel/capacidade"};return result;
  }
  if (/produto|item|lanche|combo|adicion/.test(text)) {
    const top = snapshot.products?.slice(0, 5) || [];
    const result = base("products", "Desempenho de produtos", top.length ? `${String(top[0].name)} lidera com ${n(top[0].quantity)} unidade(s) e ${brl(top[0].revenue_cents)} em faturamento.` : "Ainda não há vendas de produtos no período.", ["getTopProducts", "getLowPerformingProducts"], ["order_items", "orders", "products"]);
    result.facts = top.map((item, index) => `${index + 1}. ${String(item.name)} — ${n(item.quantity)} un. · ${brl(item.revenue_cents)}`); result.action = { label: "Abrir produtos", href: "/painel/inteligencia?tab=produtos" }; return result;
  }
  if (/unidade|loja|estabelecimento/.test(text)) {
    const units = snapshot.units || []; const best = units[0]; const worst = units.length > 1 ? units[units.length - 1] : null;
    const result = base("units", "Comparação entre unidades", best ? `${String(best.name)} tem o maior faturamento no escopo: ${brl(best.revenue_cents)}.` : "Não há unidades com movimento no período.", ["getStorePerformance", "comparePeriods"], ["orders", "establishments", "service_modes"]);
    result.facts = units.map(unit => `${String(unit.name)}: ${brl(unit.revenue_cents)} em ${n(unit.orders)} pedido(s).`); if (worst && Number(worst.orders) > 0) result.recommendations.push(`Analise ${String(worst.name)} com contexto de horário, capacidade e disponibilidade antes de tomar decisões.`); result.action = { label: "Ver unidades", href: "/painel/inteligencia?tab=unidades" }; return result;
  }
  if (/campanha|conversao|mensage/.test(text)) {
    const campaigns = snapshot.campaigns || []; const best = campaigns[0];
    const result = base("campaigns", "Resultado das campanhas", best ? `${String(best.name)} gerou ${n(best.orders)} pedido(s) e ${brl(best.revenue_cents)} em receita atribuída.` : "Nenhuma venda atribuída a campanhas neste período.", ["getCampaignPerformance"], ["crm_campaigns", "crm_campaign_attributions", "crm_campaign_recipients"]);
    result.facts = campaigns.slice(0, 6).map(c => `${String(c.name)}: ${n(c.delivered)} entregues · ${n(c.orders)} pedidos · ${brl(c.revenue_cents)}.`); result.action = { label: "Ver campanhas", href: "/painel/inteligencia?tab=campanhas" }; return result;
  }
  if (/atendimento|fila|sla|conversa|atendente|equipe/.test(text)) {
    const result = base("support", "Atendimento e equipe", `Há ${n(support.waiting)} conversa(s) aguardando e ${n(support.in_progress)} em atendimento.`, ["getQueuePerformance", "getTeamPerformance"], ["whatsapp_conversations", "support_agent_presence", "support_satisfaction_ratings"]);
    result.facts = [`Primeira resposta média: ${Number(support.average_first_response_minutes || 0).toLocaleString("pt-BR")} min.`, `SLA ultrapassado em ${n(support.sla_breached)} conversa(s).`, `Atendentes ativos agora: ${n(support.active_agents)}.`]; result.recommendations = ["Avalie carga, qualidade e satisfação em conjunto; velocidade isolada não representa desempenho."]; result.action = { label: "Abrir supervisão", href: "/painel/whatsapp/supervisao" }; return result;
  }
  if (/entrega|delivery|motoboy|atras/.test(text)) {
    const result = base("delivery", "Desempenho de entregas", `${n(delivery.delivered)} entrega(s) foram concluídas, com tempo médio de ${Number(delivery.average_minutes || 0).toLocaleString("pt-BR")} min.`, ["getDeliveryPerformance"], ["deliveries", "orders"]);
    result.facts = [`Em andamento: ${n(delivery.active)}.`, `Atrasadas frente à previsão: ${n(delivery.late)}.`, `Canceladas ou com falha: ${n(delivery.cancelled)}.`]; result.action = { label: "Monitorar entregas", href: "/painel/pedidos#despacho-entregas" }; return result;
  }
  if (/pagamento|pix|cartao|dinheiro|falha/.test(text)) {
    const result = base("payments", "Pagamentos", snapshot.payments?.length ? `O método mais usado foi ${String(snapshot.payments[0].method)}, com ${n(snapshot.payments[0].orders)} pedido(s).` : "Não há pagamentos no período.", ["getPaymentMetrics"], ["orders", "order_payment_transactions"]);
    result.facts = (snapshot.payments || []).map(p => `${String(p.method)}: ${n(p.orders)} pedido(s) · ${brl(p.revenue_cents)} · ${n(p.failures)} falha(s).`); return result;
  }
  if (/ia|inteligencia artificial|automatic/.test(text)) {
    const result = base("ai", "Atendimento por IA", `A IA processou ${n(ai.processed)} interação(ões), gerou ${n(ai.orders)} pedido(s) e ${brl(ai.revenue_cents)} em receita registrada.`, ["getAIAttributionMetrics"], ["ai_usage_events", "ai_conversation_analysis", "orders"]);
    result.facts = [`Fallback: ${pct(ai.fallback_percent)}.`, `Transferências: ${n(ai.transfers)}.`, `Pedidos atribuídos: ${n(ai.orders)}.`]; result.action = { label: "Ver Atendente IA", href: "/painel/atendente-ia" }; return result;
  }
  if (/cliente 360|perfil 360|histórico do cliente|historico do cliente|saúde do cliente|saude do cliente|próxima melhor ação|proxima melhor acao|propensão|propensao/.test(text)) {
    const result = base("customer_360", "Perfil 360 do Cliente", "A visão unificada reúne identidade, pedidos, fidelidade, atendimento, campanhas, reservas, assinaturas, consentimentos e sinais determinísticos de relacionamento sem substituir as fontes oficiais.", ["getCustomer360","getCustomerTimeline","getCustomerOrdersSummary","getCustomerLoyaltyStatus","getCustomerSupportHistory","getCustomerSegments","getCustomerHealth","getCustomerNextBestActions"], ["customers","orders","loyalty_accounts","customer_support_requests","crm_campaign_recipients","reservations","customer_subscriptions","customer_360_summaries"]);
    result.facts=["Saúde e risco usam regras determinísticas versionadas e sempre exibem os motivos.","Afinidade de produto é um padrão observado em pedidos, não uma preferência pessoal declarada.","Opt-out, horário silencioso, limite de frequência e reclamações abertas bloqueiam sugestões comerciais incompatíveis."];
    result.hypotheses=["Propensão e próxima melhor ação são sugestões operacionais explicáveis; não são fatos nem autorizam envio automático."];
    result.recommendations=["Abra o Perfil 360 para conferir as fontes, o horário de atualização e as permissões antes de agir.","Priorize recuperação de atendimento antes de qualquer oferta comercial."];
    result.action={label:"Abrir Perfil 360",href:"/painel/clientes-360"};return result;
  }
  if (/jornada|journey|reativa|win.?back|pós.?compra|pos.?compra|fideliza|supress|experimento de relacionamento/.test(text)) {
    const result=base("customer_journeys","Jornadas de relacionamento","As jornadas coordenam lifecycle, consentimento, mensagens, ofertas e tarefas sobre os motores oficiais do MasterApp, com versões, simulação e auditoria.",["getJourneys","getJourneyPerformance","getJourneyEnrollments","getJourneySuppressions","getJourneyConversions","getJourneyExperimentResults","getCustomerActiveJourneys","getJourneyHealth"],["customer_journeys","customer_journey_enrollments","journey_suppressions","journey_conversions","journey_experiments","automation_executions"]);
    result.facts=["Supressão por opt-out, ausência de consentimento, reclamação, frequência ou horário silencioso é uma proteção, não uma falha.","Receita atribuída mostra associação observada; causalidade só pode ser avaliada com grupo de controle válido.","A IA pode propor rascunhos, mas não publica, ativa, matricula clientes nem envia mensagens."];
    result.hypotheses=["Next Best Journey é uma recomendação explicável e nunca matricula o cliente automaticamente."];
    result.recommendations=["Revise a saúde, as supressões e o funil antes de ampliar a audiência.","Simule custos, conflitos, margem, estoque e capacidade antes de publicar."];
    result.action={label:"Abrir Jornadas",href:"/painel/jornadas"};return result;
  }
  if (/cliente|crm|recorr|retenc|vip|inativ/.test(text)) {
    const crm = snapshot.crm;
    const result = base("crm", "Clientes e retenção", `${n(crm.recurring_customers)} cliente(s) recorrente(s) compraram no período e ${n(crm.new_customers)} são novos.`, ["getCustomerRetentionMetrics"], ["customers", "orders"]);
    result.facts = [`Clientes VIP: ${n(crm.vip_customers)}.`, `Clientes inativos: ${n(crm.inactive_customers)}.`]; result.action = { label: "Abrir CRM", href: "/painel/crm" }; return result;
  }
  const result = base("sales_summary", "Resumo das vendas", `No período, foram ${n(sales.approved_orders)} pedidos aprovados, totalizando ${brl(sales.revenue_cents)}. O ticket médio foi ${brl(sales.average_ticket_cents)}.`, ["getSalesSummary", "getOrdersSummary", "comparePeriods"], ["orders", "manager_daily_metrics"]);
  result.facts = [...periodComparison(snapshot), `Cancelamentos: ${n(sales.cancelled_orders)} (${pct(sales.cancelled_percent)}).`, `Pedidos via WhatsApp: ${n(sales.whatsapp_orders)}.`];
  if (snapshot.forecast?.revenue_cents != null) result.facts.push(`Estimativa de fechamento pelo ritmo atual: ${brl(snapshot.forecast.revenue_cents)} — não é garantia.`);
  result.action = { label: "Abrir vendas", href: "/painel/inteligencia?tab=vendas" }; return result;
}
export const FEATURE_MANAGEMENT_COPILOT_TOOLS=["getFeatureDefinition","explainFeatureDecision","simulateFeatureEvaluation","getRolloutHealth","listExpiringOverrides","listCleanupOverdue"] as const;
export const FEATURE_MANAGEMENT_COPILOT_GUARDRAILS={canPublish:false,canAdvanceRollout:false,canActivateKillSwitch:false,actionLabel:"Abrir Feature Management",actionHref:"/superadmin/feature-management"} as const;
