# Roteiro da loja piloto (Fase 97G)

Este roteiro **só documenta**. Nada aqui foi executado em produção. Cada passo marcado com 🔒 é escrita em produção e precisa da aprovação explícita do dono antes.

## 1. Pré-requisitos

### 1.1 Bloqueantes (sem eles o piloto não começa)

| # | Item | Situação em 03/11/2026 |
|---|---|---|
| 1 | Login de funcionário (garçom, cozinha, caixa, entregador) funcionando em produção | ✅ corrigido e publicado em 03/11/2026 (Fase 97F) |
| 2 | Termos de uso e política de privacidade publicados no app, com link no cadastro e no cardápio público | ❌ **não existem páginas**. Precisam ser escritos (jurídico) e publicados |
| 3 | Checklist de privacidade da Fase 96 (`docs/privacy-dpo-validation-pack-proposta.md`) | ❌ encarregado não nomeado. Pode começar com o módulo de privacidade desligado, desde que os itens 2 e o canal de contato do titular existam |
| 4 | Testes de ponta a ponta do núcleo passando em homologação | ⏳ dependem das chaves da homologação (ver `docs/ambientes.md`) |
| 5 | Forma de pagamento definida para o piloto | dinheiro e comprovante funcionam sem chave; Pix online exige credencial de produção do gateway |

### 1.2 Chaves de produção (ver `docs/integracoes-checklist.md`)

- **Obrigatórias:** nenhuma nova para o fluxo básico (cardápio, pedido, cozinha, caixa, entrega, pagamento em dinheiro/comprovante).
- **Se o piloto aceitar Pix online:** credencial de produção do Mercado Pago ou Pagar.me **da loja piloto**, cadastrada pela própria loja em Configurações → Pagamentos.
- **Se usar WhatsApp:** conexão da loja (Meta, token permanente) em Configurações → WhatsApp.
- **Se cobrar a assinatura pelo app:** chaves live do Stripe (ou gateway da plataforma já cadastrado).
- **Recomendada:** `CUSTOMER_PORTAL_OTP_SECRET`.

### 1.3 Plano e flags

- Usar o conjunto núcleo de `docs/nucleo-e-flags.md`, seção 3.
- 🔒 Criar um plano "Piloto" só com o núcleo, ou desligar no plano da loja os módulos fora do núcleo. Hoje o Básico tem 138 módulos não essenciais ligados (WMS, IBP, MDM etc.) e o menu fica carregado.
- 🔒 Na loja piloto, conferir em `store_feature_flags`: `delivery_enabled`, `order_tracking_enabled`, `customer_portal_enabled`, `whatsapp_enabled` conforme o uso; `privacy_*` desligadas.
- **Atenção:** dono e gerente conseguem alterar `store_feature_flags` da própria loja direto pela API. Para o piloto isso é aceitável; corrigir antes de abrir para mais lojas (recomendação da Fase 98).

## 2. Cadastro e configuração da loja real

1. O dono da loja cria a conta em `/cadastro` com e-mail próprio.
2. Onboarding (`/onboarding`): nome, endereço, horário de funcionamento, área de entrega.
3. 🔒 Superadmin: vincular a loja ao plano do piloto (Superadmin → Estabelecimentos) e conferir `public_menu_active`.
4. Cardápio (`/painel/cardapio`): categorias, produtos, adicionais, fotos. Importação em `/painel/importacao` se houver planilha.
5. Modos de atendimento (`/painel/configuracoes`): mesa, retirada, delivery, formas de pagamento aceitas, troco, comprovante.
6. Equipe:
   - garçons em `/painel/garcons`;
   - cozinha e caixa em `/painel/equipe`;
   - entregadores em `/painel/equipe` (convite).

   Cada pessoa ativa o próprio acesso pelo link de convite.
7. Impressora (`/painel/cozinha` → impressão), se houver.
8. QR das mesas (`/painel/cardapio` → QR Codes). Imprimir e testar com o celular.
9. Pagamento online (opcional): Configurações → Pagamentos, credencial de produção da loja.
10. WhatsApp (opcional): Configurações → WhatsApp.

## 3. Teste de fumaça em produção

Feito pelo **próprio dono da loja**, com um pedido real de baixo valor (por exemplo, um refrigerante), pago por ele mesmo.

