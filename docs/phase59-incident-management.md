# Fase 59 — Central de Incidentes Operacionais

## 1. Diagnóstico inicial
Foram reutilizados Support Center, Security Incidents, Maintenance Work Orders, Quality Nonconformities, Hardware Hub, Continuity, Notification Center, Executive Attention, Task Engine, Automation Center, releases e alertas de provedores. A Fase 57 não está presente neste checkout; por isso a comunicação é criada como rascunho no Task Engine e a relação polimórfica fica pronta, sem inventar um sistema paralelo.

## 2. Arquitetura Incident Management
O domínio `incident-management` separa incidentes, severidade, impacto, responders, timeline, runbooks, contenção, recuperação, war room, postmortems, detecção, analytics e integração com fontes canônicas.

## 3. Arquivos criados
Foram criados o núcleo de domínio, migration, APIs principal e de worker, central visual, página administrativa, estilos, testes e este relatório.

## 4. Arquivos modificados
O shell administrativo recebeu Operação → Incidentes, o Copilot recebeu dez ferramentas de consulta e o `package.json` recebeu o comando de testes da fase.

## 5. Migrations
`20261024025038_phase59_incident_management.sql` cria estruturas, índices, catálogos, facts, dimensões, integrações e proteção service-role-only. A migration ainda não foi aplicada em produção.

## 6. Incident model
`operational_incidents` possui código legível, tenant, unidade opcional, origem, owner, commander, visibilidade, tempos, resolução, idempotência e suporte offline.

## 7. Severity/status
SEV1–SEV4 são classificadas por sinais estruturados. Override exige motivo. O fluxo diferencia detected, investigating, acknowledged, contained, monitoring, resolved, closed e cancelled.

## 8. Dedup/correlation
A deduplicação usa tenant, origem, identificador, categoria e janela ativa. Incidentes manuais recebem chave exclusiva. Correlação assíncrona sugere relações e nunca confirma causalidade.

## 9. Impact model
Impactos guardam tipo, entidade, janela e valor estimado. Totais financeiros são sempre rotulados como estimativa, não valor contábil conciliado.

## 10. Responders/commander
Responders têm papéis estruturados e histórico de entrada/saída. SEV1 exige owner; commander coordena sem precisar ser o responsável técnico.

## 11. Timeline
A timeline preserva horário do evento e recebimento no servidor, usa paginação por cursor e só aceita correções como novos eventos vinculados.

## 12. Runbooks
Runbooks são versionados e possuem passos check, task, communication, action ou decision. Criação e início exigem permissão; início exige confirmação humana.

## 13. Containment
Contenção é separada de resolução. Ações reais geram aprovação no ActionEngine e permanecem `awaiting_approval`; a central não executa diretamente ações destrutivas ou financeiras.

## 14. Recovery
Recuperação permite etapas, owner, validação e rollout gradual. O estado só fica pronto para resolução quando os checks exigidos forem concluídos e validados.

## 15. War Room
Cada incidente recebe um espaço operacional com resumo, links, responders, tarefas, contenções e recuperação. Não foi criado chat paralelo.

## 16. Communications
O botão de comunicação cria rascunho auditável no Task Engine. Publicação externa nunca é automática. A vinculação à comunicação canônica da Fase 57 fica disponível quando esse módulo existir no checkout.

## 17. Postmortems
Postmortems são blameless, distinguem unknown/suspected/confirmed e só aceitam causa confirmada após revisão humana. Follow-ups continuam como tarefas canônicas.

## 18. Detection rules
Regras configuram origem, métrica, threshold, duração, histerese, cooldown e auto-create. Sinais fracos viram candidatos; confirmação ou descarte é humano.

## 19. Escalation
Metas internas por severidade cobrem reconhecimento, contenção, cadência de atualização e postmortem. A cadeia de escalada é limitada e não é apresentada como SLA legal.

## 20. Maintenance/Quality/Hardware integrations
Incidentes referenciam ordens, não conformidades, dispositivos e demais fontes oficiais por `incident_relations`, mantendo cada módulo como source of truth.

## 21. Offline/Continuity integration
IDs UUID, chave idempotente, horário do cliente e do servidor permitem sincronizar registro local simples. War room e atualizações ao vivo permanecem online.

## 22. Executive Command Center
SEV1 e SEV2 geram Attention Item deduplicado com resumo executivo, impacto, duração, owner e status, sem excesso de detalhe técnico.

## 23. Reporting/Workspace
Foi registrado o dataset `operational_incidents`, cinco relatórios e quatro widgets: ativos, crítico, impacto por unidade e postmortems pendentes.

## 24. Copilot
Dez ferramentas respondem sobre ativos, críticos, status, timeline, impacto, responders, tarefas, recuperação, recorrência e postmortems. As respostas separam fatos, hipóteses e desconhecidos.

## 25. Data Platform
Foram adicionados seis facts, quatro dimensões e nove métricas semânticas. MTTR significa tempo até recuperação operacional, não tempo de reparo.

## 26. Security/RBAC
Há 13 permissões, escopo por tenant/unidade/rede, visibilidade operational/restricted/confidential e confidencialidade padrão para segurança. Tabelas novas não ficam expostas diretamente à Data API.

## 27. Audit
Criação, severidade, status, responders, relações, contenção, recuperação, merge, split, runbooks, candidatos e postmortems deixam eventos auditáveis com motivo e correlação.

## 28. Observability
Os nomes reservados são `incident_creation_rate`, `incident_detection_lag`, `incident_notification_failures`, `war_room_updates`, `postmortem_overdue` e `incident_correlation_jobs`; jobs possuem lease, retry e dead-letter.

## 29. Tests
Há 35 testes, incluindo os 30 cenários obrigatórios, fontes canônicas, segurança do Copilot, acessibilidade e validação de fechamento crítico.

## 30. Limitations
Não há status page pública, sistema completo de plantão ou ITIL completo. A Fase 57 não está neste checkout. Valores de impacto são estimativas e exigem conciliação externa para virarem valores finais.

## 31. Recomendações para a Fase 60
Após autorizar a migration e publicação, validar dados reais em staging, calibrar thresholds por origem, cadastrar runbooks e metas por severidade, conectar o módulo canônico de comunicação quando disponível e medir falsos positivos antes de ampliar auto-create. Nenhuma implementação da Fase 60 foi iniciada.
