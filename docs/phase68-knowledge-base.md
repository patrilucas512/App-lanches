# Fase 68 — Knowledge Base Operacional

## 1. Diagnóstico inicial
Documents já era o repositório documental, Learning cuidava de cursos, Global Search tinha FTS/trigram, Auditorias e Incidentes possuíam seus próprios registros. Não havia pgvector nem uma camada governada de procedimentos. A solução referencia esses domínios, sem copiá-los.

## 2. Arquitetura Knowledge Base
Uma camada service-only reúne artigos, versões, chunks, ACL, busca, respostas fundamentadas, governança e integrações. Keyword funciona sem IA; embeddings são assíncronos e opcionais.

## 3. Arquivos criados
Migration da Fase 68, núcleo de domínio, API, central, leitor, ajuda contextual, estilos, testes e este documento.

## 4. Arquivos modificados
Dashboard, Copilot gerencial, Automation Center e scripts do projeto.

## 5. Migrations
Cria entidades `knowledge_*`, fatos/dimensões, índices FTS/HNSW, RPCs seguras, RLS service-only, registros de automação, relatórios, métricas e integrações por FK.

## 6. Article model
Tipos: SOP, FAQ, guia, troubleshooting, playbook, policy, reference, script, how-to, referência de runbook e custom. Estado, audiência, confidencialidade, owner, vigência e escopo são explícitos.

## 7. Versioning
Cada alteração cria uma versão imutável. A versão anterior permanece. Atualização maior exige revisão e pode exigir reacknowledgement.

## 8. SOP structure
Metadados e passos estruturados suportam instrução, check, decisão, alerta, escalada e referência a ação registrada. Não há execução arbitrária.

## 9. Collections
Coleções hierárquicas têm no máximo três níveis e proteção contra ciclos.

## 10. Scope/governance
Escopos de organização, marca, região, loja, função, equipe e sistema; herança segue a rede e é avaliada antes da recuperação.

## 11. Local addenda
Adendos complementam SOP corporativo bloqueado sem alterar ou duplicar o pai. Conflitos vão para revisão humana.

## 12. Sources
Referências apontam para Documents, manuais de fornecedor, runbooks, cursos e outras fontes configuradas, com validade e seção.

## 13. Review workflow
Reutiliza `internal_approvals`; publicação exige revisão, aprovação e confirmação humana. Conteúdo customer-safe exige permissão específica.

## 14. Keyword search
FTS em português e correspondência exata de título operam por RPC com tenant, escopo e confidencialidade dentro da consulta.

## 15. Embeddings/vector search
`pgvector` usa dimensão 384 e HNSW. O provider é abstrato; sem provedor saudável, o sistema mantém a busca por palavra.

## 16. Hybrid retrieval
Combina título exato, keyword, semantic score, estado vigente e deduplicação de artigos.

## 17. KnowledgeAnswerService
Responde somente a partir de resultados autorizados e publicados. Sem fonte, retorna exatamente: “Não encontrei procedimento aprovado para isso.”

## 18. Citations
Toda resposta traz artigo, versão, seção e link para o leitor.

## 19. Contextual help
Botão global de ajuda consulta o registro de contexto da rota e abre um painel não bloqueante.

## 20. Documents integration
Documents permanece fonte oficial; Knowledge guarda referências e metadados, não uma segunda biblioteca.

## 21. Learning integration
Versões de curso podem registrar artigo e versão de origem. Mudança no SOP cria revisão, nunca altera o curso automaticamente.

## 22. Audit integration
Itens de template podem apontar para o artigo relacionado e abrir o procedimento vigente.

## 23. Incident/Support integration
Runbooks e artigos de suporte podem apontar para Knowledge. Respostas a clientes continuam como rascunho para revisão humana.

## 24. Offline integration
Policy, versão e TTL são explícitos. Conteúdo confidencial não fica offline e versão antiga nunca é servida silenciosamente quando há conexão.

## 25. Feedback/gaps
Feedback é agregado. Buscas sem resultado armazenam apenas hash e podem sugerir lacunas; nunca publicam artigo automaticamente.

## 26. Reporting/Workspace
Widgets, datasets, relatórios e métricas foram registrados para uso pelos motores existentes.

## 27. Data Platform
Fatos de busca, leitura, feedback, revisão e resposta preservam chaves do tenant e não armazenam prompts completos.

## 28. Security/RBAC
Treze permissões, RLS, service-role only, filtros dentro da RPC e controle separado para confidencialidade e customer-safe.

## 29. Prompt-injection protections
Conteúdo ingerido é dado não confiável: HTML ativo, scripts, event handlers e padrões de segredo são recusados; instruções embutidas não são executadas.

## 30. Audit
Criação, versionamento, publicação, acesso confidencial e mudanças de estado produzem eventos com ator, motivo e correlação.

## 31. Observability
Eventos registram latência, modo, contagem e hash. Fila de embeddings tem tentativas, backoff, lock e dead-letter lógico.

## 32. Tests
Trinta testes cobrem criação, versionamento, SOP, fontes, coleções, escopos, adendos, lock, revisão, agenda, depreciação, buscas, ACL, confidencialidade, citações, recusa, integrações, offline, feedback, lacunas, RBAC, injeção, cache e tenant.

## 33. Limitations
Embeddings dependem de provider externo ainda não configurado; não há comunicação interna completa neste checkout, apenas a ação de rascunho registrada. A migration precisa ser aplicada antes do uso da API.

## 34. Recommendations for Phase 69
Em uma futura instrução separada, avaliar provider de embeddings, worker assíncrono, reindexação controlada, testes E2E com dados reais e rollout por feature flag. A Fase 69 não foi iniciada.
