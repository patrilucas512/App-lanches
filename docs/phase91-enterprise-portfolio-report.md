# Fase 91 — Relatório final de Enterprise Portfolio Management

## 1. Resumo executivo
A Fase 91 cria um plano de controle empresarial para demandas, iniciativas, investimentos, capacidade, dependências e benefícios, sem substituir a execução oficial de projetos.

## 2. Diagnóstico realizado
O diagnóstico prévio está registrado em `docs/phase91-enterprise-portfolio-diagnostic.md`, cobrindo entidades, fontes canônicas, integrações, duplicidades e lacunas.

## 3. Decisões de arquitetura
A solução é aditiva, orientada a adapters, separa controle de portfólio de execução e preserva aprovações nos módulos oficiais.

## 4. Contextos de portfólio
Foram definidos `masterapp_internal_portfolio` e `tenant_enterprise_portfolio`, com regras distintas de pertencimento e escopo.

## 5. Multi-tenancy
O contexto tenant exige `organization_id`; vínculos cruzados entre tenants são recusados nos serviços e protegidos no banco.

## 6. Modelo de permissões
O catálogo contém 18 permissões granulares para visualizar, propor, priorizar, financiar, planejar capacidade, revisar e administrar.

## 7. Intake de demandas
Demandas possuem origem, tipo, solicitante, patrocinador, escopo, evidências de triagem e ciclo de vida controlado.

## 8. Triagem
O `PortfolioDemandTriageService` verifica dono, escopo e evidência, retornando elegibilidade explicável.

## 9. Duplicidades de demanda
O mecanismo somente sugere candidatos; nenhuma demanda é mesclada automaticamente.

## 10. Iniciativas
Iniciativas mantêm chave, tipo, tema, programa, patrocinador, dono, saúde e datas-alvo, com transições válidas explícitas.

## 11. Programas
Programas agrupam iniciativas sem apagar a identidade ou a governança individual de cada item.

## 12. Temas estratégicos
Temas fornecem agrupamento corporativo versionável por contexto.

## 13. Vínculo com projetos
`initiative_project_links` referencia `internal_projects` da Fase 32; interromper uma iniciativa não altera automaticamente o projeto.

## 14. Vínculo com mudanças
Mudanças da Fase 88 são referenciadas por `initiative_change_links`, sem cópia do registro operacional.

## 15. Vínculo com riscos
Riscos da Fase 87 permanecem canônicos e podem ser associados a iniciativas e tratamentos.

## 16. Vínculo com arquitetura
Capabilities da Fase 90 são referenciadas para demonstrar gaps e estado-alvo.

## 17. Vínculo com objetivos
Metas da Fase 55 são referenciadas para cobertura estratégica e rastreabilidade.

## 18. Business cases
Business cases são versionados, preservam histórico e separam problema, opções, premissas, custos, benefícios, riscos e dependências.

## 19. Análise financeira
ROI simples, payback, NPV, IRR e custo total exigem premissas mínimas e nunca inventam taxa, moeda ou fluxo de caixa.

## 20. Benefícios estimados
Benefícios monetários, operacionais, estratégicos e qualitativos são separados por tipo, unidade, confiança e fonte.

## 21. Priorização
Frameworks versionados armazenam critérios, pesos, escalas, gates, evidências e racional por avaliação.

## 22. Gates obrigatórios
Continuidade, regulação interna e risco podem classificar uma iniciativa como obrigatória sem ocultar a regra aplicada.

## 23. Dependências
O grafo suporta dependências entre iniciativas, projetos, capabilities, arquitetura, funding, mudanças e terceiros.

## 24. Prevenção de ciclos
Há validação em serviço e trigger SQL para impedir ciclos em dependências entre iniciativas.

## 25. Funding
Solicitações registram período, tipo, valor solicitado/aprovado, moeda, orçamento de origem, status e referência de aprovação.

## 26. Capacidade
Planos e requisitos mantêm escopo, período, unidade, disponibilidade, comprometimento e confiança.

## 27. Conflitos de capacidade
Conflitos são sinalizados para revisão humana; unidades incompatíveis bloqueiam cálculos agregados.

## 28. Cenários
Cenários permitem plano-base, restrição orçamentária, crescimento, risco, confiabilidade, expansão e composição customizada.

## 29. Simulação
Resultados são aconselhativos, preservam premissas, restrições, rastreio de cálculo e não alteram o baseline aprovado.

## 30. Sequenciamento
O sequenciamento respeita dependências e não modifica datas dos projetos oficiais.

## 31. Roadmaps
Roadmaps suportam mês, trimestre ou ano, horizontes atual/próximo/futuro e swimlanes por domínio.

## 32. Realização de benefícios
Planos e medições distinguem benefício esperado, realizado, parcial, em risco e não realizado.

## 33. Revisões de valor
Revisões comparam custo, prazo, benefícios, redução de risco, impacto em capabilities e lições aprendidas.

## 34. Reviews de portfólio
Pacotes mensal, trimestral, anual ou ad hoc registram período, material e decisões necessárias.

## 35. Decisões
Decisões de financiar, adiar, cancelar, acelerar, reduzir escopo, suspender ou reavaliar são imutáveis após o registro.

## 36. Baselines
Baselines aprovados são versionados, possuem hash, referência de aprovação e bloqueio de reescrita histórica.

## 37. Processamento assíncrono
`portfolio_jobs` suporta filas, tentativas, leasing, falha e dead letter para simulação e atualizações pesadas.

## 38. Auditoria
Eventos registram contexto, tenant, ator, ação, recurso, correlação e metadados seguros.

## 39. Interface
A rota `/painel/estrategia/portfolio` oferece 15 áreas: visão geral, demandas, iniciativas, programas, business cases, priorização, cenários, funding, capacidade, dependências, roadmap, benefícios, reviews, analytics e configurações.

## 40. Centro Executivo
Foi adicionada a aba Portfólio, com visão resumida de prioridades, decisões e projetos e link para a gestão detalhada.

## 41. Reporting
Templates e datasets de portfólio foram registrados em `lib/reporting/core.ts`.

## 42. Data Platform
Fatos, dimensões, métricas e lineage foram registrados em `lib/data-platform/core.ts`.

## 43. Workspace e busca
Sete widgets e tipos de busca/comandos foram registrados, além da navegação do painel.

## 44. Copiloto
O catálogo contém somente ferramentas de leitura e análise; o copiloto não aprova funding nem executa decisão crítica.

## 45. Segurança do banco
As tabelas habilitam RLS, revogam acesso público/anon/authenticated, concedem acesso operacional ao `service_role` e usam view com `security_invoker`.

## 46. Testes e validação
A suíte da Fase 91 cobre serviços, isolamento, finanças, cenários, dependências, imutabilidade, integrações e estrutura da migration. Regressões, lint, QA e build são executados antes da entrega.

## 47. Implantação e limite de escopo
A migration foi preparada localmente, mas não aplicada ao Supabase de produção e o site não foi publicado nesta etapa. A Fase 92 não foi iniciada.
