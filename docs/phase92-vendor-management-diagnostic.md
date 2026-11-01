# Fase 92 — Diagnóstico prévio de Vendor & Third-Party Management

## Escopo analisado

Foram revisados os domínios existentes de Procurement/Suppliers, Contracts/Documents, MDM, Enterprise Risk, Service Reliability, Business Continuity, Enterprise Architecture, Integration Hub, Finance/FinOps, Security, Data Governance, Incident Management, Change Management, Marketplace, Transport e Portfolio Management.

## Fontes canônicas existentes

| Informação | Fonte oficial | Decisão da Fase 92 |
| --- | --- | --- |
| Fornecedor operacional, itens, compras e recebimentos | `suppliers`, `supplier_inventory_items`, `purchase_orders`, `purchase_receipts` — Fases 16/39 | Referenciar `supplier_id`; não criar Supplier Management paralelo |
| Identidade, aliases e duplicidades | `master_entity_registry`, `master_entity_identifiers`, aliases e quality issues — Fase 75 | Usar `third_party_ref`/MDM e tratar matches somente como candidatos |
| Contratos, documentos e versões | `contracts`, `compliance_documents` — Fase 49 | Manter texto e arquivo no repositório oficial; guardar somente `contract_ref`/`evidence_ref` |
| Risco de terceiro | `third_party_risk_profiles`, assessments e `enterprise_risks` — Fase 87 | Compor risco por adapter; alterações seguem workflow da Fase 87 |
| SLA/SLO e confiabilidade | reliability services, SLI, SLO, evaluations e incident impact — Fase 85 | SLA contratual referencia contrato/métrica; SLO interno não é duplicado |
| Continuidade | profiles, plans, evidence, dependencies e exercises — Fase 86 | Referenciar readiness, fallback e evidência; não copiar plano |
| Aplicações, capabilities e dependências | Fase 90 Enterprise Architecture | Usar grafo e análise de impacto para dependência e saída |
| Integrações e credenciais | Fases 20/81 | Referenciar conexão/credential IDs; nunca armazenar segredo |
| Custos e pagamentos | Finance, Procurement e Fase 78 FinOps | Agregar por origem, período e moeda sem conversão silenciosa |
| Incidentes | `operational_incidents` — Fase 59 | Relacionar incidente ao terceiro; causalidade só quando confirmada |
| Mudanças reais | Fase 88 Change Management + ActionEngine | Vendor Management somente cria draft/solicitação; não troca provider |
| Marketplaces e logística | Fases 69/73 | Reutilizar providers, connections e carriers existentes |
| Investimentos de substituição | Fase 91 Portfolio Management | Permitir promoção de replacement relevante para iniciativa, sem execução automática |

## Duplicidades e lacunas

- `suppliers` é orientado a compras e não cobre provedores tecnológicos, comunicação, IA, pagamentos e parceiros de integração.
- `third_party_risk_profiles` cobre risco, mas não onboarding, contratos, performance, renovação ou saída.
- `architecture_applications.provider_name` é texto descritivo, não identidade canônica de terceiro.
- `transport_carriers`, marketplace providers e integration connections representam relações operacionais específicas; não devem ser migrados ou fundidos automaticamente.
- Falta uma camada única e não destrutiva que componha Vendor360 e governe o ciclo completo.
- Falta histórico imutável de decisões de renovação/saída, onboarding policy-driven, due diligence versionada, alternativas qualificadas e planos de saída.

## Arquitetura decidida

1. Criar `vendor_profiles` como camada de perfil/referência, nunca como novo cadastro financeiro ou de compras.
2. Separar os contextos `masterapp_platform_vendors` e `tenant_vendors`.
3. Exigir `organization_id` no contexto tenant e proibi-lo no contexto plataforma.
4. Usar links tipados para MDM, suppliers, contracts, risk, continuity, architecture, reliability, integrations e incidents.
5. Manter avaliações dimensionais, evidências, cobertura e metodologia; nenhum score universal opaco.
6. Guardar valores por moeda e origem; nenhuma conversão cambial implícita.
7. Tornar lifecycle, decisions e audit históricos, com bloqueio de reescrita onde aplicável.
8. Usar Policy Engine e Approval Engine para requisitos/exceções; ações críticas permanecem no ActionEngine/domínio oficial.
9. Criar read models e jobs assíncronos para Vendor360, custos, performance, renovação e impacto de saída.
10. O módulo pode degradar sem interromper compras, pagamentos, integrações ou operação.

## Segurança e Supabase

- Todas as tabelas novas no schema `public` terão RLS habilitada.
- Acesso direto de `public`, `anon` e `authenticated` será revogado; a API server-side usará `service_role` após autorização contextual.
- Views serão `security_invoker=true`, preservando RLS e menor privilégio.
- Índices começarão por contexto/tenant e pelos filtros operacionais mais usados.
- Dados sensíveis de contratos, preços, risco, segurança e acesso serão mascarados por permissão.
- Nenhum token, API key ou conteúdo secreto será persistido na camada Vendor Management.

## Consequência para implementação

A implementação será aditiva e dividida em registry/lifecycle, onboarding/due diligence, composição de contratos/performance, SLA/custos, risco/continuidade/concentração, renovações, saída e analytics/copiloto. A Fase 93 não faz parte deste trabalho.
