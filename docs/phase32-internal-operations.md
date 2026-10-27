# Fase 32 — Operações Internas do MasterApp

## Limite do domínio

Este módulo coordena o trabalho da empresa MasterApp. Ele não é usado para gerir funcionários dos restaurantes e seus dados nunca são expostos às áreas dos clientes. Suporte, Vendas, Customer Success, Incidentes, Releases e Revenue Ops continuam como fontes de verdade; o trabalho interno apenas guarda `source_type` e `source_id` para manter a rastreabilidade.

## Componentes

- projetos, tarefas, subtarefas leves e dependências sem ciclo;
- Meu Trabalho, Kanban, lista, capacidade agregada e risco com tolerância;
- comentários, menções, notas e anexos privados no Storage;
- aprovações simples ou múltiplas, com vínculo opcional ao ActionEngine;
- decisões, documentos internos versionados, reuniões e retrospectivas;
- intake de solicitações, triagem, detecção de possíveis duplicados e promoção humana para tarefa/bug;
- roadmap não público com score RICE-like explicitamente estimado;
- iniciativas estratégicas ligadas às metas da Fase 31;
- notificações com chave de deduplicação, automações desativadas por padrão e cooldown;
- copiloto consultivo que não aprova, publica, cancela ou altera metas.

## Segurança

Todas as tabelas têm RLS e políticas explícitas por operação. O acesso parte de `internal_work:view`/`internal_work:manage` e das permissões especializadas. Anexos ficam em bucket privado. A API exige confirmação humana e motivo para mutações, registra auditoria e prefere arquivamento a exclusão.

## Limitações intencionais

- não é um Jira, Notion ou calendário completo;
- não há captura de teclado, mouse, tela ou score punitivo de produtividade;
- o score de roadmap é um sinal de priorização e não uma decisão;
- automações não enviam digests até configuração explícita;
- integrações externas de calendário e busca global ficam para evolução posterior.

## Operação

A página está em `/superadmin/operacoes-internas`. A migration é `20261020003240_internal_operations_phase32.sql` e os testes dedicados rodam com `pnpm test:phase32`.
