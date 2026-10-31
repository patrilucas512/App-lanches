# Fase 89 — Process Intelligence / Process Mining

## 1. Resumo executivo
Camada analítica de processos concluída localmente, sem assumir execução operacional.
## 2. Escopo entregue
Catálogo, event log, casos, DFG, variantes, tempos, gargalos, retrabalho, conformance, comparações e oportunidades.
## 3. Limites de responsabilidade
Os domínios de origem continuam donos dos fatos e das ações.
## 4. Diagnóstico obrigatório
Registrado em `phase89-process-intelligence-diagnostic.md` antes da implementação.
## 5. Reuso arquitetural
Reutiliza Data Platform, Data Governance, Automation Center, Policy Engine, Incidentes e Change Management.
## 6. Catálogo de processos
Processos têm owner, domínio, subtipo, início, fim, status e finalidade analítica.
## 7. Pilotos
Pedido→cozinha, incidente→recuperação, mudança→validação e integração→reconciliação.
## 8. Definição de caso
Case ID explícito e versionado; falhas vão para quarentena.
## 9. Mapeamento de atividades
Mapeamentos são versionados, publicados e preservam histórico.
## 10. Event log
Log mínimo, normalizado e sem replicação de payload bruto.
## 11. Deduplicação
Chave única por organização, domínio e evento de origem.
## 12. Ordenação
Timestamp, sequência e ID determinístico; empates sem sequência ficam parciais.
## 13. Eventos tardios
Casos podem ser marcados para recomputação assíncrona.
## 14. Cobertura
Mede início, fim, atividades desconhecidas e anomalias de ordenação.
## 15. Qualidade dos dados
Duplicatas, timestamps impossíveis, case ID ausente e atividades desconhecidas são evidenciados.
## 16. Descoberta de processo
Directly-Follows Graph determinístico com frequência, participação, mediana e p90.
## 17. Legibilidade do grafo
Threshold mínimo reduz ruído sem alterar o conjunto original.
## 18. Variantes
Hash estável da sequência, frequência, tempo mediano, retrabalho e falhas.
## 19. Tempo de ciclo
P50, p75, p90 e p95 consideram apenas casos concluídos.
## 20. Tempo de espera
Calculado em handoffs/atividades explicitamente classificadas; tempo ativo não é inventado.
## 21. Gargalos
Achados explicam transição, mediana e p90, sem atribuição individual.
## 22. Retrabalho
Repetições não esperadas são separadas de retries previstos.
## 23. Conformance
Compara fluxo real com modelo esperado publicado; sem modelo, resultado é desconhecido.
## 24. Desvios
Atividade obrigatória ausente, inesperada, duplicada e violação de sequência.
## 25. Comparações
Período, unidade, canal e grupo comparável exibem amostra e cobertura.
## 26. Causalidade
Antes/depois e marcadores de mudança representam correlação, não prova causal.
## 27. Oportunidades
Geram hipóteses com evidência, confiança e revisão humana.
## 28. Automação
Integrações criam tarefas, notificações e rascunhos; nunca executam melhoria automaticamente.
## 29. Segurança
Tabelas com RLS, revogação de papéis públicos e acesso exclusivo via service role.
## 30. Isolamento multi-tenant
Toda entidade analítica persistida contém `organization_id`.
## 31. Privacidade
Sem payload bruto, PII ou ranking de funcionário.
## 32. Permissões
Onze permissões granulares complementam a permissão do domínio de origem.
## 33. Auditoria
Análises solicitadas e rascunhos de melhoria são auditados.
## 34. Escala
Jobs assíncronos, agregados e índices por organização/processo/período/caso.
## 35. Reprodutibilidade
Runs registram versão de entrada, método, período, amostra e cobertura.
## 36. Data Platform
Fatos, dimensões, métricas semânticas e linhagem registrados.
## 37. Reporting
Dez datasets e dez modelos de relatório disponíveis.
## 38. Workspace
Seis widgets incluídos para gargalos, retrabalho, ciclo, desvios, oportunidades e cobertura.
## 39. Copilot
Onze ferramentas somente leitura, com separação entre fato, correlação e hipótese.
## 40. Interface
Doze abas em Analytics → Process Intelligence, responsivas e coerentes com o tema escuro.
## 41. Validação
Suíte dedicada com 60 testes funcionais, de segurança, integração e contrato.
## 42. Estado de publicação
Código e migration estão locais. A migration da Fase 89 não foi aplicada e o site não foi publicado; ambos aguardam autorização explícita. A Fase 90 não foi iniciada.
