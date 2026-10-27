# Fase 44 — Operação Offline e Continuidade

## Diagnóstico de readiness

A aplicação já possuía PWA instalável, service worker de notificações, sessão autenticada, pedidos/comandas, salão, garçom, KDS, caixa, impressão, estoque, entrega, autoatendimento, idempotência pontual e auditorias por módulo. Faltavam: registro central de capacidades offline, armazenamento IndexedDB versionado, fila explícita, protocolo batch, idempotência transversal, ordenação de dependências, reconciliação, conflitos, monitoramento por dispositivo e UX persistente de conectividade.

O online continua como fonte de verdade. A Fase 44 não cria um OrderService paralelo: os comandos reconciliados escrevem nas entidades canônicas (`table_sessions`, `table_orders`, `table_order_items`, `kitchen_tickets`) e usam IDs UUID gerados no cliente.

## Matriz de segurança

- **Offline Safe:** catálogo/mesas cacheados, criar pedido e item com snapshot de preço, iniciar/concluir KDS monotonicamente, observação, impressão local.
- **Offline Conditional:** abrir/transferir mesa, dinheiro, declaração de maquininha externa não verificada, atualização de entrega, anexos. Exigem flag, snapshot e/ou reconciliação.
- **Online Required:** confirmação PIX, autorização de cartão online, reembolso, emissão fiscal dependente de provider, fechamento final de caixa, nova rota externa, login novo e administração crítica.

A matriz executável está em `OfflineCapabilityRegistry`; não existem `if (!online)` espalhados pelas regras de domínio.

## Entregas

- `ConnectivityService` via health ping real com estados online, instável, offline e reconectando; banner não bloqueante em toda a aplicação.
- `LocalOperationalStore` com IndexedDB, stores versionados, índices por status/loja/data, snapshots com versão/expiração e medição de quota.
- command model único, `OfflineCommandBus` funcional (`createOfflineCommand` + queue), UUID definitivo e idempotency key.
- ordenação topológica, lotes limitados, backoff exponencial, falha por item e fila preservada.
- endpoints dedicados `GET/POST /api/offline` e `GET /api/health`; snapshot incremental por escopo ativo, dashboard, heartbeat, batch sync e resolução auditada.
- idempotency store do servidor e retorno por mutation: applied, duplicate, conflict, rejected, retryable_error.
- preço preservado por snapshot/política; mudança configurada para revisão do supervisor. Status de cozinha não regride.
- dinheiro e maquininha externa ficam `pending_reconciliation`; PIX/cartão online nunca são inferidos como pagos.
- service worker v44: app shell versionado, GET seguro com fallback; mutations críticas não são interceptadas de forma opaca.
- Central de Continuidade em `/painel/continuidade`: saúde, sync, conflitos, dispositivos, readiness, limitações e matriz.
- banco: dispositivos, mutations, conflitos, declarações de caixa, anexos, conectividade e auditoria. RLS ativada, acesso somente por backend service role, índices de filtros/FKs.
- feature flags e entitlements preparados para operação, pedidos, KDS, caixa e delivery offline.
- métricas semânticas: duração offline, pendências, taxa de sucesso, atraso médio, conflitos e disponibilidade.
- permissões: view, manage, resolve conflicts, retry, reset e configure. Apenas owner/manager resolvem conflitos.

## Segurança e privacidade

O cache é isolado por `store_id`; cada mutation também carrega organization/store/device/user. O servidor rejeita escopo divergente. Não há token, segredo, cartão ou payload sensível em telemetria. PII local é mínima. Sessão offline não é renovada; `auth_valid_until` permite grace period futura e a fila não é apagada durante reautenticação. Remote wipe só pode acontecer na próxima conexão.

## Testes de falha

O contrato automatizado cobre os 30 casos obrigatórios: detecção, degraded, snapshot, pedido/UUID, fila/dependências, reconnect, duplicação, falha parcial, monotonicidade, conflitos, preço, caixa, KDS, entrega, anexos/quota, SW, migration local, auth/reauth, force sync, decisão, auditoria, permissões e isolamento.

## Limitações honestas

- Sem backend, dois dispositivos separados não recebem eventos um do outro; um hub LAN não foi implementado.
- Checkout do kiosk continua online, exceto navegação/cache e a opção explicitamente segura de pagar no caixa quando configurada.
- Estoque local é estimativa; o backend permanece source of truth e movimentos derivados precisam ser idempotentes.
- Background Sync é melhoria progressiva, não requisito para recuperar a fila; a sincronização também ocorre na abertura/reconexão.
- Limpar manualmente dados do navegador antes do sync pode perder operações; a UI sinaliza pendências e a política de reset exige supervisão.
- Regras fiscais e autorização offline de adquirente não foram presumidas.

## Arquivos principais

`lib/offline/core.ts`, `lib/offline/store.ts`, `components/connectivity-banner.tsx`, `components/continuity-center.tsx`, `app/api/health/route.ts`, `app/api/offline/route.ts`, `app/painel/continuidade/page.tsx`, `app/continuity.css`, `public/push-sw.js`, migration `20261022040000_phase44_offline_continuity.sql` e teste `offline-continuity-phase44.test.mjs`.

## Recomendações para a Fase 45

Validar um piloto por unidade e dispositivo; avaliar hub local somente após dados reais; adicionar compactação segura apenas para drafts; integrar provider oficial de cartão offline se houver suporte contratado; configurar retenção por perfil e exercitar recuperação antes de expandir a cobertura. Nenhuma Fase 45 foi iniciada.
