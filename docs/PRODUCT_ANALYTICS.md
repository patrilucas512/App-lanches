# Product Analytics e Growth do MasterApp

## Taxonomia

Eventos usam `snake_case`, `event_id` idempotente, `organization_id`, IDs opcionais de usuário/unidade, `occurred_at`, propriedades permitidas, fonte, release, versão do schema e correlation ID. Nome, telefone, e-mail, documento e endereço são rejeitados.

## Pipeline

Aplicação ou trigger seguro → `product_event_ingestion_queue` → processador com `SKIP LOCKED` → `product_events` → agregados e dashboards. A operação continua caso o pipeline falhe.

## Métricas

Ativação padrão é versionada. WAO/MAO contam ações significativas, não login. NRR = `(MRR inicial + expansão − contração − churn) / MRR inicial`; GRR exclui expansão. Health score mostra ativação, adoção, uso, suporte, billing e onboarding separadamente e sempre informa que o risco é estimado.

## Privacidade

O domínio é interno do SaaS, acessível apenas ao Super Admin. `analytics_enabled` permite opt-out de analytics não essencial. Eventos essenciais de billing/segurança permanecem nos seus domínios originais. Raw events têm retenção definida no registro; agregados podem ser anonimizados para histórico.

## Experimentos

Assignment determinístico e persistente por organização. Pagamentos, segurança e dados sensíveis ficam fora por padrão. Guardrails e amostra mínima são obrigatórios; associação de release sem experimento não prova causalidade.
