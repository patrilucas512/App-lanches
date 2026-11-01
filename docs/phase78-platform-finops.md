# Fase 78 — Platform FinOps e Unit Economics Técnico

## 1. Diagnóstico inicial

O diagnóstico detalhado está em `docs/phase78-initial-diagnosis.md`. Billing/Usage Metering (Fase 22), Finance (Fases 17/31), Observability (Fase 26), Data Platform (Fase 34), Data Governance/Lineage (Fase 76) e Feature Management (Fase 77) permanecem sistemas oficiais. A Fase 78 adiciona custo técnico e não cria Billing, AP, contabilidade ou telemetria paralelos.

## 2. Arquitetura FinOps

`Usage oficial → normalização → rate efetivo → custo estimado → provider statement → pool/alocação → reconciliação → margem técnica`.

Processamento de custo ocorre fora do request crítico, em lotes limitados e idempotentes. Falha de FinOps não bloqueia pedido, pagamento ou operação principal.

## 3. Arquivos criados

- `lib/platform_finops/core.ts`: decimal fixed-point, pricing, FX, allocation, reconciliation, margin, coverage, anomaly, forecast e simuladores.
- `lib/platform_finops/services.ts`: serviços de domínio FinOps.
- `lib/platform_finops/adapters.ts`: adapters canônicos para IA, voz, messaging e infraestrutura.
- `lib/platform_finops/integrations.ts`: contratos com Billing, Finance, Observability, Reporting, Workspace, Data Platform, Feature Management, Automation e Copilot.
- `app/api/platform-finops/route.ts`: API interna superadmin.
- `app/api/platform-finops/worker/route.ts`: cálculo assíncrono limitado e health de meters.
- `app/superadmin/finops/page.tsx`: rota protegida.
- `components/platform-finops-center.tsx` e CSS module: dashboard, explorer e centros operacionais.
- `tests/platform-finops-phase78.test.mjs`: cobertura funcional, segurança, integração e regressão de contrato.
- `docs/phase78-initial-diagnosis.md` e este relatório.

## 4. Arquivos modificados

- `components/superadmin-shell.tsx`: navegação FinOps.
- `package.json`: comando `test:phase78`.

## 5. Migration

`20261027161210_phase78_platform_finops.sql` cria o domínio interno, views `security_invoker`, índices, RLS, grants internos e seeds sem preços de providers. A migration ainda deve ser aplicada no Supabase de produção somente após autorização explícita.

## 6. Providers

`cost_providers` suporta AI, voice, messaging, database, storage, bandwidth, serverless, observability, email, maps, payments, fiscal, marketplace, infrastructure e custom. Fonte pode ser API, import de invoice, manual, estimada ou cloud billing export. Credenciais não são aceitas.

## 7. Cost meters

`cost_meter_definitions` registra unidade, fonte, agregação, dimensões permitidas e owner. Meters oficiais de Billing são referenciados por `billing.<meter_key>` sem copiar os eventos. Payloads com prompt, resposta, corpo de mensagem, transcript, endereço, cartão, senha, secret ou credential são rejeitados.

## 8. Rate cards

`provider_rate_cards` e `provider_rate_components` versionam vigência, moeda, fonte, status, tiers, fee fixo, percentual e mínimo. Nenhum preço atual de provider está hardcoded.

## 9. Pricing models

Suportados: per-unit, tiered, volume-tiered, fixed monthly, fixed plus usage, percentage, minimum commitment e custom safe formula. Fórmula customizada não executa código arbitrário e exige adapter revisado.

## 10. Currency / FX

`platform_cost_fx_rates` preserva moeda original, moeda base, taxa, data e fonte. Conversão histórica sem FX correspondente produz `unknown`, nunca usa a cotação atual retroativamente.

## 11. Usage normalization

`platform_cost_usage_events` usa `source_system + source_event_id` para idempotência e mantém tenant, store, feature, service, meter, environment, region, channel e model apenas quando aplicável. A classe de privacidade é obrigatoriamente `technical_no_content`.

## 12. Direct cost calculation

O worker encontra o rate card efetivo na data do uso, calcula em fixed-point Decimal, converte pelo FX histórico e registra lineage em `platform_cost_entries`. Sem provider, rate ou FX: status desconhecido; jamais zero silencioso.

## 13. Shared cost pools

`platform_cost_pools` representa custos agregados como database instance, observability base fee e commitments. Ambiente e qualidade ficam explícitos.

## 14. Allocation rules

`cost_allocation_rules` versiona método, dimensão, fonte do driver, fórmula segura e vigência. O default técnico é driver de recurso; `revenue_based` exige `business_decision_ref`. A alocação preserva exatamente o total do pool, incluindo sobra de arredondamento.

## 15. Feature attribution

`feature_cost_mappings` associa feature, service e meter com regra direct, weighted, exclusive ou shared. O serviço de validação detecta source duplicado, bucket exclusivo repetido e combinação estimado/provider reportado.

## 16. Tenant attribution

`platform_cost_entries` e `platform_cost_allocations` suportam tenant/organization/store/plan/feature/module sem exigir todas as dimensões. Custos internos por tenant ficam restritos a papéis autorizados.

## 17. Provider statements

`provider_cost_statements` e lines suportam import API, CSV/manual ou cloud export. Hash e identificador por provider impedem duplicidade. Tax, surcharge, credit, commitment, adjustment e unknown são linhas distintas.

## 18. Reconciliation

`platform_cost_reconciliations` compara custo estimado e reportado com tolerância monetária e percentual. Estados: matched, within tolerance, mismatch, incomplete e unknown. Centavos dentro da tolerância não viram incidente.

## 19. Adjustments

`platform_cost_adjustments` é append-only por desenho, com provider credit/debit, reconciliation, correction, commitment true-up e reversal por referência.

