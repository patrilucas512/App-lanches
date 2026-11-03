# Pacote de validação do encarregado: proposta preenchida

> **Importante:** esta é uma **proposta** para o encarregado (DPO) ou o jurídico revisar, não um parecer jurídico. As referências legais foram citadas como ponto de partida e precisam ser conferidas por quem responde juridicamente pela loja. Nada aqui foi registrado no sistema como "revisado": essa marcação é uma declaração do encarregado, feita por ele em **Configurações → Registrar revisão do encarregado**.

Loja: Loja de teste do dono (piloto)  Encarregado: ______________________  Data: 03/11/2026

**Situação da loja piloto em produção (03/11/2026):**
- única loja existente, usada pelo dono para testes;
- todas as flags de privacidade desligadas;
- nenhum encarregado nomeado.

## 1. Prazos

| # | Item | Valor atual | Proposta | Motivo |
|---|---|---|---|---|
| 1.1 | Prazo padrão de resposta | 15 dias | **[x] Mantém 15 dias** | A LGPD (art. 19, II) fala em até 15 dias para a declaração completa de confirmação e acesso. Para os demais direitos ainda não há prazo fixo em regulamento, e usar o mesmo prazo é a prática mais segura. |
| 1.2 | Prazo por tipo | Igual ao padrão | **[x] Mantém igual para todos** | Um prazo só é mais simples de cumprir na fase piloto. |
| 1.3 | Alerta antes do vencimento | 3 dias | **[x] Muda para 5 dias** | Com 15 dias corridos e uma equipe pequena, 5 dias de aviso dão folga para conseguir aprovação e execução por pessoas diferentes. |
| 1.4 | Prazo para comunicar incidente | Vazio | **[x] Define 3 dias** | A Resolução CD/ANPD nº 15/2024 fala em 3 dias **úteis** a partir do conhecimento. O sistema conta dias corridos, então 3 corridos fica no lado seguro. O encarregado deve confirmar a resolução vigente. |
| 1.5 | Revisão de bloqueio sem data de fim | 180 dias | **[x] Mantém** | Revisão semestral é suficiente para bloqueios abertos por processo ou investigação. |
| 1.6 | Validade do link do pacote de dados | 24 horas | **[x] Mantém** | Curto o bastante para limitar vazamento de um link encaminhado, longo o bastante para o titular baixar. |

## 2. Textos de consentimento (rascunhos em linguagem simples)

Proposta: publicar estes textos como versão 2 de cada finalidade. A versão 1 é o texto provisório.

| # | Finalidade | Texto proposto |
|---|---|---|
| 2.1 | `marketing_whatsapp` | "Quero receber ofertas, cupons e novidades da [loja] pelo WhatsApp. Posso cancelar quando quiser, respondendo PARAR ou na minha área de privacidade." |
| 2.2 | `marketing_email` | "Quero receber ofertas, cupons e novidades da [loja] por e-mail. Posso cancelar quando quiser, pelo link no e-mail ou na minha área de privacidade." |
| 2.3 | `satisfaction_survey` | "Aceito receber, de vez em quando, uma pesquisa curta sobre meus pedidos para a [loja] melhorar o atendimento. Posso parar de receber quando quiser." |
| 2.4 | `ai_personalization` | "Aceito que a [loja] use meu histórico de pedidos para sugerir pratos e ofertas com ajuda de inteligência artificial. Meus dados não são vendidos e posso retirar este aceite quando quiser." |

Uma mudança relevante no texto exige novo aceite? **[x] Sim.** Muda o que a pessoa autorizou, então o aceite antigo não vale para o texto novo.

## 3. Bases legais

| # | Item | Proposta | Motivo |
|---|---|---|---|
| 3.1 | Rótulos do catálogo (8 itens) | **[x] Aprovados** | Correspondem às hipóteses do art. 7º da LGPD; "tutela da saúde" só se aplica a profissionais e serviços de saúde. |
| 3.2 | Legítimo interesse exige LIA | **[x] Mantém exigência** | O art. 10 da LGPD pede que o legítimo interesse seja demonstrado; a LIA é a forma de registrar isso. |
| 3.3 | Base de cada atividade do ROPA | Sugestões: pedidos e entrega → **execução de contrato**; nota fiscal → **obrigação legal**; ofertas → **consentimento**; pesquisa de satisfação → **legítimo interesse** (com LIA) ou consentimento; ponto e escala de funcionários → **obrigação legal**; repasse a entregadores → **execução de contrato** | Ainda não há atividades cadastradas na loja piloto; cadastrar com estas bases e revisar. |

## 4. O que fica por obrigação legal

