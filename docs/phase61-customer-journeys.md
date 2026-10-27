# Fase 61 — Customer Journey e Lifecycle Marketing

## 1. Diagnóstico inicial

O MasterApp já possuía Automação, CRM, Campanhas, Marketing Intelligence, Customer 360, Loyalty, assinaturas, mensageria e consentimentos. A nova fase não cria um segundo motor: especializa a orquestração de relacionamento e compila sua execução no Automation Center da Fase 50.

## 2. Arquitetura Customer Journey

A camada reúne modelo, API autenticada, worker de entrada, builder especializado, analytics e integração com Perfil 360. Definições são declarativas, filas são duráveis e efeitos são encaminhados aos serviços canônicos.

## 3. Arquivos criados

Foram criados núcleo de jornadas, API e worker, componente visual, página, CSS, migration, suíte de 30 testes e este relatório.

## 4. Arquivos modificados

Menu, entitlements, Automation Action Registry, Customer 360, Copiloto e scripts do pacote foram ampliados para a Fase 61.

## 5. Migrations

A migration `20261024070000_phase61_customer_journeys.sql` cria tabelas operacionais, fatos, dimensões, permissões, flags e registros de integração. Está preparada localmente; não foi aplicada em produção nesta entrega.

## 6. Journey model

Objetivos, status, escopo, prioridade, limites de frequência, janela de envio, reentrada e exclusão mútua são estruturados. Código, SQL e URL arbitrários são rejeitados.

## 7. Versioning

Cada edição gera nova versão imutável. Uma jornada pode manter versão ativa e rascunho simultaneamente; por padrão, clientes já matriculados terminam a versão em que entraram.

## 8. Triggers/entry rules

Gatilhos reutilizam o Event Registry da Automação e regras tipadas. O snapshot de entrada é minimizado e cada evento possui chave idempotente.

## 9. Enrollments

Matrículas guardam versão, evento, estágio, status e contexto mínimo. Reentrada aplica políticas `never`, `after_completion`, `after_cooldown` ou `unlimited_with_cooldown`; cooldown é obrigatório quando aplicável.

## 10. Stages

São suportados mensagem, espera, condição, ramificação, oferta, tarefa, pesquisa, ação de fidelidade e saída. O builder apresenta dez passos próprios de Customer Journey.

## 11. Waits/conditions/branches

Espera temporal usa delay durável da Automação. Espera por evento exige timeout explícito. Condições e branches usam estrutura tipada, sem execução de código do usuário.

## 12. Messaging

Mensagens são ações registradas e devem usar templates aprovados, Campaign/Omnichannel e fallback apenas para canal consentido. Consentimento, opt-out, frequência e horário são revalidados imediatamente antes da execução.

## 13. Offers

Ofertas são encaminhadas ao motor oficial de Promoções/Cupons e passam por margem, estoque, capacidade, disponibilidade, empilhamento, validade e elegibilidade. A jornada não altera preços diretamente.

## 14. Suppressions

Opt-out, ausência de consentimento, reclamação, limite de frequência, horário silencioso, política, loja fechada, oferta indisponível, recuperação ativa, exclusão, duplicidade, capacidade, estoque ou conflito são resultados protegidos — não falhas.

## 15. Conflict resolver

Recuperação tem prioridade sobre promoção. O resolvedor ordena objetivos, prioridade e grupo de exclusão mútua e registra por que uma jornada foi bloqueada.

## 16. Exit rules

Conclusão, saída manual, opt-out, exclusão do cliente e supressões terminais encerram ações futuras. Opt-out e exclusão têm efeito imediato.

## 17. Templates

Existem dez modelos: primeira compra, segunda compra, cliente inativo, pontos expirando, pós-recuperação, renovação, carrinho abandonado, pós-reserva, no-show gentil e win-back.

## 18. Simulation

Dry-run calcula elegíveis, supressões, conflitos, ações, custo de mensagem e exposição máxima da oferta. Não envia, não cria oferta e não altera o cliente.

## 19. Experiments/control groups

Experimentos suportam mensagem, atraso, oferta, canal e assunto. A atribuição é determinística e fixa por cliente/jornada; grupos de controle são preservados e não recebem a ação testada.

## 20. Attribution/incrementality

Conversões registram modelo e receita/margem atribuídas. A interface afirma que atribuição não prova causalidade; lift incremental só é exibido como válido quando existe controle e amostra configurada.

## 21. Customer 360 integration

O Perfil 360 agora mostra jornadas ativas, status e data de entrada. Next Best Journey usa sinais explicáveis e nunca matricula automaticamente.

## 22. CRM/Campaign/Loyalty integration

Tags e segmentos permanecem no CRM, campanhas e templates no Campaign Engine, ofertas no Promotion Engine e pontos no Loyalty. A Fase 61 apenas orquestra referências e ações registradas.

## 23. Automation Center integration

Publicar compila nodes e edges para `automation_workflows` e `automation_workflow_versions`. Execuções, delays, retries, backoff, DLQ e circuit breaker permanecem sob a Fase 50.

## 24. Reporting/Workspace integration

Cinco widgets, cinco datasets e seis relatórios foram registrados. Métricas cobrem entrada, conclusão, conversão, reativação, supressão, descadastro, receita/margem atribuída, lift e duração.

## 25. AI Journey Assistant

O Copiloto possui oito ferramentas somente leitura. A IA pode sugerir objetivo e rascunho, mas não ativa, publica, matricula, envia, emite oferta nem declara causalidade.

## 26. Data Platform

Fatos de matrículas, transições, ações, conversões, supressões e experimentos e dimensões de jornada, etapa, objetivo, motivo e variante foram definidos com `data_as_of`.

## 27. Security/privacy/RBAC

Há onze permissões granulares e escopos loja/rede. As tabelas ativam RLS, revogam acesso direto e usam APIs service-role após membership. Segmentação sensível e manipulação comportamental são proibidas.

## 28. Audit

Criação, versão, validação, simulação, preview, solicitação de publicação, publicação, pausa, retomada, entrada e saída manual registram ator, motivo, antes/depois e correlação.

## 29. Observability

Jobs têm lease, tentativas, backoff e dead-letter. Saúde da jornada separa ações falhas, matrículas paradas, supressões e picos de reclamação/descadastro; auto-pause só pode ocorrer por política explícita.

## 30. Tests

A suíte cobre os 30 casos obrigatórios: criação, versões, triggers, idempotência, reentrada, cooldown, etapas, timeout, mensagens, consentimento, supressões, conflitos, ofertas, conversão, atribuição, experimentos, pausa, simulação, backfill, permissões e isolamento.

## 31. Limitations

A precisão histórica depende de backfill controlado e da disponibilidade dos dados canônicos. Custos de provedores podem ficar indisponíveis. Resultados observacionais não medem causalidade. Execução é online; o portal mostra benefícios, não o motor.

## 32. Recommendations for Phase 62

Validar volume e qualidade dos eventos em produção, calibrar limites por canal, executar experimentos pequenos com controle e acompanhar reclamação/descadastro antes de ampliar. A Fase 62 não foi iniciada e depende de nova instrução.