## 20. Commitments

`provider_commitments` separa custo econômico de usage do custo de compromisso contratado. Underuse permanece visível e pode compor pool compartilhado/variance.

## 21. Unit Economics

`platform_unit_economics_snapshots` guarda receita, COGS direto, overhead alocado, custo técnico, margem técnica, qualidade e distribuição p50/p75/p90/p95 por tenant, plan, feature, add-on ou segment.

## 22. Technical Margin

Definição: receita SaaS líquida menos COGS técnico da plataforma. Não é margem bruta contábil. O cálculo exige receita e custo; sem cobertura suficiente retorna unknown.

## 23. Plan economics

O simulador recebe preço mensal, included usage, overage, distribuição esperada e custo por unidade. Retorna margem p50/p90 e break-even em dry run, sem publicar preço ou alterar entitlement.

## 24. Add-on economics

Os mesmos modelos suportam AI, Voice, WhatsApp e outros add-ons, comparando receita unitária, custo unitário e heavy-user risk sem ação punitiva.

## 25. Budgets

`platform_cost_budgets` aceita total platform, provider, service, feature e environment, com thresholds configuráveis e owner.

## 26. Forecasts

`platform_cost_forecasts` é versionado por vintage e suporta trend, usage × projected tenants, known commitment e driver-based. Faixas low/expected/high e premissas ficam explícitas.

## 27. Anomalies

`platform_cost_anomalies` registra candidates determinísticos/estatísticos: day-over-day, moving baseline, usage spike, unexpected meter, burn rate e unknown cost spike. Correlações não afirmam causalidade nem fraude.

## 28. Optimization recommendations

`platform_cost_optimization_recommendations` cobre recursos ociosos, sizing, logs, retention, modelo caro, duplicidade, cache, retry storm, rate mismatch e commitment underuse. Fluxo: proposed, reviewing, accepted/rejected, implemented e measured. Não há aplicação automática.

## 29. Feature Management

Fase 77 recebe cost impact preview e pode observar custo por interação como health guardrail opcional. Custo isolado não pausa rollout automaticamente. Circuit breaker técnico só recomenda fluxo humano para malfunction em workflow não crítico.

## 30. Billing / Finance

Billing continua dono de preços, invoices, entitlements, commercial limits e charges. Finance continua dono de AP, accounting e receita gerencial. FinOps apenas referencia esses dados para custo/margem e não altera faturas.

## 31. Reporting / Workspace

Foram definidos 10 datasets, 14 templates e 8 widgets FinOps, incluindo Platform Cost MTD, Technical Margin, Provider Variance, Forecast e Negative Margin Tenants. A exposição é restrita a Executive/Finance/FinOps.

## 32. Executive Command Center

Sinais consolidados: platform cost trend, technical margin, projected budget overrun, major provider anomaly e high-cost feature. O detalhamento sensível permanece no módulo FinOps.

## 33. Copilot

Doze tools read/simulate cobrem resumo, provider, feature, tenant, plan, margins, anomalies, reconciliation, forecast, simulation, optimization e lineage. O Copilot não muda preço, cancela provider, publica rate ou reduz core service.

## 34. Data Platform / Lineage

Facts: usage, cost, provider statement, allocation, reconciliation, anomaly e unit economics. Dimensões: provider, service, meter, center, quality e status, com contratos para feature e plan oficiais. Lineage informa usage, rate version, FX, statement, pool e allocation rule.

## 35. Security / Privacy / RBAC

RLS está ativa em todas as tabelas; views usam `security_invoker`; `anon` não recebe acesso; tenants não recebem acesso padrão. Permissões granulares separam provider costs, tenant costs, margins, rates, rules, statements, reconciliation, budgets, forecasts, commitments, optimization e period close.

## 36. Period close

Estados: open, calculating, reconciling, review, closed e reopened. Close valida unknown costs, reconciliation, FX e allocations. Snapshot fechado preserva versões. Late adjustments vão ao período seguinte ou a reopen autorizado.

## 37. Audit

Mudanças materiais registram actor, reason, before/after redigidos e requisito de preview. Eventos individuais de usage não geram auditoria ruidosa.

## 38. Observability

`cost_meter_health_results` monitora eventos, lag, mapping e stale rate. Worker processa no máximo 200 eventos por execução e nunca bloqueia produto principal. Métricas são agregadas para evitar cardinalidade excessiva.

## 39. Tests

O pacote da fase possui 80 testes: provider, rate versioning, todos os pricing models, Decimal, FX, idempotência, allocation tie-out, double count, statements, reconciliation, commitments, budgets, anomaly, forecast, close, RBAC, privacy, adapters, scale, retries e integrações. Regressões de Billing, Finance, Voice, WhatsApp, Integration Hub, Revenue Ops, Data Platform, Data Governance e Feature Management também foram executadas.

## 40. Limitações

- Nenhum rate/provider real é presumido; o Super Administrador deve cadastrar/importar dados contratuais.
- A primeira previsão é determinística/driver-based, não ML.
- Provider APIs dependem de adapters e credenciais externas existentes.
- OCR de invoice não foi criado; documents podem ser referenciados.
- Cost explorer usa tabelas/views atuais; em escala extrema deve apontar para marts/warehouse particionados.
- O teste legado da Fase 26 espera `liveness` no health endpoint atual; a rota existente retorna `ok/service/server_time`. É uma inconsistência preexistente e independente da Fase 78.

## 41. Recomendações para a Fase 79

Não iniciada. Recomenda-se, após dados reais e períodos fechados suficientes: adapters oficiais dos providers prioritários, backfill controlado de rates históricos, warehouse particionado, calibration de forecast, FinOps review workflow e runbooks de reconciliation. A definição da Fase 79 depende de nova instrução do usuário.