| # | Registro | Proposta de prazo | Referência a conferir |
|---|---|---|---|
| 4.1 | Documentos fiscais | **[x] Confirmo, 5 anos** | Prazo de decadência e prescrição tributária (CTN, arts. 173 e 174) |
| 4.2 | Pagamentos e repasses de entregador | **[x] Confirmo, 5 anos** | Mesmo prazo fiscal e contábil |
| 4.3 | Movimentos de caixa (nome do operador sai) | **[x] Confirmo, 5 anos** | Registro contábil |
| 4.4 | Escalas, ponto e documentos de funcionário | **[x] Confirmo, 5 anos após o desligamento** | Prescrição trabalhista (CF, art. 7º, XXIX) e FGTS |
| 4.5 | Avaliações e feedback de funcionário | **[x] Mantém, 5 anos após o desligamento** | Podem servir de prova em reclamação trabalhista; revisar com o jurídico trabalhista |
| 4.6 | Comprovante de entrega | **[x] Confirmo, 5 anos** | Prazo para reclamação do consumidor (CDC, art. 27) |
| 4.7 | Hash do CPF do entregador | **[x] Confirmo, enquanto houver repasse a conferir (5 anos)** | Ligação com os repasses; telefone e veículo já saem |
| 4.8 | Histórico de consentimento e revogação | **[x] Confirmo** | É a prova de que a pessoa pediu para não receber marketing |
| 4.9 | Aceite de proposta de lead (IP) | **[x] Confirmo, enquanto o contrato valer e pelo prazo de prescrição** | Prova contratual (contexto MasterApp) |

## 5. Aprovações e separação de funções

| # | Item | Proposta | Motivo |
|---|---|---|---|
| 5.1 | Aprovações para executar exclusão | **[x] 1 aprovação** | Suficiente com a separação de pessoas abaixo |
| 5.2 | Três pessoas diferentes (pede, aprova, executa) | **[x] Mantém em produção.** Na loja piloto, enquanto só o dono tiver acesso, a separação não é possível: **testar no masterapp-dev**, onde já foi validada, e só ligar a loja real quando houver pelo menos duas pessoas com acesso | Exceção de autoaprovação numa loja real tira a principal proteção contra erro e abuso |
| 5.3 | Retenção real exige aprovação | **[x] Mantém** | Ação em massa e irreversível |
| 5.4 | Quando a RIPD é obrigatória | **[x] Mantém os 5 gatilhos** | Correspondem aos tratamentos de maior risco do produto (saúde, localização, IA, perfil, compartilhamento) |
| 5.5 | Nível de verificação de identidade | **[x] Mantém o código no telefone cadastrado, e revisão manual para pedidos de eliminação feitos fora do portal** | Eliminação é irreversível; vale uma confirmação a mais quando o pedido chega por e-mail ou WhatsApp |

## 6. Retenção

| # | Conjunto | Proposta | Motivo |
|---|---|---|---|
| 6.1 | Clientes sem pedidos | **[x] Anonimizar 24 meses após o último pedido** | Mantém clientes ocasionais e limita cadastros parados; os pedidos continuam nos relatórios |
| 6.2 | Conteúdo de mensagens | **[x] Anonimizar o conteúdo após 12 meses** | Cobre reclamações e trocas dentro do ano; contagens ficam |
| 6.3 | Ligações de voz | **[x] 30 dias** | Igual ao prazo já configurado nas conexões de voz (`retention_days` padrão 30) |

As três começam **em simulação**. A execução real só depois de algumas semanas de acompanhamento (ver o roteiro de ativação).

## 7. Residência e suboperadores

| # | Item | Situação conferida | Proposta |
|---|---|---|---|
| 7.1 | Banco de dados | **Supabase em `sa-east-1` (São Paulo)**, conferido no projeto em 03/11/2026 | [x] Confirmado. Falta anexar o DPA do Supabase |
| 7.2 | Backups | Mesmo provedor; a região dos backups não aparece no projeto | Pedir confirmação ao Supabase |
| 7.3 | Hospedagem (Vercel) | O repositório não define região das funções; o padrão da Vercel é `iad1` (EUA) | Tratar como **transferência internacional**. Mecanismo sugerido: cláusulas contratuais do provedor (DPA da Vercel). Avaliar mudar a região para `gru1` (São Paulo) |
| 7.4 | WhatsApp (Meta) | Transferência internacional | Mecanismo: termos e DPA da Meta para a API do WhatsApp Business |
| 7.5 | Provedores de IA | Nenhuma chave de IA cadastrada em produção hoje | Registrar quando for ligado, com o DPA do provedor |
| 7.6 | Lista de suboperadores | Nenhum perfil de privacidade cadastrado ainda | Cadastrar Supabase, Vercel e Meta como suboperadores e marcar a revisão |

## 8. Comunicações

| # | Item | Proposta |
|---|---|---|
| 8.1 | Modelo de comunicação à ANPD | **[x] Ajustar:** usar o formulário oficial da ANPD como base; o rascunho do sistema serve para juntar as informações |
| 8.2 | Modelo de comunicação aos titulares | **[x] Aprovado com ajuste:** incluir um canal de contato do encarregado (e-mail) |
| 8.3 | Resposta padrão a titulares | **[x] Aprovado com ajuste:** assinar com o nome da loja e o contato do encarregado |

## O que falta para a loja piloto poder ser ligada

Todos itens obrigatórios do checklist:

1. Nomear o encarregado e dar a ele `privacy:dpo` pela Governança de Acessos.
2. Publicar os 4 textos acima e marcar como revisados.
3. Ajustar os prazos (alerta de 5 dias e incidente de 3 dias) e registrar a revisão do encarregado.
4. Conectar o WhatsApp da loja.
5. Fazer um pedido de acesso de teste até o fim.

Assinatura do encarregado: ______________________
