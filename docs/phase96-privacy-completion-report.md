# Fase 96 — Privacy Operations: conclusão, cobertura total e prontidão para uso real

Esta fase não cria um módulo novo. Ela completa e endurece a Fase 95, fechando as cinco recomendações do relatório da 95. O módulo continua sendo ferramenta de operação, não aconselhamento jurídico.

## 1. O que mudou em relação à 95

| Antes (95) | Agora (96) |
|---|---|
| Seis domínios eram passos manuais | Todos os domínios com dado pessoal têm adapter. Ficam manuais, com motivo, só o parceiro de marketplace sem API e as gravações sem bucket conhecido |
| Prazos e aprovações vinham das configurações | Vêm das políticas `privacy.*` da Fase 79, com as configurações da 95 como reserva |
| Quem pedia não aprovava | Quem pede, quem aprova e quem executa são três pessoas diferentes, e a Fase 79 pode exigir mais de uma aprovação |
| Decisões por `prompt` e `confirm` do navegador | Formulários próprios e acessíveis |
| Retenção só de clientes inativos, executada numa chamada só | Também mensagens e voz; execução em lotes retomáveis, continuada pelo worker |
| Ligar o módulo era ligar uma flag | Checklist de go-live, que o banco também exige, com uma flag nova só para a preparação |

Durante os testes apareceram e foram corrigidos quatro erros:

- **Hash repetido:** o hash de anonimização não era idempotente, porque aplicava o hash sobre o pseudônimo de novo.
- **Transcrição de voz:** a exclusão a pedido do titular não anonimizava a transcrição da ligação.
- **Pacote de acesso:** a remoção falhava ao zerar uma coluna obrigatória; agora a linha do pacote é apagada junto com o arquivo.
- **Lentidão:** a retenção estourava o tempo de uma requisição; agora roda em lotes, com consultas em paralelo.

## 2. Adapters

**Implementados** (localizar → prévia → executar → verificar → evidência):

| Domínio | O que sai | O que fica por lei, e como |
|---|---|---|
| Funcionários (Fase 18) | Nome, telefone e observações (o cadastro fica anônimo), disponibilidade, preferências de aviso, foto (Storage) | Escalas, ponto, documentos, avaliações e feedback (trabalhista), ligados ao cadastro anônimo. Movimentos de caixa ficam, com o nome do operador anonimizado |
| Entregadores (Fases 5–11, 40) | Telefone (vira pseudônimo), placa, modelo, final do CPF, links de acesso, histórico de localização | Comprovantes de entrega, lançamentos e fechamentos financeiros, ligados ao perfil anônimo. O hash do CPF fica para os repasses |
| Leads (Fase 29, contexto MasterApp) | Nome, e-mail, telefone, cidade, notas, origem; contatos com o mesmo e-mail | Aceite de proposta (contrato), que não é tocado |
| Data Platform (Fase 34) | Linha do cliente em `analytics_customer_360`; a dimensão do cliente fica marcada como anonimizada | Fatos diários (pedidos, receita), que nunca tiveram nome ou telefone. Totais preservados |
| Storage | Foto do funcionário (`product-images`) e pacotes de acesso antigos (`privacy-exports`) | Arquivos fiscais e financeiros, e qualquer arquivo sob bloqueio legal. A evidência guarda o bucket e o hash do caminho, nunca o nome ou o conteúdo |
| Marketplaces (Fase 69) | Campos do cliente no snapshot do pedido | O pedido e o financeiro do parceiro |
| Mensagens (omnichannel) | Conteúdo de `normalized_messages` (além do WhatsApp, que já existia) | Linhas e datas, para os relatórios |
| Voz | Transcrição da ligação (além dos dados do chamador) | Métricas da ligação |

**Manuais, com motivo:**
- **Parceiro de marketplace:** nenhum provedor tem API de exclusão. O passo traz instruções, e a solicitação fica "atendida em parte" até alguém confirmar o protocolo.
- **Gravações de voz com caminho mas sem bucket nas migrations:** hoje o código não grava áudio. Se aparecer um caminho, ele vira passo manual.

## 3. Policy Engine (Fase 79)

`lib/privacy-operations/policies.ts` lê as políticas ativas `privacy.*` em `policy_active_documents`. Criar, versionar, aprovar, testar e auditar continua sendo papel da Fase 79.

| Chave | O que governa | Reserva (Fase 95) |
|---|---|---|
| `privacy.dsr_deadline` | Prazo por tipo de solicitação (limite em dias) | `dsr_deadline_days` |
| `privacy.dsr_alert` | Dias de alerta antes do prazo | `dsr_alert_days_before` |
| `privacy.deletion_approval` | Número de aprovações; se o executor pode ser quem aprovou ou quem pediu | 1 aprovação, três pessoas diferentes |
| `privacy.identity_verification` | Exigir revisão manual para um tipo de pedido (só pode aumentar o nível) | Código no contato cadastrado |
| `privacy.retention_action` | Exigir aprovação da retenção | `retention_requires_approval` |
| `privacy.dpia_required` | Quando a RIPD é obrigatória | Gatilhos das configurações |
| `privacy.incident_notification_deadline` | Prazo de comunicação de incidente | Vazio até o encarregado definir |

