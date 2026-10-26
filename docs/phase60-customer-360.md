# Fase 60 — Customer 360 Avançado

## 1. Diagnóstico inicial

O cadastro canônico permanece em `customers`; pedidos, fidelidade, CRM, suporte, reservas, assinaturas, portal e omnichannel já possuíam fontes próprias. A Fase 60 foi desenhada como leitura consolidada e inteligência derivada, sem um segundo CRM.

## 2. Arquitetura Customer 360

A solução tem API autenticada, resumos derivados, timeline indexada, worker idempotente e interface por abas. Toda resposta informa escopo, atualização e preserva links conceituais para a fonte oficial.

## 3. Arquivos criados

Foram criados o núcleo `lib/customer-360/core.ts`, API e worker, componente visual, página e CSS, migration, testes e este relatório.

## 4. Arquivos modificados

O menu do painel recebeu “Clientes · Perfil 360”, o Copiloto recebeu oito ferramentas somente leitura e o pacote recebeu o comando `test:phase60`.

## 5. Migrations

A migration `20261024042537_phase60_customer_360.sql` adiciona flags, permissões, registros derivados, timeline, saúde, ações, fatos, dimensões e integrações. Ela foi preparada, mas não aplicada em produção nesta entrega.

## 6. Profile summary

O resumo mostra identidade com mascaramento, lifecycle, saúde, pedidos, receita histórica, ticket, recência, cadência, fidelidade, suporte e assinaturas. Receita é rotulada como receita, não lucro.

## 7. Timeline

A timeline usa índice incremental com paginação por cursor, resumo seguro e metadados filtrados. Conteúdo integral de conversas não é duplicado.

## 8. Identity resolution

Identidades existentes de WhatsApp, telefone, e-mail, portal e web chat são reutilizadas. Candidatos de identidade ficam pendentes para revisão humana.

## 9. Merge service

O serviço reutiliza `preview_customer_merge`, `merge_customers_omnichannel` e o log canônico `customer_merge_audit`. Exige permissão, preview, motivo e confirmação; mantém snapshot para unmerge.

## 10. Preferences

Preferências declaradas ou registradas são separadas de padrões observados. Afinidade de produto é contada pelo código canônico e rotulada como observação, nunca como gosto definitivo.

## 11. Relationship metrics

Recência, frequência, receita histórica, ticket e cadência derivam de pedidos concluídos. Os cálculos reutilizam pedidos e não alteram faturamento ou financeiro.

## 12. Lifecycle

Os estágios suportados são prospect, novo, recorrente, fiel, inativo e recuperado, com regra versionada e histórico de transição.

## 13. Customer health

A primeira versão é determinística e explicável: dados insuficientes, saudável, atenção, em risco ou inativo. Motivos são mostrados, sinais sensíveis são proibidos e nenhuma verdade absoluta é declarada.

## 14. Next best action

As sugestões são explicáveis e nunca disparam envio automático. Reclamação ou recuperação aberta prioriza atendimento; opt-out, horário silencioso e limite de frequência bloqueiam marketing.

## 15. Orders/Loyalty/Reservations integration

Pedidos, itens, loyalty ledger, reservas e assinaturas continuam em suas tabelas canônicas. O Perfil 360 apenas consulta e agrega.

## 16. Support/CX integration

Solicitações de suporte, feedback e conversas aparecem somente para quem possui permissão. Caso aberto impede sugestão promocional incompatível.

## 17. Marketing integration

Tags, segmentos, campanhas e consentimentos continuam no CRM. A Fase 60 pode adicionar tag pela fonte canônica, sem criar motor paralelo.

## 18. Omnichannel integration

Conversas e identidades da Fase 12 são reutilizadas. A interface mostra prévias autorizadas; o histórico completo permanece no atendimento.

## 19. Portal integration

Preferências de notificação e solicitações LGPD vêm do portal do cliente. Atualização de consentimento é online, auditada e opt-out é imediato.

## 20. Reporting/Workspace integration

Quatro datasets, oito métricas semânticas, seis templates de relatório e widgets de workspace foram registrados com granularidade e atualização declaradas.

## 21. Automation/Notification integration

Eventos de saúde, lifecycle e consentimento entram nos registros existentes. Ações usam tarefa oficial ou Action Engine; não há envio comercial direto pela nova API.

## 22. AI Customer Copilot

O Copiloto recebeu oito ferramentas de leitura. A resposta separa fatos, hipóteses e sugestões e orienta consulta à fonte. Não autoriza mesclagem, mensagem ou decisão automática.

## 23. Data Platform

Foram adicionados fatos de relacionamento, interações, saúde, lifecycle e merges, além de dimensões controladas. Freshness e data-as-of fazem parte dos resumos.

## 24. Privacy/LGPD

Minimização, mascaramento, consentimento, solicitações de acesso/correção/exclusão e proibição de inferência sensível foram incorporados. Timeline completa e PII desnecessária não são cacheadas.

## 25. Security/RBAC

Existem dez permissões granulares, escopo por unidade/rede e verificação de membership. As tabelas novas ativam RLS, revogam acesso público/anônimo/autenticado e concedem acesso operacional apenas ao service role da API autorizada.

## 26. Audit

Preview e execução de merge, alterações de preferência/consentimento, notas e tarefas geram eventos com ator, motivo e correlação. Visualização comum não gera ruído de auditoria.

## 27. Observability

Jobs têm estado, lease, tentativas, backoff, erro e dead-letter. Respostas expõem freshness e consistência eventual; fontes canônicas não são reescritas pelo worker.

## 28. Tests

A suíte possui os 30 cenários obrigatórios: perfil, agregação, timeline, integrações, preferências, afinidade, RFM, saúde, guardrails, identidade, escopos, consentimento, permissões, mascaramento, auditoria, cache, performance e isolamento.

## 29. Limitations

A timeline depende do preenchimento incremental do índice; dados históricos anteriores precisam de backfill controlado. Modelos probabilísticos e resumo por IA ficam desligados sem dados, validação e governança suficientes. Offline permite apenas resumo mínimo quando a política autorizar.

## 30. Recommendations for Phase 61

Não foi iniciada. Quando autorizada, a próxima fase deve começar pela validação de dados, política de retenção, backfill observável, SLOs de freshness e avaliação humana de qualidade antes de qualquer ampliação preditiva.
