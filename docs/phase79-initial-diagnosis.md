# Fase 79 — diagnóstico inicial do Policy Engine

## Fronteiras já existentes

| Capacidade atual | Fonte de verdade | Relação com o Policy Engine |
| --- | --- | --- |
| Execução operacional | ActionEngine / `copilot_action_requests` | Continua executando, confirmando, revalidando, desfazendo e auditando ações. A política entrega somente decisão e obrigações tipadas. |
| Aprovações humanas | `internal_approvals`, `internal_approval_steps` e `automation_approval_waits` | Continua roteando e resolvendo aprovações. A política pode produzir `require_approval`, nunca aprovar por conta própria. |
| Automação | Automation Center | Continua recebendo eventos e orquestrando passos. Pode consultar uma decisão publicada; não incorpora o interpretador nem publica políticas. |
| Billing e entitlements | `lib/saas-billing.ts` e RPCs de entitlement/usage | Permanecem autoritativos para plano, cobrança, limites e consumo. São somente facts de leitura. |
| Feature Management | `lib/feature-management/core.ts` | Permanece autoritativo para targeting, rollout, overrides e fallback. É fact de leitura, não regra duplicada. |
| Governança de rede | `lib/network_governance/core.ts` | Fornece a precedência organização → marca → região → cluster → loja e as restrições de override. O Policy Engine reaproveita o modelo de escopo sem substituir governança. |
| RBAC e segurança | `lib/security/core.ts`, membership e permissões de domínio | Autorização continua fora das políticas. Uma regra de negócio jamais concede uma permissão que o RBAC negou. |

## Candidatos encontrados

1. Aprovação de desconto em atendimento (`manager_approval_for_discount`) — piloto de aprovação de desconto.
2. Aprovação de cancelamento/reembolso (`manager_approval_for_cancellation`) — piloto de aprovação de reembolso, preservando invariantes do pedido e pagamento.
3. Elegibilidade de fornecedor — piloto de decisão antes da seleção, sem alterar cadastro, compliance ou pagamento.
4. Limite/aprovação de compra — piloto de decisão antes de criar a aprovação existente.
5. Override local de franquia — piloto governado por escopo, respeitando bloqueios centrais e prevalência da regra mais restritiva.
6. `discountDecision` do CRM — candidato futuro; não será migrado na primeira onda para evitar mudança comercial ampla.
7. `copilot_rule_definitions`, regras de IA e Automation Center — não migrar. São regras de orquestração/comportamento, não políticas de decisão de domínio.

## Classificação e estratégia

- **Migrar agora:** apenas os cinco pilotos, inicialmente como templates/drafts e adaptadores seguros.
- **Referenciar como facts:** entitlement, feature state, métrica semântica, atributos de entidade, contexto, data/hora e facts de domínio registrados.
- **Manter no domínio:** transições de estado, integridade financeira, estoque, pagamento, documento fiscal, permissões, limites contratuais e invariantes críticas.
- **Manter na execução:** efeitos operacionais, retries, idempotência, undo e compensação.
- **Manter na aprovação:** escolha de aprovador, quorum, SLA, escalonamento e resolução.

## Riscos e controles

- Nenhum JavaScript, SQL, `eval`, URL ou HTTP é aceito na definição.
- Operandos, operadores, efeitos e facts usam registros fechados, schemas versionados e valores tipados.
- Política de alto risco sem fact, teste ou aprovação falha fechada ou exige revisão manual.
- IA pode sugerir rascunho e explicação, mas não publicar.
- Decisões críticas têm log completo; alto volume usa amostragem/agregado para evitar auditoria por avaliação.
- Publicação exige changeset imutável, testes, análise de impacto, aprovação e versão do avaliador.
- Cache contém somente versões ativas e é invalidado por publicação; avaliação não consulta o banco por regra.
- Offline é permitido somente para políticas explicitamente marcadas como seguras, com decisão provisória e revalidação no servidor.

## Decisão arquitetural

O módulo será um **Policy Decision Point** tipado. Os domínios fornecem facts por adaptadores; o avaliador resolve versão, escopo, precedência, exceções e condições; devolve uma decisão explicável com obrigações. O chamador continua sendo o **Policy Enforcement Point** e encaminha obrigações ao Approval Engine ou ActionEngine. Assim a Fase 79 centraliza decisão sem criar um segundo executor, segundo sistema de permissões ou segunda automação.
