# Pacote de validação do encarregado (DPO): Privacidade & LGPD

Este documento reúne tudo o que o MasterApp deixou **a validar pelo encarregado ou pelo jurídico** antes de o módulo ser ligado numa loja. O sistema é ferramenta de operação e não decide nenhum destes pontos. Os valores atuais são só ponto de partida.

Para cada item, marque a decisão e, se mudar o valor, registre o novo na tela indicada. Pela tela, em Segurança → Privacidade & LGPD → Configurações → **Políticas (Fase 79)**, você baixa os modelos de política com os valores atuais.

Loja: ______________________  Encarregado: ______________________  Data: ____/____/______

## 1. Prazos

| # | Item | Valor atual | Onde muda | Decisão |
|---|---|---|---|---|
| 1.1 | Prazo para responder a uma solicitação de titular (padrão) | 15 dias | Configurações ou política `privacy.dsr_deadline` (Fase 79) | [ ] Mantém  [ ] Muda para ___ dias |
| 1.2 | Prazo por tipo de pedido (acesso, eliminação, portabilidade etc.) | Igual ao padrão | Política `privacy.dsr_deadline`, uma regra por tipo | [ ] Mantém  [ ] Define por tipo: ________ |
| 1.3 | Alerta antes do vencimento | 3 dias | Configurações ou política `privacy.dsr_alert` | [ ] Mantém  [ ] Muda para ___ dias |
| 1.4 | Prazo para comunicar incidente à ANPD e aos titulares | **Vazio** (sem prazo) | Configurações ou política `privacy.incident_notification_deadline` | [ ] Define ___ dias  [ ] Fica vazio por ora |
| 1.5 | Revisão de bloqueio legal sem data de fim | A cada 180 dias | Configurações | [ ] Mantém  [ ] Muda para ___ dias |
| 1.6 | Validade do link de download do pacote de dados | 24 horas | Configurações | [ ] Mantém  [ ] Muda para ___ horas |

## 2. Textos de consentimento

Hoje os quatro textos são marcadores ("a ser redigido pelo encarregado"). Nenhuma loja deve ir ao ar assim; o checklist de ativação bloqueia.

| # | Finalidade | O que o titular aceita | Texto aprovado (versão) |
|---|---|---|---|
| 2.1 | `marketing_whatsapp` | Ofertas e novidades por WhatsApp | ________ |
| 2.2 | `marketing_email` | Ofertas e novidades por e-mail | ________ |
| 2.3 | `satisfaction_survey` | Pesquisas de satisfação | ________ |
| 2.4 | `ai_personalization` | Uso dos pedidos para recomendações com IA | ________ |

Decida também: uma mudança relevante no texto exige novo aceite? [ ] Sim  [ ] Não

## 3. Bases legais

| # | Item | Atual | Decisão |
|---|---|---|---|
| 3.1 | Rótulos do catálogo de bases legais (8 itens) | Rótulos genéricos | [ ] Aprovados  [ ] Ajustar: ________ |
| 3.2 | Legítimo interesse exige LIA registrada | Sim | [ ] Mantém  [ ] Não exige |
| 3.3 | Base legal de cada atividade do ROPA | Escolhida por quem cadastra | [ ] Revisei todas as atividades |

## 4. O que fica por obrigação legal

Na exclusão, estes registros **ficam**; só o vínculo pessoal é anonimizado quando possível. Confirme ou corrija cada linha.

| # | Registro | Motivo atual | Decisão |
|---|---|---|---|
| 4.1 | Documentos fiscais (vínculo com o cadastro sai) | Fiscal | [ ] Confirmo |
| 4.2 | Transações de pagamento e repasses de entregador | Financeiro | [ ] Confirmo |
| 4.3 | Movimentos de caixa (nome do operador sai) | Financeiro | [ ] Confirmo |
| 4.4 | Escalas, ponto e documentos de funcionário | Trabalhista | [ ] Confirmo |
| 4.5 | Avaliações e feedback de funcionário | Trabalhista (cautela) | [ ] Mantém  [ ] Pode apagar |
| 4.6 | Comprovante de entrega (local e horário) | Comprovante de entrega | [ ] Confirmo |
| 4.7 | Hash do CPF do entregador (telefone e veículo saem) | Repasses | [ ] Confirmo  [ ] Também apagar |
| 4.8 | Histórico de consentimento e revogação | Prova de que não deve receber marketing | [ ] Confirmo |
| 4.9 | Aceite de proposta comercial (IP) de leads | Contrato | [ ] Confirmo |

## 5. Aprovações e separação de funções

| # | Item | Atual | Decisão |
|---|---|---|---|
| 5.1 | Aprovações para executar exclusão | 1 | [ ] Mantém  [ ] ___ aprovações |
| 5.2 | Quem pede, quem aprova e quem executa são pessoas diferentes | Sim | [ ] Mantém  [ ] Loja pequena: permitir autoaprovação (registrado) |
| 5.3 | Retenção real exige aprovação | Sim | [ ] Mantém |
| 5.4 | Quando a RIPD é obrigatória | Dados sensíveis, localização de entregadores, IA com dados pessoais, perfil de marketing, novo compartilhamento | [ ] Mantém  [ ] Ajustar: ________ |
| 5.5 | Nível de verificação de identidade | Código no telefone cadastrado; manual quando não há canal | [ ] Mantém  [ ] Revisão manual para: ________ |

## 6. Retenção

| # | Conjunto | Ação | Prazo proposto | Decisão |
|---|---|---|---|---|
| 6.1 | Clientes sem pedidos | Anonimizar | a definir | [ ] ___ meses após o último pedido |
| 6.2 | Conteúdo de mensagens (WhatsApp/omnichannel) | Anonimizar o conteúdo, manter contagens | a definir | [ ] ___ dias |
| 6.3 | Ligações de voz (dados do chamador e transcrição) | Anonimizar, manter métricas | a definir | [ ] ___ dias |

## 7. Residência e suboperadores

| # | Item | Situação | Decisão |
|---|---|---|---|
| 7.1 | Banco de dados no Supabase em São Paulo (sa-east-1) | Informado pelo provedor | [ ] Confirmado em contrato/DPA |
| 7.2 | Backups do banco | Região a confirmar | [ ] ________ |
| 7.3 | Hospedagem do app (Vercel) | Pode haver transferência internacional | [ ] Mecanismo: ________ |
| 7.4 | WhatsApp (Meta) | Transferência internacional | [ ] Mecanismo: ________ |
| 7.5 | Provedores de IA | Depende do modelo | [ ] Mecanismo: ________ |
| 7.6 | Lista de suboperadores revisada no último ano | Checklist | [ ] Revisada em ____/____/______ |

## 8. Comunicações

| # | Item | Decisão |
|---|---|---|
| 8.1 | Modelo de comunicação de incidente à ANPD (rascunho do sistema) | [ ] Aprovado  [ ] Ajustar |
| 8.2 | Modelo de comunicação aos titulares | [ ] Aprovado  [ ] Ajustar |
| 8.3 | Texto das respostas a titulares (rascunho padrão) | [ ] Aprovado  [ ] Ajustar |

## Registro

Depois de decidir, entre em **Configurações → Registrar revisão do encarregado** (só quem tem `privacy:dpo` vê o botão). Isso marca os prazos como validados no checklist de ativação.

Assinatura do encarregado: ______________________
