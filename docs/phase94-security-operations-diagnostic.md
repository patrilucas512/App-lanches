# Fase 94 — Diagnóstico inicial do Security Operations Center

## Escopo revisado

A revisão confirmou que o MasterApp já possui os domínios canônicos que o SOC deve consumir:

- Auth, sessões, MFA, rate limiting, alertas e auditoria de segurança na Fase 25;
- observabilidade estruturada, correlação e redaction na Fase 26;
- Automation Center na Fase 50;
- Incident Management na Fase 59;
- Policy Engine e ActionEngine na Fase 79;
- governança de agentes de IA na Fase 80;
- Integration Hub na Fase 81;
- NOC na Fase 84;
- continuidade, risco, mudanças, arquitetura, portfólio e terceiros nas Fases 86 a 92.

## Achados

1. `security_events` já existe e será ampliada como camada normalizada, preservando eventos legados.
2. `security_audit_logs` continua sendo a trilha canônica. O SOC cria somente eventos de domínio para decisões e investigações.
3. `operational_incidents` continua sendo a autoridade para incidentes confirmados. O SOC cria candidatos e vínculos.
4. `copilot_action_requests` e o Policy Engine continuam responsáveis por ações com impacto.
5. O NOC continua responsável por disponibilidade; o SOC agrega somente o contexto de segurança.
6. Logs brutos permanecem na observabilidade. O banco do SOC armazena referências, resumos normalizados e evidências mínimas.
7. O código desta cópia não contém uma implementação local identificável da Fase 93. A Fase 94 usa referências de identidade, concessão, sessão e acesso, sem criar um segundo Identity Governance.

## Decisão arquitetural

O SOC será um plano de controle assíncrono e não ficará no caminho crítico de login, pedidos, pagamentos ou operação. O fluxo é:

`fontes canônicas → eventos normalizados → regras versionadas → detecções → correlação → alertas → investigação → resposta governada`

Separações obrigatórias:

- sinal não é alerta;
- alerta não é incidente confirmado;
- correlação não é causalidade;
- hipótese não é fato;
- detecção não executa contenção de alto impacto;
- contexto de mudança reduz ruído, mas não oculta sinais críticos.

## Segurança e isolamento

As tabelas do SOC usam RLS como defesa em profundidade, privilégios de `anon` e `authenticated` revogados e acesso somente por rotas server-side autorizadas. Os contextos `platform_soc` e `tenant_soc` permanecem separados. Views usam `security_invoker=true`.

## Estratégia de implantação

A implementação é aditiva, com expansão compatível de `security_events`, registries, regras imutáveis, deduplicação, investigações, resposta governada, hunting somente leitura, integrações por referência, analytics, navegação e testes. A migration de produção só deve ser aplicada após autorização explícita.
