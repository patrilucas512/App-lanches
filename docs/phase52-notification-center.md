# Fase 52 — Central de Notificações

## 1. Resumo executivo
Caixa operacional unificada para eventos do MasterApp, com origem preservada e separação entre domínio do cliente e plataforma.

## 2. Diagnóstico do legado
`internal_notifications`, alertas, aprovações, tarefas e módulos operacionais continuam sendo fontes oficiais. A nova caixa referencia essas fontes.

## 3. Arquitetura
Registro de eventos → resolução de destinatários → deduplicação/agrupamento → inbox durável → canais externos independentes → auditoria e analytics.

## 4. Modelo de dados
Inclui itens, fontes, grupos, threads, políticas, preferências, entregas, falhas, digests, escalonamentos, templates, visões salvas, auditoria e fatos.

## 5. Registro de fontes
Catálogo versionado e explícito para pedidos, pagamentos, estoque, aprovações, segurança, automação e atenção executiva.

## 6. Resolução de destinatários
Aceita usuário, papel ou equipe; acesso final continua limitado por organização, unidade e associação ativa.

## 7. Deduplicação
Chave determinística por evento, origem e destinatário; repetições incrementam ocorrência e atualizam a última ocorrência.

## 8. Agrupamento
Grupos e threads permitem condensar ruído sem apagar eventos críticos individuais.

## 9. Priorização
Cinco níveis: informativa, baixa, média, alta e crítica, com índice específico para itens que exigem atenção.

## 10. Estados
Não lida, lida, reconhecida, em andamento, adiada, resolvida, descartada e expirada.

## 11. Atribuição e claim
Itens podem ser atribuídos e assumidos; o claim usa atualização condicional para impedir corrida entre operadores.

## 12. Snooze
Adiamento é limitado e proibido para alertas críticos ou obrigatórios.

## 13. Escalonamento
Worker aplica SLA por prioridade, registra histórico e encerra após três níveis operacionais.

## 14. Canais
Inbox é sempre durável. E-mail, push e WhatsApp usam fila separada com tentativas, backoff e dead letter.

## 15. Preferências
Usuário configura canais, resumo, limiar, fuso e horário silencioso; regras obrigatórias têm precedência.

## 16. Digests
Estrutura para resumos diários, semanais ou personalizados com período e estado de envio.

## 17. Templates
Templates versionados, localizados e protegidos contra conteúdo executável.

## 18. Interface
Sete visões, filtros, seleção em lote, cards responsivos, ação contextual e estados vazios.

## 19. Sino global
Badge separado para não lidas e itens que exigem ação, com Realtime e consulta periódica de contingência.

## 20. Integrações
Automação legada é sincronizada por trigger; busca global ganha navegação e comandos para críticas e aprovações.

## 21. ActionEngine
Criar tarefa é explícito e auditado. Encerrar na caixa nunca altera nem resolve a entidade operacional de origem.

## 22. IA
Ferramentas somente de consulta, resumo, explicação e rascunho. Nenhuma confirmação, resolução ou execução autônoma.

## 23. Segurança
RLS, escopo por tenant/unidade, rotas internas, payload redigido, templates seguros e ações administrativas no servidor.

## 24. Observabilidade
Correlation ID, auditoria, fatos analíticos, fila de falhas, métricas por hora e estado de entrega.

## 25. Testes
Cobertura estrutural para isolamento, dedup, Realtime, claim, snooze crítico, canais, UI, permissões e origem imutável.

## 26. Limites desta fase
Não inicia a Fase 53. Adaptadores reais de provedores externos continuam desacoplados e podem consumir a fila durável sem afetar a inbox.