| # | Verificar | Onde |
|---|---|---|
| 1 | Cardápio abre no celular, fotos e preços certos | `/loja/<slug>` e QR da mesa |
| 2 | Pedido de retirada é criado e aparece no painel | `/painel/pedidos` |
| 3 | Pedido aparece na cozinha (e sai na impressora, se houver) | `/cozinha` |
| 4 | Cozinha marca "pronto"; cliente vê a mudança no acompanhamento | tela do pedido no celular |
| 5 | Pagamento: dinheiro com troco, ou Pix de valor baixo, aparece como pago | `/caixa`, `/painel/caixa` |
| 6 | Pedido de delivery: entregador recebe, sai para entrega, confirma com o código | `/motoboy` |
| 7 | Pedido na mesa pelo garçom | `/garcom` |
| 8 | Notificação push chega (se autorizada no navegador) | celular do cliente |
| 9 | Mensagem de WhatsApp de atualização chega (se conectado) | WhatsApp do dono |
| 10 | Pedido aparece no relatório de vendas do dia | `/painel` |
| 11 | Portal do cliente abre com o código de acesso | `/conta/<slug>` |

Se o Pix for de verdade, estornar pelo painel do gateway depois do teste.

## 4. O que monitorar na primeira semana

### 4.1 Onde olhar

- **Erros do app:** Vercel → `app-lanches` → Observability / Logs (o plano Hobby guarda só 1 hora de logs; olhar diariamente).
- **Status do sistema:** `/status` e Superadmin → Logs, Performance e Qualidade.
- **Suporte:** Superadmin → Suporte (chamados das lojas) e `/painel/suporte` no lado da loja.
- **Incidentes:** `/painel/incidentes` (incident management está ligado nos planos).
- O NOC da Fase 84 está **desligado** em todos os planos; não usar no piloto.

### 4.2 Alertas mínimos (consultas só de leitura, SQL Editor de produção)

Rodar uma vez por dia na primeira semana; virar alerta automático na Fase 98.

```sql
-- Pedidos travados: abertos há mais de 60 minutos
select establishment_id, status, count(*) from public.orders
where status in ('new','confirmed','preparing','ready','out_for_delivery') and created_at < now() - interval '60 minutes'
group by 1, 2;

-- Falha de pagamento online nas últimas 24 h
select status, count(*) from public.order_payment_transactions
where created_at > now() - interval '24 hours' and status in ('declined','error','expired')
group by 1;

-- Worker parado ou com erro nas últimas 2 h
select j.jobname, max(r.start_time) ultima_execucao, count(*) filter (where r.status <> 'succeeded') falhas
from cron.job j left join cron.job_run_details r on r.jobid = j.jobid and r.start_time > now() - interval '2 hours'
where j.active group by 1 order by 2 nulls first;

-- Chamadas dos workers que não retornaram 200 nas últimas 6 h
select status_code, count(*) from net._http_response where created > now() - interval '6 hours' group by 1;
```

- **Taxa de erro:** Vercel → Observability → Errors. Em 03/11/2026 havia **zero** erros em 7 dias; qualquer erro novo no núcleo deve ser investigado no mesmo dia.

## 5. Como reverter

| Situação | Ação |
|---|---|
| Um módulo causando problema | 🔒 desligar a flag da loja (Superadmin → Feature Management) |
| Deploy novo quebrou algo | Vercel → Deployments → deploy anterior → **Instant Rollback**. Não precisa de commit |
| Função do Supabase quebrou | republicar a versão anterior a partir do Git (`supabase/functions/<nome>`) |
| Migration com problema | não reverter na mão: corrigir com nova migration testada no `masterapp-dev` primeiro |
| Pagamento online falhando | a loja desliga o Pix online em Configurações → Pagamentos e aceita dinheiro/maquininha |
| WhatsApp enviando errado | desconectar em Configurações → WhatsApp |

## 6. Suporte ao piloto (Fase 24)

- A loja abre chamado em `/painel/suporte`; o superadmin responde em Superadmin → Suporte.
- Na primeira semana: contato direto (WhatsApp do dono do MasterApp) para problemas que impedem vender.
- Combinar com a loja um horário de checagem diária nos primeiros 7 dias.
- Registrar cada problema como chamado, mesmo os resolvidos por telefone, para virar lista da Fase 98.

## 7. O que precisa da aprovação do dono do MasterApp para começar

1. Texto dos termos de uso e da política de privacidade (e onde publicar).
2. Plano do piloto (criar plano "Piloto" ou reduzir o Básico).
3. Forma de pagamento do piloto (só dinheiro/comprovante, ou Pix online).
4. Uso do WhatsApp no piloto.
5. Cobrança da assinatura no piloto (gratuito, manual ou pelo app).
6. Data do teste de fumaça e quem faz.
