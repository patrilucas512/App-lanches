# Fase 43 — Autoatendimento, totens e retirada

## Diagnóstico inicial

O MasterApp já possuía catálogo oficial (`categories`, `products`, adicionais), `place_public_order_v2`, pagamentos Mercado Pago/Pagar.me, pedidos, KDS, expedição, loyalty, promoções, estoque, realtime, impressão e PWA. A fase foi construída como uma nova origem de pedido (`kiosk`) sobre esses serviços; não foi criado catálogo, pedido, KDS ou financeiro paralelo.

## Entrega

- Painel administrativo em `/painel/autoatendimento`, com visão geral, dispositivos, retirada, analytics e configuração remota.
- Modo touch em `/autoatendimento`, sem navegação nem sessão administrativa.
- Painel público em `/retirada/[slug]`, com listas de preparo/prontos, realtime com polling de fallback e chamada por voz.
- Registro seguro por código temporário de uso único, token de dispositivo armazenado apenas como hash, revogação, manutenção e escopos mínimos.
- Sessão com expiração, auto reset e limpeza de dados locais após conclusão.
- Catálogo oficial com disponibilidade real; carrinho e checkout recalculados no backend.
- PIX conectado ao fluxo Mercado Pago já existente; cartão isolado pela interface `KioskPaymentTerminalProvider`; pagamento local nunca é tratado como aprovação bancária.
- Pedido criado pelo serviço oficial, origem `kiosk`, senha de retirada, KDS/expedição e auditoria.
- Health/heartbeat, versão de app/config, status de terminal/impressora e erros técnicos sem cartão/PII.
- Métricas semânticas de conversão, ticket, abandono, sucesso de pagamento, duração, participação e espera.
- ActionEngine limitado a ativar/desativar, manutenção, atualizar configuração, pausar canal e revogar dispositivo; nenhuma ação de reembolso, preço, conta bancária ou aprovação de pagamento.

## Arquivos criados

- `supabase/migrations/20261022030000_phase43_self_service_kiosks.sql`
- `supabase/migrations/20261022030100_phase43_security_and_fk_indexes.sql`
- `lib/self_service/core.ts`
- `app/api/self-service/route.ts`
- `components/self-service-manager.tsx`
- `components/kiosk-app.tsx`
- `components/pickup-display.tsx`
- `app/painel/autoatendimento/page.tsx`
- `app/painel/autoatendimento/self-service.css`
- `app/autoatendimento/page.tsx`
- `app/autoatendimento/kiosk.css`
- `app/retirada/[slug]/page.tsx`
- `app/retirada/[slug]/pickup.css`
- `tests/self-service-kiosks-phase43.test.mjs`

## Arquivos modificados

- `components/dashboard-shell.tsx`: item Autoatendimento e entitlement.
- `lib/dashboard.ts`: entitlements da Fase 43 no contexto do plano.
- `package.json`: comando de teste dedicado.

## Banco, segurança e auditoria

As tabelas usam `organization_id` e `store_id`, RLS, grants mínimos, índices de escopo/estado e políticas de leitura por função. Dispositivo não usa login administrativo; o segredo bruto nunca é persistido. O endpoint server-side valida o token por hash, limita a loja do dispositivo e utiliza a chave administrativa somente no servidor. Eventos de registro, revogação, configuração e pedido entram na auditoria.

## Pagamentos e recuperação

O checkout usa chave idempotente e registra `kiosk_payment_intents`. PIX permanece pendente até confirmação do provedor existente. A estrutura registra estados de falha, expiração e `reconciliation_required`. A abstração de terminal permite integrar pinpad/POS sem acoplar o domínio a um fabricante.

## Limitações conhecidas

- SDK físico de pinpad depende do fornecedor/hardware escolhido; a porta de integração está pronta, mas nenhum fabricante foi presumido.
- Leitura de QR de loyalty e OTP sensível dependem da câmera/provedor de identidade do equipamento.
- Cache offline é apenas para consulta; o sistema bloqueia checkout offline por segurança.
- Impressão física continua opcional e usa o conector já existente quando configurado.

## Testes

O teste de contrato cobre os 30 cenários obrigatórios, incluindo registro/revogação, escopos, sessão, catálogo, carrinho, PIX, terminal, idempotência, reconciliação, pickup, KDS, health, degradação, auditoria e isolamento por tenant/loja.

## Recomendações para a Fase 44

Selecionar os provedores físicos de pinpad homologados, executar piloto controlado em uma unidade, medir o funil por 14 dias e só então expandir. A Fase 44 não foi iniciada.

