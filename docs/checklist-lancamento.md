# Checklist de lançamento (Fase 99)

**Loja piloto: MARIAH EL LANCHES** (`app-lanches`, já em produção).

✅ feito · ⬜ falta. Situação em 05/11/2026. "Dono" é o dono do MasterApp; "Loja" é o dono da loja piloto.
Toda escrita em produção precisa de aprovação do dono, uma por vez, depois do merge.

## Código e testes

| Item | Situação | Responsável |
|---|---|---|
| Trava de módulo em todas as APIs de módulo, com teste que varre as rotas (99A) | ✅ | Claude |
| Leitura do plano correta no superadmin e nas APIs de apps, integrações e OAuth (99B) | ✅ | Claude |
| Funções SECURITY DEFINER sem uso fechadas para `anon`/`authenticated` (99D) | ✅ no código e no dev | Claude |
| "Alinhar loja ao plano" com prévia e proteção de módulos usados (99C) | ✅ no código e no dev | Claude |
| Registro de erros do app e alerta de taxa de erro (99G) | ✅ no código e no dev | Claude |
| "Relatar problema" e Painel do piloto (99H) | ✅ no código e no dev | Claude |
| CI não publica `error-context.md` | ✅ | Claude |
| Fluxos completos de ponta a ponta (99E), com 5 defeitos corrigidos | ✅ no build local + dev; ⬜ na homologação | Claude |
| CSS separado, contraste e letras do cardápio (99F) | ✅ | Claude |
| Lighthouse no celular (meta: desempenho 80, acessibilidade 95) | ⬜ falta a homologação | Claude |
| Lint, typecheck e testes unitários passando | ✅ 128 testes unitários; lint sem erros | Claude |
| Revisão e merge do PR da Fase 99 | ✅ PR #32 mesclado e publicado em 05/11/2026 | Dono aprovou |

## Produção (cada item com aprovação separada)

| Item | Situação | Responsável |
|---|---|---|
| Migrations da Fase 98 (98A, 98B piloto, 98D, 98F, 98G lotes 1 e 2, 98I) | ✅ aplicadas em 05/11/2026 | Dono aprovou |
| Agendamento dos alertas do piloto (`masterapp-pilot-alerts`) | ✅ desde 05/11/2026 | Dono aprovou |
| Limpeza do plano Básico (`20261104132000_phase98b_plan_cleanup`) | ✅ aplicada em 05/11/2026 (`20261105075337`) | Dono aprovou |
| Migrations 99E (mesa, pedido pela equipe, motoboy, entrega em loja nova) | ✅ aplicadas em 05/11/2026 | Dono aprovou |
| Migration 99D (funções restantes) | ✅ aplicada em 05/11/2026 | Dono aprovou |
| Migration 99C (alinhar loja ao plano) | ✅ aplicada em 05/11/2026 | Dono aprovou |
| Migration 99G (registro de erros) | ✅ aplicada em 05/11/2026 | Dono aprovou |
| Trocar o agendamento para `evaluate_pilot_alerts_and_purge` | ✅ feito em 05/11/2026 | Dono aprovou |
| Migration 99H (relatar problema e painel do piloto) | ✅ aplicada em 05/11/2026 | Dono aprovou |
| Alinhar a MARIAH EL LANCHES ao plano, a partir da prévia | ✅ 161 módulos desligados, financeiro mantido | Dono aprovou |
| Vincular a MARIAH EL LANCHES ao plano Piloto | ✅ feito em 05/11/2026 | Dono aprovou |
| Par de chaves VAPID (push) | ⬜ | Dono |

## Ambiente de homologação

| Item | Situação | Responsável |
|---|---|---|
| Segredos do GitHub para o `e2e-core` (usuários de teste e chave do dev) | ⬜ | Dono |
| `SUPABASE_SECRET_KEY` no ambiente Preview da Vercel | ⬜ | Dono |
| Protection bypass da Vercel para os testes | ⬜ | Dono |
| Segredos do Vault no dev para os workers | ⬜ | Dono |

## Antes do dia 1

| Item | Situação | Responsável |
|---|---|---|
| Termos de uso e política de privacidade publicados | ⬜ | Dono (jurídico) |
| Canal de contato do titular de dados | ⬜ | Dono |
| Forma de pagamento do piloto definida | ⬜ | Dono e Loja |
| Cadastro da loja, cardápio, zona de entrega, terminal de caixa e equipe (runbook, seção 2) | ⬜ | Loja |
| Teste de fumaça em produção (runbook, seção 3) | ⬜ | Loja |
| Checklist do dia 1 (runbook, seção 8) | ⬜ | Dono e Loja |

## Depois do lançamento

| Item | Situação | Responsável |
|---|---|---|
| Itens de privacidade da Fase 96 (encarregado, validação do DPO) | ⬜ não bloqueia | Dono |
| Limite de mensagens do chat web na rota (o da 98G não vale porque o servidor chama como service_role) | ⬜ | Claude |
| Critérios de aprovação do piloto (runbook, seção 11) | ⬜ | Dono |
