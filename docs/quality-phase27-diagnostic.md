# Fase 27 — diagnóstico inicial

## Estado encontrado

- 887 testes passavam antes da fase, majoritariamente testes estruturais em `node:test`.
- Havia um único workflow de pull request com instalação, testes e build.
- As suítes não estavam formalmente separadas em unit, integration, E2E, contract, security e performance.
- Não existia banco de staging/preview conectado ao repositório nem seed sintético central.
- Produção era publicada pelo fluxo nativo de Sites, sem entidade completa de release/aprovação/rollback.
- A Fase 26 já fornecia correlation ID, health check, métricas, filas, DLQ e snapshot de performance.
- Feature flags operacionais já existiam por loja; faltava rollout percentual, alvo por tenant/plano e kill switch central.
- Migrations eram versionadas, mas não havia verificação automática de DROP, RENAME, rewrite ou lock pesado.
- Não havia scanner local de secrets, SBOM nem catálogo de testes flaky.

## Priorização por risco

1. Pedidos, pagamentos e isolamento multiempresa.
2. Webhooks duplicados, concorrência de estoque e checkout com double submit.
3. WhatsApp, cozinha e delivery.
4. Billing, fiscal, financeiro e integrações.
5. Portal, CRM, reservas e suporte.

## Decisão técnica

Foi preservado `node:test`, pnpm, GitHub Actions, Supabase e Sites. A fase adiciona gates e organização sem trocar a stack. O banco usa somente expansão; remoções futuras exigem etapa contract separada.