Detalhes:

- **Origem do prazo:** cada solicitação registra se o prazo veio de uma política (id e versão) ou das configurações.
- **Sem acesso às políticas:** se a leitura delas falha, valem as configurações (teste T07).
- **Modelos:** em **Configurações → Políticas (Fase 79)** a tela baixa modelos que reproduzem os valores atuais, para o encarregado publicar pela Fase 79.
- **Prévia do impacto:** a ação `policy_impact` mostra quantas solicitações abertas mudariam de prazo, e quantas ficariam com prazo mais curto.

## 4. Decisão sobre o ActionEngine

A decisão foi manter `internal_approvals` e não usar `copilot_action_requests` (`PRIVACY_ACTION_ENGINE_DECISION`, teste T09). Motivos:

- a lista de ações é fixa, de ações operacionais ligadas ao Copiloto e à Governança de Acessos;
- ele tem uma operação de desfazer, que não existe numa exclusão;
- o uso natural do `before_state` guardaria os dados apagados.

A trilha de privacidade guarda só contagens, domínios, IDs e hashes; o teste T09 confirma que nenhum valor pessoal aparece nela.

**Dívida técnica:** se o ActionEngine ganhar um modo redigido garantido no banco, avaliar a migração.

## 5. Interface

- **Diálogo próprio:** `components/privacy-decision-dialog.tsx` substitui os 18 `prompt` e `confirm`.
  - `role="dialog"` com `aria-modal`, título e descrição ligados ao conteúdo;
  - o foco fica preso no diálogo, Esc fecha e o foco volta ao botão de origem (conferido no app);
  - campos com rótulo e motivo obrigatório com mínimo de caracteres; os erros são anunciados (`role="alert"`).
- **Confirmação de exclusão:** mostra o resumo da prévia (apagar, anonimizar, manter por lei, passos manuais) e exige digitar **EXCLUIR** quando a execução passa de 20 registros.
- **Formulários novos:** avaliação de incidente (dados pessoais, estimativa, risco, contenção), decisão de comunicação (ANPD e titulares, com fundamento), parecer do encarregado, aprovação e recusa com motivo.
- **Celular:** a tela e o diálogo foram conferidos na largura de celular. O portal do titular não usa diálogos do navegador.

## 6. Executores de retenção

| Conjunto | O que a execução faz | O que fica |
|---|---|---|
| `inactive_customers` | Prévia e execução por cliente, como na 95, agora em lotes de 25 (5 em paralelo), retomáveis | Pedidos e totais |
| `messages` | Troca o conteúdo de `whatsapp_messages` e `normalized_messages` por "[removido pela política de retenção]" | Linhas, datas e canal |
| `voice_calls` | Telefone do chamador vira pseudônimo, nome e resumo saem, a transcrição é removida | Ligações e métricas |

Regras:

- **Bloqueio legal:** um bloqueio por conjunto, por titular ou por caso (a conversa ou a ligação) preserva os registros.
- **Simulação:** a simulação não altera nada.
- **Execução real:** exige a flag e a aprovação, e quem executa não pode ter aprovado nem pedido.
- **Relatório:** cada execução gera o seu.
- **Sem executor:** uma política sobre um conjunto sem executor só é aceita com o motivo registrado, e o relatório da execução repete esse motivo.

## 7. Checklist de go-live

Fica em **Configurações → Ativação nesta loja**, com ✅/❌ por item:

| Item | Obrigatório |
|---|---|
| Textos de consentimento redigidos e aprovados | Sim |
| Prazos validados pelo encarregado | Sim |
| Encarregado nomeado com `privacy:dpo` | Sim |
| Canal do código de verificação (WhatsApp conectado) | Sim |
| Teste de solicitação de acesso feito | Sim |
| Suboperadores revisados no último ano | Não |
| Políticas de retenção ativas | Não |

Como a ativação funciona:

- **Flag de preparação:** `privacy_setup_enabled` abre só a configuração; os clientes não são afetados.
- **Ativação:** `privacy_operations_enabled` só é ligado pelo botão.
  - Com item obrigatório pendente, a exceção é só para quem tem `privacy:dpo`, com motivo de pelo menos 20 caracteres.
  - O gatilho `privacy_require_go_live` recusa a flag sem um registro de go-live recente e ainda não usado, por qualquer caminho.
- **Flag do plano:** uma flag de privacidade no plano agora só abre a configuração. Não liga o módulo para clientes nem o worker.

## 8. Pacote do encarregado e roteiro de ativação

- **Pacote:** `docs/privacy-dpo-validation-pack.md`, com 8 blocos e campos de decisão.
  - Na tela, **Relatórios → Baixar pacote do encarregado** gera a versão com os valores atuais da loja.
- **Roteiro:** `docs/privacy-rollout-runbook.md`, com:
  - preparação da loja piloto, ativação e worker (Vault e `pg_cron`);
  - o que monitorar e como desligar.
  - Os passos que precisam de aprovação estão marcados com 🔒. Nada foi executado em produção.

