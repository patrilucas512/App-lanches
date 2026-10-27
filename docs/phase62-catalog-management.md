# Fase 62 — Catálogo central, PIM e governança

## 1. Diagnóstico inicial

O cadastro operacional já existia em `products`, `categories`, `product_variations`, `addon_groups`, `addons` e `product_addon_groups`. Receitas e disponibilidade por insumo já pertenciam ao Inventory; custo e histórico de preço já pertenciam à Engenharia de Cardápio; estações pertenciam ao KDS; governança de rede pertencia à Fase 46. A implementação preserva essas fontes e adiciona composição, governança e publicação.

Inconsistências encontradas: produto era primariamente por loja, adicionais também existiam em `products.addon_options`, não havia precedência formal de preço por escopo/canal, não havia changeset/publicação conjunta e o menu público resolvia diretamente o catálogo operacional. A Fase 62 não remove estruturas antigas para manter pedidos e integrações compatíveis.

## 2. Arquitetura de catálogo

`products` continua sendo a fonte operacional. A arquitetura é: produto existente → assignment por unidade → overrides governados → preço/disponibilidade efetivos → menu versionado → read model publicado. Drafts nunca são servidos ao cliente.

## 3. Arquivos criados

- `lib/catalog-management/core.ts`
- `app/api/catalog-management/route.ts`
- `app/api/catalog-management/worker/route.ts`
- `app/painel/catalogo-central/page.tsx`
- `app/painel/catalogo-central/catalog.css`
- `components/catalog-governance-center.tsx`
- `supabase/migrations/20261024173740_phase62_catalog_governance.sql`
- `tests/catalog-management-phase62.test.mjs`
- este relatório

## 4. Arquivos modificados

- `components/dashboard-shell.tsx`: navegação e entitlements.
- `app/loja/[slug]/page.tsx`: usa o último read model publicado e mantém fallback compatível.
- `lib/intelligence/copilot-tools.ts`: sete ferramentas de catálogo e respostas seguras.
- `lib/automation/core.ts`: ações canônicas do Automation Center.
- `package.json`: comando `test:phase62`.

## 5. Migrations

A migration foi criada pela CLI oficial do Supabase e ainda não foi aplicada. Ela amplia tabelas existentes, cria tabelas de governança, índices de acesso, RLS, privilégios mínimos, worker com claim atômico e função transacional para substituir o catálogo publicado sem risco de menu vazio.

## 6. Product master

O master é o próprio `products`, enriquecido com `organization_id`, `master_product_id`, SKU, código interno, nome curto, tipo, status e versão. `discontinued` preserva histórico. Não existe `catalog_products` paralelo.

## 7. Store assignments

`catalog_product_assignments` relaciona o produto operacional a lojas, controla habilitação, nome/descrição/preço locais, status e política de override. Produtos existentes são associados à própria loja durante a migration sem duplicar registros.

## 8. Category hierarchy

Categorias existentes recebem organização, pai, imagem e versão. Um trigger impede ciclos e limita a profundidade inicial a três níveis. `catalog_product_categories` permite categoria principal e categorias adicionais sem duplicar produto.

## 9. Variants

`product_variations` é reutilizada e recebe código, SKU, barcode, dimensão (`size`, `flavor`, `portion`, `custom`), preço explícito opcional e status. Delta e preço final continuam distintos.

## 10. Modifiers

`addon_groups` e `addons` continuam como fonte. A camada adiciona tipo de seleção, status e integrações opcionais com receita/estoque. `product_modifier_assignments` reutiliza grupos em múltiplos produtos e admite override explícito.

## 11. Combos

`product_combos` diferencia combo de bundle. `combo_components` exige origem estruturada, limites e regra de ajuste; não aceita composição como texto livre. O preço continua sob o Pricing Engine.

## 12. Field governance

`catalog_field_policies` governa cada campo como `inherit`, `locked`, `override_allowed` ou `local_only`. O resolver informa campos bloqueados e classifica drift permitido como esperado, não como erro.

## 13. Price books

`price_books` e `price_book_items` configuram preço por organização, marca, região ou loja, canal, fulfillment e vigência. Não substituem o Pricing Engine nem o histórico da Fase 36.

## 14. Price resolver

A precedência determinística foi implementada: loja+canal → loja → região → marca → organização → preço padrão. Preços futuros só entram após a vigência. Mudanças de preço exigem aprovação válida do ActionEngine no publish worker.

## 15. Availability

Perfis contêm dias, janelas, canal, fulfillment, vigência, timezone e política de estoque. O resolver fornece resultado e motivo interno; a mensagem ao cliente é separada. Estoque `warn_only` não bloqueia. `auto_disable` só atua quando a política permitir.

## 16. Menu composition

`menu_collections`, `menu_versions`, `menu_items` e `menu_assignments` compõem múltiplos menus por loja/canal/período referenciando produtos e categorias existentes.

