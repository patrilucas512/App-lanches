# Fase 67 — Central de Auditoria Operacional

## 1. Diagnóstico inicial
O MasterApp já possuía Qualidade, Ativos/Manutenção, Documentos, Aprendizado, Incidentes, Governança de Rede, Store Opening, tarefas internas, notificações, automação, relatórios e offline. A fase reutiliza esses domínios e elimina a necessidade de motores paralelos.

## 2. Arquitetura Operational Audit
O domínio `operational_audit` foi dividido em templates, items, plans, inspections, responses, evidence, findings, scoring, action plans, follow-up, analytics e governance. A API de aplicação usa cliente administrativo somente depois de autenticação, escopo e RBAC.

## 3. Arquivos criados
Foram criados o núcleo de regras, migration da fase, API, Central de Auditorias, player mobile, estilos, duas rotas, suíte de 30 testes e este relatório.

## 4. Arquivos modificados
Foram ampliados o menu do painel, entitlements, registro do Copiloto, registro de automações e scripts do projeto.

## 5. Migrations
`20261025020000_phase67_operational_audits.sql` cria o modelo transacional, eventos imutáveis, jobs com lease, fatos/dimensões, registros de busca, widgets, datasets, métricas, relatórios, feature flags e isolamento por serviço.

## 6. Audit templates
Há biblioteca com dez modelos: abertura, fechamento, cozinha, estoque, recebimento, limpeza, equipamentos, caixa, delivery e padrão de marca. O modelo é clonado para a organização antes de ser editado.

## 7. Template versioning
Cada publicação gera snapshot, hash de cálculo e nova versão. Auditorias fixam a versão usada e resultados históricos não são recalculados.

## 8. Checklist items
São aceitos 11 tipos seguros, sem código arbitrário. Itens possuem obrigatoriedade, peso, criticidade, regra de evidência, condição, fonte e configuração de medição.

## 9. Scheduling
Planos suportam execução avulsa e recorrência diária, semanal, mensal, trimestral ou intervalo seguro. A política de atraso é explícita e a auditoria exige template, escopo e responsável.

## 10. Audit execution
O player é mobile-first, usa bloqueio de editor ativo, progresso, respostas incrementais e confirmação humana na publicação.

## 11. Offline/sync
Respostas podem ir para o IndexedDB existente. Cada mutação possui ID, idempotency key, versão esperada e template fixado; conflito de versão exige revisão manual. Publicação continua obrigatoriamente online.

## 12. Evidence
Metadados ficam em `audit_evidence`; arquivos reutilizam `internal_attachments` e o bucket privado existente. A aplicação entrega URL assinada por cinco minutos somente após validar permissão, escopo, atribuição e visibilidade. Localização precisa não é coletada por padrão.

## 13. Scoring
São suportados percentual, percentual ponderado, pass/fail e sem score. O cálculo preserva numerador, denominador, método, limite, N/A e itens críticos.

## 14. Findings
Findings possuem tipo, severidade, responsável, prazo, ciclo de vida e vínculos oficiais. Falhas críticas podem gerar resultado crítico, mas nunca são encerradas automaticamente.

## 15. Quality integration
O finding pode criar e vincular uma única `quality_nonconformity`; chamadas posteriores devolvem o vínculo existente, evitando duplicidade.

## 16. Maintenance integration
Quando há ativo selecionado, um finding pode criar OS corretiva na tabela oficial `maintenance_work_orders`, usando fonte `quality_issue` e preservando o vínculo.

## 17. Action plans
`audit_action_plans` organiza a correção e `audit_action_plan_tasks` aponta para `internal_tasks` da Fase 32. Não existe segundo motor de tarefas.

## 18. Follow-up
Reauditorias podem ser completas, somente de findings ou somente de itens críticos e preservam o vínculo com a auditoria original.

## 19. Verification
Verificação registra decisão, notas e evidências. A segregação de funções é configurável e findings críticos exigem evidência de correção.

## 20. Store Opening integration
`audit_store_opening_links` conecta auditoria, projeto e blocker oficial para readiness, gate de go-live, evidência ou follow-up, sempre na mesma unidade.

## 21. Network Governance
Escopos de organização, marca, região, cluster e loja são contemplados. `audits:view_network` controla visão de rede; demais usuários ficam limitados à unidade ou atribuição.

## 22. Reporting/Workspace
Foram registrados cinco widgets, seis datasets certificados, sete relatórios e sete métricas com comparação apenas entre templates/versões compatíveis.

## 23. Notifications/Automation
Seis eventos e sete ações foram registrados. A automação pode notificar ou criar registros controlados, mas não aprova, publica, verifica nem fecha automaticamente.

## 24. Copilot
Oito ferramentas somente leitura foram incluídas. O Copiloto apresenta fatos e recorrências, produz drafts e nunca aprova, altera score, publica ou afirma causa sem evidência.

## 25. Data Platform
Fatos de auditoria, respostas, findings, planos e follow-ups são acompanhados por dimensões de template, tipo, finding, severidade e resultado.

## 26. Security/RBAC
Há 13 permissões granulares, escopo por organização/unidade, rotas privadas, validação de membership, evidência restrita, ausência de segredo no cliente e feature flags específicas.

## 27. Audit trail
Criação, execução, publicação, findings, verificação, evidência e emendas escrevem eventos com autor, motivo, estado anterior, estado posterior e correlation ID.

## 28. Observability
Jobs possuem tentativas, lease, backoff, erro e dead-letter. A trilha permite investigar conflitos offline, atrasos e integrações sem expor conteúdo de evidência nos datasets.

## 29. Tests
A suíte `test:phase67` cobre os 30 cenários obrigatórios: templates, versionamento, itens, evidências, criticidade, agenda, recorrência, execução, offline/sync, quatro regras de score, integrações, follow-up, verificação, risco aceito, rede, RBAC, ACL, emendas, analytics, trilha e isolamento.

## 30. Limitations
A migration ainda precisa ser aplicada ao Supabase de produção com autorização específica. Upload binário usa o fluxo de anexos existente; nesta fase foi implementada a proteção e leitura assinada. Rotas externas não são chamadas sem credenciais/configuração. O site não foi publicado nesta entrega local.

## 31. Recommendations for Phase 68
A Fase 68 não foi iniciada. Como próxima evolução, avaliar somente após nova instrução: telemetria de sincronização offline em larga escala, upload resumível de evidências pesadas e assistente de preparação de auditoria com avaliação formal de segurança e custo.
