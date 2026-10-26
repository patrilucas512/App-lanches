# Fase 69 — Central de Integração com Marketplaces

## 1. Escopo entregue
Central provider-neutral para conexões, pedidos, catálogo, preços, disponibilidade, status, cancelamentos, conciliação, saúde e auditoria.

## 2. Arquitetura
O módulo especializa o Integration Hub da Fase 20 e não cria um sistema paralelo.

## 3. Invariantes preservadas
Order Service, catálogo central, delivery, financeiro e ActionEngine continuam soberanos.

## 4. Provedores
Somente APIs oficiais, documentadas e homologadas. Scraping é proibido.

## 5. Adapter
`MarketplaceProviderAdapter` padroniza conexão, catálogo, pedidos, status, finanças e saúde.

## 6. Capability matrix
Cada ação consulta a capacidade real; recurso ausente retorna `unsupported` sem simular sucesso.

## 7. Conexões
Conta, provedor, ambiente, políticas, cursor, watermark e circuit breaker ficam vinculados à organização.

## 8. Unidades
Uma conexão pode mapear várias lojas externas; uma unidade pode usar vários canais.

## 9. Credenciais
Tokens e segredo de webhook usam o Vault já existente. A interface não oferece “ver segredo”.

## 10. Webhooks
Assinatura HMAC, timestamp, antirreplay, limite de corpo, rate limit, deduplicação e resposta rápida `202`.

## 11. Payload protegido
O corpo bruto entra no Vault com referência e retenção. Logs guardam apenas metadados sanitizados e hash.

## 12. Fila de entrada
Eventos são persistidos antes do processamento e reclamados com `FOR UPDATE SKIP LOCKED`.

## 13. Idempotência
`connection_id + provider_event_id` e `connection_id + external_order_id` impedem duplicação.

## 14. Pedidos
O worker normaliza e chama exclusivamente `integration_create_order`; não insere diretamente em `orders`.

## 15. Identificadores
O vínculo conserva número interno, ID externo, display ID externo e snapshot de origem.

## 16. Snapshot
Snapshot normalizado e financeiro é imutável e referenciado pelo pedido.

## 17. Mapeamento de produtos
Prioridade: explícito, SKU, código de barras e referência externa. Nome é somente sugestão revisável.

## 18. Itens não mapeados
O pedido entra em revisão e não é aceito com produto inventado.

## 19. Catálogo
Itens externos são read model. `public.products` e a governança da Fase 62 permanecem fonte oficial.

## 20. Sincronização
Modos import, export e bidirecional controlado exigem prévia quando houver ambiguidade ou perda estrutural.

## 21. Preços
Usa preço efetivo do canal. Comissão não altera preço automaticamente; divergências viram drift.

## 22. Disponibilidade
É específica por canal. Provedor externo não desativa o catálogo mestre sem política explícita.

## 23. Capacidade
Fase 63 controla pausa e reabertura com suporte do adapter, política, cooldown e histerese.

## 24. Status
Mapeamento inbound/outbound é central. Estado desconhecido vai para revisão manual.

## 25. Aceite automático
Exige capability, mapeamentos, capacidade, pagamento, fulfillment e política habilitada.

## 26. Cancelamento
Saga: `cancel_requested → provider_pending → cancelled | cancel_failed | manual_review`. Nunca conclui antes da confirmação externa.

## 27. Financeiro
Extratos e repasses detalham comissão, entrega, pagamento, assinatura, promoção e ajustes, sem substituir o ledger.

## 28. Conciliação
Compara esperado e pago com tolerância configurável e preserva referência no financeiro oficial.

## 29. Resiliência
Backoff exponencial, Retry-After, dead letter, polling incremental, watermark e circuit breaker por conexão.

## 30. Modo degradado
Falha do provedor isola somente o canal; pedidos diretos do MasterApp permanecem ativos.

## 31. Segurança e privacidade
RLS, grants explícitos, service role no backend, minimização de cliente, sem desanonimização e sem inferir consentimento de marketing.

## 32. Governança
14 permissões, cinco feature flags, ações críticas via ActionEngine e auditoria imutável de decisões.

## 33. Experiência integrada
Rota `/painel/integracoes/marketplaces`, busca global, automações, Copiloto, notificações e links para conhecimento.

## 34. Validação e implantação
A suíte cobre 30 cenários obrigatórios. A migration e a publicação de produção só devem ocorrer após autorização explícita do proprietário.