## 17. Changesets e versionamento

Changesets agrupam alterações com estados de draft a rollback. Itens guardam before/after e escopo. `catalog_product_versions` registra snapshot e field diff. Pedidos não são tocados.

## 18. Publish pipeline

Fluxo: validar → gerar prévia sem efeitos → confirmar → enfileirar → aplicar alterações permitidas → materializar canais → publicar atomicamente → emitir outbox. Jobs são assíncronos, idempotentes e usam `FOR UPDATE SKIP LOCKED`.

## 19. Network distribution

Jobs, waves e resultados por loja suportam piloto, percentual e rede. A falha de uma loja não obriga reaplicar todas. A interface mostra sucesso parcial como parcial.

## 20. Conflict handling

Políticas: preservar local, sobrescrever somente campos permitidos ou exigir revisão. Cada loja registra `applied`, `skipped`, `conflict` ou `failed`.

## 21. Rollback

A API gera prévia reversa a partir dos snapshots. Rollback de conteúdo, disponibilidade e preço é um novo changeset; pedidos já realizados nunca são revertidos.

## 22. Import/export

O import preview cobre CSV/XLSX, modos create/update, identificador confiável, erros por linha, duplicidade por SKU/barcode/código e proteção contra fórmula. A execução direta não é permitida. Exportações devem sanitizar células e excluir dados sensíveis.

## 23. Read models e cache

`published_catalog_read_models` guarda payload por loja/canal/hash. A função transacional recusa catálogos vazios e conserva a versão anterior se ocorrer falha. O menu público consulta primeiro o publicado e mantém fallback compatível. O hash permite revalidação de PWA/offline.

## 24. Integração Inventory, Recipes e KDS

Receitas continuam em `inventory_recipes`; componentes de adicionais apenas referenciam insumos. O catálogo lê a disponibilidade derivada e não movimenta estoque. O detalhe lê `product_station_assignments`, sem editar estação sem permissão.

## 25. Integração Pricing e Menu Engineering

Histórico e simulações da Fase 36 são reutilizados. Custo é somente leitura quando vem de receita. Classificação de engenharia pode aparecer como badge, mas nunca altera ordem ou preço automaticamente.

## 26. Integração Marketing e Journey

Campanhas e jornadas devem persistir `product_id`/categoria e snapshot comercial, nunca nome como identidade. Somente catálogo publicado pode alimentar ofertas; drafts ficam excluídos.

## 27. Reporting, Workspace e Search

Foram registrados cinco datasets, oito relatórios, quatro widgets e comandos de busca. O Search aceita modificadores, combos e changesets. A navegação ganhou “Catálogo central”.

## 28. Data Platform

Foram preparados cinco fatos e cinco dimensões, além de oito métricas sem score opaco. Custos e preços permanecem dados financeiros restritos.

## 29. Segurança e RBAC

Existem 14 permissões, com preço, custo e rede separados. Todas as novas tabelas têm RLS e acesso de `service_role`; leituras autenticadas explicitamente concedidas usam política multiempresa. Imports, mídia e conteúdo têm limites e sanitização. Cache e hashes incluem loja/canal.

## 30. Audit

Criação/alteração/arquivamento, categorias, preços, disponibilidade, modifiers, combos, políticas, publicação, rollout, rollback e import geram eventos. Visualizações comuns não são auditadas.

## 31. Observabilidade

Jobs registram tentativas, locks, erros, resultado e dead letter. Distribuição mantém resultado por loja. Outbox inclui criação/alteração de produto, preço, disponibilidade, publicação e falha de distribuição. Falha generalizada pode ser encaminhada ao módulo de Incidentes.

## 32. Tests

Há 30 testes obrigatórios cobrindo master, assignments, governança, categorias, variantes, modifiers, combos, preço, disponibilidade, menus, changesets, publicação, rollback, distribuição, import, snapshots, read model, cache, permissões, auditoria e tenant isolation.

## 33. Limitações

- A primeira versão usa ordenação manual e não personaliza menu por cliente.
- A IA apenas cria texto em draft; não gera imagem, preço nem publicação.
- O worker materializa seis canais principais; salão/garçom/terceiros já estão no modelo e podem ser habilitados conforme o fluxo operacional.
- O import implementa validação/prévia; parsing de arquivo e confirmação final permanecem no wizard da Fase 23.
- Publicação atômica é por loja/canal; redes grandes são consistentes de forma eventual e exibem falhas parciais.

## 34. Recomendações para a Fase 63

Não iniciar automaticamente. Uma próxima fase pode aprofundar CDN/crops, editor virtualizado para 10 mil produtos, wave rollback assistido, import XLSX completo, testes de carga com 100 lojas e adaptadores adicionais de canal, mantendo catálogo publicado como única fonte para clientes.
