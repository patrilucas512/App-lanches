# Diagnóstico da Fase 90 — Arquitetura Empresarial

## 1. Arquitetura atual

O MasterApp opera como um monólito modular em Next.js, com domínios isolados em `lib/`, APIs por módulo em `app/api/`, páginas administrativas em `app/painel/` e persistência multi-tenant no Supabase. A Fase 90 deve preservar esse desenho e acrescentar uma camada de relacionamento, planejamento, visualização e governança, sem assumir a execução dos domínios operacionais.

## 2. Fontes canônicas já existentes

| Conceito arquitetural | Fonte canônica | Regra de integração |
| --- | --- | --- |
| Processos | Fase 89, `process_definitions` | Referenciar o processo; não copiar definição ou eventos. |
| Serviços | Fase 85, `reliability_services` | Referenciar o serviço; SLI, SLO e incidentes continuam na confiabilidade. |
| Dados | Fase 76, `data_assets` | Referenciar o ativo; contrato e lineage continuam na governança de dados. |
| Integrações | Fases 20/81, registro e orquestração | Referenciar a integração; credenciais, jobs e payloads não entram na arquitetura. |
| Ativos | Fase 48, `assets` | Referenciar o ativo quando representar tecnologia física ou lógica. |
| Riscos | Fase 87, `enterprise_risks` | Associar riscos existentes; avaliação e tratamento continuam no risco empresarial. |
| Mudanças | Fase 88, `change_requests` | Referenciar mudanças; aprovação e execução continuam no Change Management. |
| Projetos e trabalho | Fase 32, projetos/tarefas internas | Referenciar iniciativas; execução permanece no trabalho interno. |
| Módulos e features | Fase 77, `feature_definitions` | Relacionar aplicações e capacidades; rollout continua no Feature Management. |

## 3. Limite funcional

A Arquitetura Empresarial será proprietária somente de capacidades, aplicações, componentes tecnológicos, relacionamentos arquiteturais, avaliações, padrões, ADRs, exceções, snapshots, target states, roadmaps, dívida técnica, análises de impacto, drift e reconciliação. Ela não executará deploy, mudança, automação, integração, processo, tratamento de risco ou trabalho de projeto.

## 4. Contextos e isolamento

O modelo terá dois contextos incompatíveis:

- `masterapp_platform_architecture`: arquitetura interna da plataforma, sem `organization_id`, acessível apenas ao Super Administrador.
- `tenant_business_architecture`: arquitetura empresarial do cliente, sempre vinculada a uma `organization_id`.

Relacionamentos entre contextos e entre tenants serão rejeitados. Todas as tabelas públicas terão RLS, privilégios revogados para `anon` e `authenticated`, acesso de backend por `service_role` e filtragem explícita na API. Visões públicas serão `security_invoker`.

## 5. Diagnóstico de duplicidade

Os maiores riscos de duplicação são tratar feature como aplicação, serviço como aplicação, processo como capacidade e ativo como componente tecnológico. A Fase 90 manterá tipos de entidade distintos e relacionamentos tipados entre eles. Registros descobertos serão candidatos com confiança e fonte; somente confirmação humana os tornará fatos arquiteturais governados.

## 6. Escala e grafo

O grafo será persistido como arestas tipadas e um read model de adjacência. Travessias terão profundidade e quantidade de nós limitadas, detecção de ciclos e continuidade assíncrona para análises grandes. A interface exibirá recortes por domínio, capacidade ou aplicação, nunca um grafo ilimitado.

## 7. Lacunas que a Fase 90 deve preencher

- hierarquia de capacidades L1 a L4;
- registro de aplicações com ownership e ciclo de vida;
- taxonomia de relacionamentos e matriz de compatibilidade;
- avaliações dimensionais sem nota opaca;
- portfólio tecnológico, padrões, ADRs e exceções com validade;
- heatmaps, gaps, redundâncias, dependência única e readiness de retirada;
- baselines, target states, roadmaps, modernização e dívida técnica;
- drift e reconciliação preservando metadados manuais;
- datasets analíticos, widgets, notificações, permissões e ferramentas de Copilot.

## 8. Decisão de implementação

A implementação será aditiva, reversível e compatível com as fases anteriores. Não haverá DDL destrutivo, cópia de payload operacional, alteração automática de fontes canônicas ou execução automática de recomendações. Toda ação material produzirá auditoria, e toda sugestão será explicável, revisável e convertida apenas em rascunho quando integrar outro domínio.
