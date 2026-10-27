# Fase 77 — diagnóstico inicial de Feature Management

Data: 2026-10-27

## Inventário encontrado

- `plans`: 146 colunas `*_enabled`. A maior parte representa entitlement comercial e deve continuar sob a Fase 22.
- `store_feature_flags`: 111 colunas `*_enabled`. Misturam disponibilidade operacional, configuração de unidade e algumas flags técnicas legadas.
- `saas_features` + `saas_plan_features` + `saas_effective_entitlement`: fonte oficial de entitlement. Não será duplicada.
- `quality_feature_flags`: rollout técnico da Fase 27, com ambiente, percentual, kill switch, planos e organizações alvo. Deve ser migrado para o registry e preservado como compatibilidade.
- `analytics_feature_flags`: configuração operacional da plataforma de dados, não entitlement.
- `product_experiments`: motor oficial de experimentação da Fase 28. A Fase 77 apenas referencia a atribuição.
- `platform_releases`: fonte oficial de releases da Fase 27. Feature versions podem apontar para a release, sem criar outro motor.
- `network_governance_policies`, `network_config_overrides` e `InheritedConfigurationService`: herança oficial organização → marca → região/cluster → loja.
- `EntitlementService`: acesso oficial à decisão comercial por organização.
- `Automation Center`/ActionEngine: execução controlada e aprovação humana para ações críticas.

## Classificação

| Origem | Classificação | Tratamento |
|---|---|---|
| `saas_plan_features` e limites do plano | Entitlement | Reutilizar sem copiar valores para flags |
| Booleanos comerciais de `plans` | Entitlement legado | Mapear gradualmente para `saas_features`; não registrar como rollout |
| `quality_feature_flags` | Feature flag técnica | Migrar para `feature_definitions`/versões |
| `analytics_feature_flags` | Configuração operacional | Registrar como configuração tipada quando for transversal |
| `store_feature_flags` | Misto | Classificar por domínio; migrar somente flags técnicas verdadeiras |
| Preferências de negócio do módulo | Domain setting | Permanecer no domínio proprietário |
| `process.env` e credenciais | Environment/secret | Permanecer no ambiente/Secret Management |
| `product_experiments` | Experimento | Referenciar; não recriar atribuição A/B |

## Duplicações e dívida técnica

- `rolloutBucket`/`isFeatureEnabled` em `lib/quality/core.ts` é um resolver específico da Fase 27.
- `deterministicVariant` em Product Analytics é correto para experimentos, mas não deve ser usado como rollout técnico.
- Consultas diretas a `store_feature_flags` existem em orquestradores de IA, voz e capacidade.
- Há verificações de plano espalhadas por componentes e páginas; quando comerciais, devem continuar como entitlement.
- Não existe registry central com owner, prazo de limpeza, tipo, schema e safe default.
- Não existe avaliação única com precedência kill switch → entitlement → blocklist → override → experimento → targeting/rollout → default.

## Decisão de refatoração

1. Criar `feature_management/` como camada central e cacheável.
2. Reusar `EntitlementService`, `product_experiments`, `platform_releases` e herança da Fase 46.
3. Migrar inicialmente as flags técnicas da Fase 27 e registrar mapeamentos legados sem alterar comportamento.
4. Expor ao cliente somente valores efetivos seguros; regras, allowlists e metadados internos permanecem no backend.
5. Manter consultas legadas durante migração gradual, com o registry como destino oficial para novas flags.
