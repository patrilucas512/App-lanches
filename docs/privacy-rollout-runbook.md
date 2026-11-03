# Roteiro de ativação: Privacidade & LGPD

Este roteiro **só documenta** como ligar o módulo numa loja piloto. Nada aqui foi executado em produção. Cada passo marcado com 🔒 precisa da aprovação do dono do MasterApp.

## 0. Pré-requisitos

- Migrations das Fases 95 e 96 aplicadas no banco da loja.
  - Em produção: as da 95 já estão; as da 96 (`20261103130000` a `20261103132000`) ainda não. 🔒
- O app publicado com o código da Fase 96.
- O pacote de validação do encarregado (`docs/privacy-dpo-validation-pack.md`) preenchido.

## 1. Preparação da loja piloto (sem efeito para clientes)

1. 🔒 Ligar `privacy_setup_enabled` na loja (tabela `store_feature_flags`). A tela abre só para configuração. O registro de consentimento, a central do portal e o worker **continuam desligados**.
2. Em **Configurações**:
   - nomear o encarregado (`privacy_contexts.dpo_user_id`);
   - conceder `privacy:dpo` a ele pela Governança de Acessos (Fase 93).
3. Em **Consentimentos**: publicar os quatro textos aprovados. Depois, o encarregado marca cada versão como revisada.
4. Se o encarregado mudar prazos ou aprovações: publicar as políticas `privacy.*` pela Fase 79 (Políticas), usando os modelos de **Configurações → Políticas (Fase 79)**. Antes, conferir a prévia do impacto ("X solicitações mudam de prazo").
5. Conectar o WhatsApp da loja. É o canal do código de verificação.
6. Revisar os suboperadores e criar as políticas de retenção (todas começam em simulação).
7. Fazer um pedido de acesso de teste até o fim, com um titular fictício.
8. O encarregado registra a revisão em **Configurações → Registrar revisão do encarregado**.

## 2. Ativação

1. Em **Configurações → Ativação nesta loja**, conferir o checklist. Todos os itens obrigatórios devem estar ✅.
2. Clicar em **Ligar nesta loja**.
   - O banco recusa a ativação sem um registro de go-live recente (`PRIVACY_GO_LIVE_REQUIRED`), mesmo por outro caminho, como o painel de superadmin ou SQL.
   - Exceção com item pendente: só quem tem `privacy:dpo`, com motivo de pelo menos 20 caracteres, que fica registrado.
3. Se a loja quiser a central do titular no portal: 🔒 ligar `privacy_dsr_portal_enabled`.
4. Execução real de retenção (`privacy_retention_execution_enabled`): 🔒 **só depois de algumas semanas de simulação**, com aprovação do encarregado.

## 3. Worker (agendamento)

O worker `/api/privacy/worker`:
- avisa de prazos de solicitações;
- retoma exclusões que pararam no meio;
- continua execuções de retenção aprovadas, em lotes de 25 clientes.

1. 🔒 Criar o segredo no Vault de produção: `select vault.create_secret('<valor aleatório>','privacy_worker_secret');`
2. 🔒 Criar o job no `pg_cron`, no mesmo formato dos jobs `masterapp-idgov-worker` da Fase 93, apontando para `https://app-lanches-psi.vercel.app/api/privacy/worker`, a cada 15 minutos. O token vem de `vault.decrypted_secrets` e é conferido por `verify_worker_secret`.
3. Conferir a primeira execução. A resposta esperada é `{"contexts":1,"alerted":…,"resumed":…,"failed":0}`, e sem token o worker responde 401.

## 4. O que monitorar nas primeiras semanas

| O que | Onde | Sinal de problema |
|---|---|---|
| Solicitações perto do prazo ou vencidas | Visão Geral, widget do Workspace, Executive | Alguma vencida |
| Envios de marketing barrados | Campanhas e jornadas com motivo `NO_CONSENT` ou `REGISTRY_UNAVAILABLE` | Queda brusca de alcance: revisar textos e baseline |
| Planos de exclusão "em parte" | Solicitações de Titulares | Passos manuais (marketplace) parados |
| Simulações de retenção | Retenção | Número de vencidos muito diferente do esperado |
| Falhas do worker | Resposta `failed` do worker e logs da Vercel | `failed` maior que 0 |
| Auditoria | `privacy_audit_events` | Ações sem o motivo esperado |

## 5. Como desligar

1. Em **Configurações → Desligar**, com motivo. Isso desliga também a central do portal. O consentimento volta às regras antigas na hora; as revogações já feitas continuam valendo nas colunas antigas.
2. 🔒 Parar o job do worker: `select cron.unschedule('<nome do job>');`
3. Os dados do módulo (solicitações, planos, auditoria) ficam guardados. Nada é apagado ao desligar.

## 6. Voltar atrás numa exclusão

Exclusão e anonimização **não têm desfazer**. Por isso exigem prévia, aprovação por outra pessoa, execução por uma terceira pessoa e confirmação digitada quando são grandes. Cópias em backup expiram pela política de backups (Fase 25).
