# Fase 80 — diagnóstico inicial e inventário

## Escopo revisado antes da implementação

O diagnóstico confirmou que o MasterApp já possuía agentes especializados, serviços de execução e control planes canônicos. Por isso, a Fase 80 foi implementada como plano de controle e governança, sem criar um segundo ActionEngine, Policy Engine, Knowledge Base, FinOps, Feature Management, Automation Center, Incident Management ou inbox humano.

Foram revisados os orquestradores, copilots, providers, prompts e pontos de ação existentes em `lib/`, as migrations das Fases 50, 59, 68, 77, 78 e 79, os fluxos de aprovação e as telas administrativas.

## Inventário de agentes/copilots existentes

| Chave governada | Agente existente | Origem canônica | Ação permitida pela integração |
| --- | --- | --- | --- |
| `whatsapp.intelligent_attendant` | WhatsApp Intelligent Attendant | `lib/ai-attendant/orchestrator.ts` | Conversação e serviços de pedido já existentes |
| `voice.ordering` | Voice Ordering Agent | `lib/voice/orchestrator.ts` | Serviços atuais de voz e pedido |
| `manager.copilot` | Manager Copilot | `lib/intelligence/copilot-tools.ts` | Preview e confirmação pelo ActionEngine |
| `executive.copilot` | Executive Copilot | `lib/executive-command/core.ts` | Leitura, análise e recomendação |
| `support.copilot` | Support Copilot | `lib/saas-support.ts` | Rascunhos seguros de suporte |
| `operations.copilot` | Operations Copilot | `lib/observability/copilot-tools.ts` | Somente leitura operacional |
| `forecast.copilot` | Forecast Copilot | `lib/forecasting/copilot-tools.ts` | Recomendação baseada em previsão oficial |
| `data_governance.copilot` | Data Governance Copilot | `lib/data-governance/core.ts` | Rascunho, metadados e lineage |
| `finops.copilot` | FinOps Copilot | `lib/platform_finops/integrations.ts` | Simulação e recomendação |
| `policy.copilot` | Policy Copilot | `lib/policy_engine/integrations.ts` | Rascunho e simulação de políticas |

O registro não cria cópias desses agentes. Ele referencia suas identidades, versões, ferramentas, modelos, limites e evidências de avaliação.

## Fronteiras canônicas preservadas

- ActionEngine: único executor de escritas operacionais; agentes apenas produzem intenção tipada, preview e solicitação.
- Policy Engine (Fase 79): decide elegibilidade, bloqueios e obrigações; a governança de IA não replica sua linguagem de regras.
- KnowledgeAnswerService (Fase 68): único caminho de recuperação governada; ACL precede busca semântica e conteúdo recuperado é dado não confiável.
- Feature Management (Fase 77): rollout, kill switch, sticky assignment e rollback.
- Platform FinOps (Fase 78): autoridade para custos, budgets, anomalias e atribuição.
- Automation Center (Fase 50): agenda e dispara agentes em background; nenhum agente agenda a si mesmo.
- Incident Management (Fase 59): recebe candidatos e timeline; não existe segundo sistema de incidentes.
- Inbox/Support existente: recebe handoff humano; não foi criada outra caixa de atendimento.

## Riscos encontrados e decisão arquitetural

1. Prompts e seleção de modelos estavam distribuídos entre módulos. A Fase 80 adiciona registros versionados, sem migrar silenciosamente configurações ativas.
2. Copilots tinham maturidades distintas. Todos podem ser registrados, mas somente versões avaliadas e publicadas entram em rollout.
3. Acesso de tools precisava de um ponto comum. Foi criado `AIToolAuthorizationService` com default deny e interseção entre agente, ator, tenant, Policy Engine, feature e budget.
4. Memória irrestrita aumentaria risco de vazamento. Foram adotadas memória estruturada, escopos explícitos, TTL obrigatório para memória curta e autorização para persistência.
5. Multi-agent poderia amplificar custo e privilégio. Foram definidos limite de profundidade, filhos, contexto, budget compartilhado e detecção de ciclo.
6. Falha da camada de IA não pode interromper o negócio. O modo degradado mantém pedidos, pagamentos, cozinha e atendimento humano disponíveis.

## Decisões de segurança

- Sem raw SQL, HTTP arbitrário ou scripts em tools/workflows.
- Sem autonomia irrestrita (níveis 0 a 4 apenas).
- Sem autoalteração de prompt, permissões, autonomia, guardrails, budget ou versão.
- Sem armazenamento de chain-of-thought; somente resultados, fontes, decisões, hashes e telemetria redigida.
- Sem seed automático de agentes ativos, tools liberadas ou modelos aprovados.
- RLS, autorização privada, grants explícitos e views com `security_invoker`.
- A migration permanece pendente até autorização explícita de produção.
