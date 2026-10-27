# Fase 28 — diagnóstico inicial

O MasterApp já possuía eventos especializados de IA, onboarding, billing, suporte, auditoria, CRM operacional e observabilidade. Eles não formavam uma taxonomia de produto e parte deles contém contexto do restaurante, portanto não devem ser reutilizados diretamente para marketing do SaaS.

## Decisões

- Criar `product_events` como domínio independente e usar somente IDs internos e propriedades permitidas pelo registro.
- Enfileirar antes de armazenar; falhas de analytics nunca interrompem operação.
- Reutilizar `organizations`, `subscriptions`, `plans`, onboarding, suporte, releases e usage meters como fontes agregadas.
- Manter campanhas SaaS em `saas_lifecycle_campaigns`, separadas do CRM dos restaurantes.
- Restringir dashboards e tabelas a Super Admin com RLS.
- Não declarar causalidade sem experimento nem vencedor sem amostra mínima.

## Riscos encontrados

- Eventos anteriores não seguem uma única convenção.
- Não havia retenção/coortes, health score explicável ou assignment persistente para experimentos.
- Dados de operação do restaurante precisam de minimização antes de virar sinal de adoção.
- O pipeline analítico inicial usa o Postgres transacional; agregados e índices reduzem o impacto, mas warehouse será necessário em maior escala.