## 9. Verificações no dev (masterapp-dev)

Feitas com dados fictícios na loja `lanchonete-teste`, com 50 mil clientes "Volume Teste" criados para o teste de volume.

| Verificação | Resultado |
|---|---|
| Download do pacote de acesso pelo Storage real | Link assinado gerado, download com status 200, JSON válido com os domínios |
| Exclusão a pedido do titular | Prévia em 1,6 s com 50 mil clientes na loja. Execução em 8,6 s. A primeira execução achou o erro do pacote de acesso; depois da correção, retomar o plano concluiu o passo do Storage com evidência só em hash |
| Simulação de retenção (200 vencidos por janela) | 0,96 s; nenhum dado alterado |
| Retenção real, primeira versão | Cerca de 3 s por cliente; uma chamada estourava o tempo |
| Retenção real, depois das correções | Lotes de 25 clientes em 14 a 20 s (menos de 1 s por cliente). Uma interrupção real (reinício do servidor) foi retomada sem processar ninguém duas vezes: 145 clientes processados, nenhuma falha, nenhum telefone em claro |
| Worker por agendamento | Agendamento local, três rodadas a cada 30 s: cada rodada continuou um lote. Sem token, 401 |
| Tela | Checklist com ✅/❌, diálogo próprio na largura de celular, validação de motivo, Esc e retorno do foco |

As configurações usadas só no teste (autoaprovação e execução real de retenção) foram desligadas no fim, e a execução de volume foi encerrada.

## 10. Migrations

Aplicadas só no **masterapp-dev**:

| Arquivo | Versão no dev | Conteúdo |
|---|---|---|
| `20261103130000_phase96a_adapters_coverage` | `20261103073107` | Guarda legal `labor` e `delivery_proof`; `evidence` nos passos; 24 campos novos no mapa |
| `20261103131000_phase96e_retention_messages_voice` | `20261103073348` | `no_executor_reason` com restrição para conjuntos sem executor |
| `20261103132000_phase96f_go_live` | `20261103073414` | Flag `privacy_setup_enabled` (desligada); `privacy_go_live_records`; gatilho `privacy_require_go_live` |

Tabelas novas com RLS, sem acesso para `anon` e `authenticated`, como na 95.

## 11. Testes

- `tests/privacy-completion-phase96.test.mjs` tem 18 testes, cobrindo os 17 obrigatórios e mais o da remoção do pacote de acesso.
- `tests/privacy-operations-phase95.test.mjs`: os 25 testes continuam passando.
  - Dois foram ajustados: quem executa agora é uma terceira pessoa, e um cliente comum não tem mais passos manuais.
  - O T12 passou a reexecutar cada passo e conferir que nada muda.
- Lint dos arquivos alterados sem erros, `typecheck:ci` sem erros novos e `migration-safety` ok.

## 12. O que não foi verificado

- **Worker pelo `pg_cron` e pelo Vault:** a gravação do segredo no Vault do dev foi bloqueada pela permissão automática. O worker foi testado pelo outro caminho que ele aceita (segredo em variável de ambiente, no servidor local) e por agendamento local, porque o `pg_cron` do Supabase não alcança a máquina local.
- **Envio do código por WhatsApp:** o dev não tem conexão.
- **Central do titular no portal:** o login do portal exige WhatsApp.
- **API de exclusão de marketplace:** nenhum parceiro oferece.
- **Retenção de 50 mil clientes até o fim:** foram processados 145, e o resto segue no mesmo ritmo, em lotes.

## 13. O que precisa de aprovação para ir a produção

1. ~~Aplicar as 3 migrations da 96 em produção.~~ Feito em 2026-11-03, depois do merge do PR #25, com versões `20261103231311`, `20261103231333` e `20261103231336`.
2. Publicar o app (merge do PR).
3. Ligar `privacy_setup_enabled` na loja piloto.
4. Criar `privacy_worker_secret` no Vault e o job no `pg_cron`.
5. Ligar `privacy_operations_enabled` pelo checklist; depois, se for o caso, `privacy_dsr_portal_enabled` e a execução real de retenção.
6. O encarregado preencher o pacote de validação.

## 14. Limitações

- A retenção de clientes ainda faz prévia e execução por cliente: cerca de 0,6 a 0,8 s por cliente, o que daria umas 10 horas de worker para 50 mil.
- Os documentos de funcionário e as evidências do transporte (Fase 73) não têm bucket nas migrations; ficam como registro trabalhista e de entrega.
- A prévia do impacto de política cobre o prazo de solicitações; as outras políticas não têm prévia de impacto.
- Não há tokenização reversível.

## 15. Recomendações para a Fase 97

1. Executor em massa para a retenção de clientes (atualização por lotes no banco, com a mesma verificação).
2. Testar o worker pelo `pg_cron` e pelo Vault num ambiente publicado que não seja produção.
3. Prévia de impacto para as demais políticas `privacy.*`.
4. Bucket e adapter para documentos de funcionário e evidências de entrega, se passarem a ser gravados.
5. Ativação na loja piloto seguindo o roteiro, com a validação do encarregado.
