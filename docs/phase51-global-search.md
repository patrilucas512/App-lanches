# Fase 51 — Busca Global e Command Center

## Entrega

- Paleta global por `Ctrl/Cmd + K`, responsiva e acessível por teclado.
- Busca unificada com escopo por organização e unidade, filtros por domínio, agrupamento, estados vazio/carregando/erro e navegação contextual.
- Índice secundário em PostgreSQL com FTS, GIN e `pg_trgm`; os módulos operacionais continuam como fonte da verdade.
- Fallback federado para manter a busca útil durante reindexações ou falhas parciais.
- Indexação assíncrona com fila, lease, retentativa, backoff, idempotência e DLQ.
- Recentes, itens fixados, pesquisas salvas, comandos de navegação e ações rápidas.
- Ações mutáveis nunca são executadas pela busca: exigem confirmação reforçada e seguem para aprovação/ActionEngine.
- Telefones mascarados, metadados sensíveis removidos, documentos confidenciais filtrados por permissão e abertura auditada.
- Analytics guardam hash, tamanho, categoria, contagem e latência; nunca o texto bruto da pesquisa.
- Painel `Super Admin > Saúde da busca` com cobertura, fila, latência, zero-result e falhas.

## Operação

Defina `SEARCH_INDEXER_SECRET` (ou reutilize `CRON_SECRET`) e invoque `POST /api/global-search/indexer` com `Authorization: Bearer <segredo>`. Eventos dos módulos devem enfileirar `upsert`/`delete` em `search_index_jobs`; reindexações completas são solicitadas pela API de busca e executadas em lotes.

## Segurança e permissões

As tabelas do índice usam RLS e aceitam somente `service_role`. O servidor calcula organização, unidades e permissões a partir da sessão. O cliente nunca decide o escopo autorizado.

## Validação

O conjunto `tests/global-search-phase51.test.mjs` cobre 32 cenários estruturais e de segurança, incluindo multiunidade, mascaramento, auditoria, atalhos, índice, fallback, ações e health center.

Na ativação em produção, o índice inicial foi carregado a partir das tabelas operacionais e conferido por tipo de entidade. As próximas atualizações seguem pela fila assíncrona, sem bloquear pedidos ou atendimento.

## Limites conhecidos

- A qualidade dos resultados cresce conforme os produtores de eventos adotam o contrato de indexação.
- A primeira versão usa PostgreSQL; a interface `SearchProvider` permite trocar por um motor externo sem alterar a experiência.
- A Fase 52 não foi iniciada.
