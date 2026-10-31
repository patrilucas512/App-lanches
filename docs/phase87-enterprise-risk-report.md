# Fase 87 — relatório de implementação

## Arquitetura e entregas

Foi criado o domínio `lib/enterprise-risk` com taxonomia, registro, avaliação, controles, tratamentos, aceite, apetite, KRIs, candidatos, terceiros, concentração, acesso, saúde e Copilot governado. A API `/api/enterprise-risk` usa contexto autenticado, RBAC e auditoria; a tela `/painel/governanca/riscos` apresenta portfólio, heatmap, evidências e histórico.

## Migration

`20261029080000_phase87_enterprise_risk_management.sql` cria 21 tabelas, índices, view `security_invoker`, feature flags, eventos de automação, widgets e dataset de Reporting. Todas as tabelas têm RLS; `anon` e `authenticated` não recebem acesso direto e o backend autorizado usa `service_role`. O Supabase CLI não estava instalado, portanto o nome sequencial foi criado localmente e deve ser validado na aplicação controlada em produção.

## Integrações

- Fase 59: incidentes e postmortems originam eventos/candidatos.
- Fase 86: gaps de continuidade e evidências de restore.
- Fases 84/85: NOC, SLO, error budget e provider reliability.
- Fases 25, 47, 67, 76: segurança, qualidade, auditoria e dados.
- Procurement/Supply Chain: terceiros e concentração com IDs canônicos.
- Fases 32/79: tarefas, aprovações, autoridade, cadência e apetite.
- Reporting, Data Platform, Workspace e Executive Command Center: fatos, dimensões, métricas e cartões declarados.

## Segurança e governança

O modelo é multi-tenant por `organization_id`, com acesso sensível separado, aceite/encerramento crítico com permissões próprias, auditoria de decisões e referências redigidas. Evidências são links e não cópias. IA não aceita, encerra, publica avaliação ou faz alegação legal. O ERM indisponível não bloqueia a operação.

## Testes, limitações e dívida técnica

Os testes cobrem taxonomia, matriz, histórico, inerente/residual, eficácia, expiração, tratamentos, aceite, apetite, KRIs, deduplicação, terceiros, concentração, RBAC, isolamento, auditoria, UI e integrações. Esta primeira versão não inclui portal de terceiros, questionários GRC complexos, scraping externo, execução automática de infraestrutura nem score corporativo. A migration ainda precisa ser aplicada e validada no Supabase de produção somente após autorização explícita.

## Recomendação futura

Após operação real, a próxima fase pode aprofundar questionários reutilizando Forms, simulação com Digital Twin e conectores de evidência — sem iniciar a Fase 88 automaticamente.
