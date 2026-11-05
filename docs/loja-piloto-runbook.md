# Roteiro da loja piloto (Fases 97G e 99H)

**Loja piloto escolhida em 05/11/2026: MARIAH EL LANCHES** (`app-lanches`). Ela já está cadastrada em produção, com cardápio, zona de entrega, terminal de caixa e impressão automática da cozinha. Por isso a seção 2 vira uma conferência do que já existe, não um cadastro do zero.

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

- **Painel do piloto (Fase 99H):** Superadmin → Painel do piloto. Pedidos de hoje, tempo médio por etapa, pedidos parados, pagamentos falhos, impressoras, alertas abertos, erros do app e relatos abertos. Só leitura.
- **Alertas do piloto (Fase 98F):** Superadmin → Alertas do piloto. Avaliados a cada 5 minutos.
- **Erros do app (Fase 99G):** guardados 14 dias na tabela `app_error_events`, sem dados pessoais. Mais de 10 em 15 minutos viram alerta para o superadmin.
- **Erros do app (Vercel):** Vercel → `app-lanches` → Observability / Logs (o plano Hobby guarda só 1 hora de logs; olhar diariamente).
- **Status do sistema:** `/status` e Superadmin → Logs, Performance e Qualidade.
- **Suporte:** Superadmin → Suporte (chamados das lojas) e `/painel/suporte` no lado da loja.
- **Incidentes:** `/painel/incidentes` (incident management está ligado nos planos).
- O NOC da Fase 84 está **desligado** em todos os planos; não usar no piloto.

### 4.2 Alertas mínimos (consultas só de leitura, SQL Editor de produção)

Desde a Fase 98F estas regras rodam sozinhas (Alertas do piloto). As consultas ficam aqui para conferência manual.

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
- **Relatar problema (Fase 99H):** botão no canto inferior esquerdo do painel, da cozinha, do caixa e do entregador. Abre chamado na Central de Suporte com a página (sem endereço completo nem identificadores), o horário, o navegador e o papel da pessoa. Não captura nada da tela; só o texto escrito. Limite de 10 relatos por pessoa por hora. Aparece como "Piloto: problema em …".
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

## 8. Checklist do dia 1

| # | Item | Quem |
|---|---|---|
| 1 | Migrations da Fase 99 aplicadas em produção (lista do `docs/phase99-launch-closure-report.md`) | dono do MasterApp aprova, Claude aplica |
| 2 | Loja piloto no plano certo, conferido com a prévia de "Alinhar loja ao plano" | dono do MasterApp |
| 3 | Cardápio, horários, área de entrega e formas de pagamento revisados pela loja | dono da loja |
| 4 | Equipe com acesso ativado (garçom, cozinha, caixa, entregador), cada um entrou uma vez | dono da loja |
| 4a | Terminal de caixa cadastrado (Configurações → Terminais de caixa): sem ele o caixa não abre o turno | dono da loja |
| 4b | Zona de entrega com o nome do bairro como o cliente vai digitar (a cotação compara o nome) | dono da loja |
| 5 | Impressora dá sinal (Painel do piloto → Impressoras) | dono da loja |
| 6 | Teste de fumaça da seção 3 feito, com um pedido real de baixo valor | dono da loja |
| 7 | Painel do piloto sem pedidos parados e Alertas do piloto sem alertas abertos | dono do MasterApp |
| 8 | Cada pessoa da equipe sabe onde fica "Relatar problema" | dono da loja |
| 9 | Contato direto combinado para problema que impede vender | os dois |

## 9. Primeira semana

- **Todo dia, no fim do expediente:** Painel do piloto (pedidos parados, tempos por etapa, pagamentos falhos), Alertas do piloto e relatos abertos na Central de Suporte.
- **Todo dia:** responder cada relato do piloto no mesmo dia, mesmo que seja "visto, corrigindo".
- **Dias 2, 4 e 7:** conversa curta com a loja: o que travou, o que demorou, o que ninguém usou.
- **Erro novo no núcleo** (pedido, cozinha, caixa, entrega, pagamento): investigar no mesmo dia; correção com teste, revisada antes de publicar.
- **Nada de recurso novo ligado na loja durante a semana** sem prévia e aprovação.

## 10. Reversão rápida

| Situação | Primeiro passo | Depois |
|---|---|---|
| Deploy novo quebrou o núcleo | Vercel → Deployments → deploy anterior → **Instant Rollback** | corrigir na branch, com teste |
| Módulo atrapalhando a loja | 🔒 desligar a flag da loja (Superadmin → Estabelecimentos → Alinhar loja ao plano, ou Feature Management) | registrar no relato |
| Alertas demais | 🔒 ajustar o limite da regra em `pilot_alert_rules` | registrar o motivo |
| Pagamento online falhando | a loja desliga o Pix online e aceita dinheiro/maquininha | abrir chamado no gateway |
| Loja não consegue vender | voltar para comanda em papel e anotar os pedidos | registrar tudo no relato para lançar depois |

## 11. Critérios para aprovar o piloto

O piloto está aprovado para abrir mais lojas quando, em **7 dias seguidos de operação**:

1. nenhum pedido perdido (todo pedido criado chegou à cozinha e teve fim: entregue, concluído ou cancelado com motivo);
2. nenhum alerta crítico sem resposta no mesmo dia;
3. pedidos parados resolvidos em menos de 1 hora;
4. erros do app no núcleo investigados e, se forem do app, corrigidos;
5. todos os relatos do piloto respondidos e os que impedem vender resolvidos;
6. a loja confirma que quer continuar usando;
7. termos de uso e política de privacidade publicados (pendência da Fase 96, seção 1.1).
