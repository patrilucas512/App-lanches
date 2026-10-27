# Fase 78 — diagnóstico inicial de FinOps

Data da revisão: 2026-10-27. Escopo: Billing/Usage Metering, IA, voz, WhatsApp, integrações, infraestrutura, Finance, invoices, Data Platform e campos de custo existentes.

## Inventário confirmado

- **Billing / Usage Metering (Fase 22):** `usage_meters`, `usage_events`, `usage_aggregates`, `saas_invoices`, `saas_invoice_items`, `subscriptions`, `saas_prices`, `saas_plan_features` e `organization_addons` já são o sistema oficial de cobrança e entitlement. `usage_events` já possui idempotência por organização, quantidade, `provider_cost_micros` e `billable_amount_micros`.
- **IA:** `ai_usage_events` e `analytics_fact_ai_usage` registram provider, modelo, tokens, latência e custo estimado em micros. Esses eventos serão normalizados por referência, sem copiar conteúdo, prompt ou resposta.
- **Voz:** `voice_call_sessions` e o dashboard de voz já expõem duração, resultado, pedidos e custo estimado agregado. A nova camada usará minutos, STT, TTS e tokens como medidores canônicos, sem armazenar transcrição.
- **WhatsApp / Omnichannel:** mensagens normalizadas, templates, automações e webhooks já existem. A Fase 78 consumirá somente contagem, categoria, país quando aplicável e referências técnicas; nunca corpo da mensagem.
- **Integration Hub:** adapters e webhooks já são separados por provider. O novo domínio adiciona adapters de custo por categoria, sem criar um segundo hub nem presumir API de cobrança.
- **Observability (Fase 26):** métricas, logs, traces, SLOs e health checks continuam oficiais. FinOps consumirá agregados de volume e lag; não criará telemetria de alta cardinalidade.
- **Finance gerencial (Fases 17/31):** receitas SaaS, budgets e `revenue_cost_entries` já existem. FinOps fornece COGS técnico, reconciliação e margem técnica como insumos; não cria contabilidade, contas a pagar ou outro financeiro.
- **Provider invoices:** `saas_invoices` são faturas cobradas dos clientes MasterApp, portanto não representam contas a pagar de providers. Statements de provider serão referências técnicas e poderão apontar para documentos/Finance, sem duplicar AP.
- **Data Platform (Fases 34/76):** facts, catálogo de métricas, contratos, linhagem e qualidade já existem. A Fase 78 registra facts/dimensões FinOps e linhagem para o sistema oficial.
- **Feature Management (Fase 77):** registry, rollout, health gates, ActionEngine e kill switches já existem. FinOps fornecerá preview/saúde de custo, mas não alterará preço, entitlement ou rollout automaticamente.

## Lacunas encontradas

1. Custos estimados aparecem em vários módulos sem rate card efetivo, versão, fonte, câmbio ou qualidade explícita.
2. Não há separação uniforme entre custo estimado, alocado, reportado pelo provider e reconciliado.
3. Não existe catálogo central de providers, serviços, meters, rate cards e componentes por vigência.
4. Custos compartilhados de banco, storage, observabilidade e infraestrutura não têm pools e regras de alocação versionadas.
5. Não há reconciliação formal entre uso calculado e statement do provider, nem proteção central contra duplicidade/double count.
6. Unit economics atuais não apresentam cobertura, qualidade, p50/p75/p90/p95 e margem técnica de forma consistente.
7. Forecast, budgets, anomalies, commitments e recomendações de otimização não compartilham um ciclo FinOps fechado e auditável.
8. Custos desconhecidos podem ser omitidos por consumidores; a Fase 78 torna `unknown` um estado explícito, nunca zero silencioso.

## Estimativas hardcoded e transição

- `provider_cost_micros`, `estimated_cost_micros`, `estimated_cost_cents`, `messaging_cost_cents`, `ai_cost_cents` e campos equivalentes aparecem em Billing, Analytics, Voz, Automation, Journeys e Revenue Ops.
- Esses campos permanecem compatíveis, mas passam a ser classificados como fonte legada/estimada até que um rate card versionado ou statement reportado esteja associado.
- Nenhum preço atual de OpenAI, Meta, telefonia, cloud, maps, fiscal ou payment provider será inserido no código ou em seed obrigatório.

## Arquitetura decidida

`Usage oficial → normalização FinOps → rate efetivo → custo estimado → provider statement → pool/alocação → reconciliação → margem técnica`.

- Billing mantém preço, invoice, entitlement e limites comerciais.
- Finance mantém receita gerencial, AP e contabilização.
- Usage Metering mantém os eventos oficiais.
- Observability mantém a telemetria.
- `platform_finops` mantém custo técnico, atribuição, qualidade, reconciliação, previsão e recomendações.
- Valores monetários usam `numeric`/decimal em unidades monetárias explícitas; micros são aceitos somente como integração legada bem identificada.
- Custos internos ficam restritos a superadmin/roles FinOps. Tenants não recebem acesso por padrão.
- Processamento é assíncrono e fail-open: falha de custo nunca bloqueia pedido, pagamento ou operação principal.

## Riscos e controles

- **Double count:** unicidade por fonte/evento/statement e validação de buckets exclusivos.
- **Histórico:** rate cards, regras, FX, forecast vintages e snapshots são versionados; períodos fechados são imutáveis.
- **Precisão:** toda linha declara método e qualidade; custo agregado permanece `coarse`/`estimated` até reconciliação.
- **Ação automática:** recomendações não são aplicadas; circuit breaker só atua em workflow técnico não crítico, com policy e integração ao ActionEngine/Feature Management.
- **Privacidade:** meters armazenam quantidades e dimensões técnicas permitidas, nunca prompt, mensagem, transcrição, endereço ou credencial.
