# Fase 48 — Ativos e Manutenção

## 1. Diagnóstico inicial

O Hardware Hub já é a fonte de dispositivos digitais; `kitchen_equipment`, estações, fornecedores, itens de estoque, padrões/checklists, financeiro, qualidade, offline e multiunidade já existiam. A fase adiciona uma camada operacional de ativos e referências a essas entidades, sem duplicá-las.

## 2. Arquitetura de ativos

`assets` é a ficha central multiempresa/multiunidade. Categorias são customizáveis. Vínculos opcionais conectam Hardware Hub, cozinha, local de estoque, fornecedor e substituição. QR usa token aleatório armazenado somente como hash e a ficha continua autenticada.

## 3–5. Arquivos e migrations

- Migration `20261022080000_phase48_asset_management.sql`.
- Core de regras em `lib/asset_management/core.ts`.
- API autenticada em `app/api/asset-management/route.ts`.
- Interface móvel/responsiva em `/painel/ativos`.
- Navegação e entitlements integrados ao painel.

## 6–15. Domínio operacional

Inclui assets, categorias, documentos privados, planos preventivos, OS, falhas, inspeções, calibração, downtime, custos, garantias, cotações, peças, fornecedores de manutenção e transferências com histórico. OS não pode regredir; conclusão exige resultado e serviço executado; ações críticas exigem confirmação reforçada.

## 16–19. Integrações

Hardware é vinculado por `hardware_device_id`; cozinha por `kitchen_equipment_id` e links de capacidade; qualidade por não conformidade; unidades são filtradas pelo escopo da organização. Offline usa UUID e chave de idempotência.

## 20–22. Analytics, Copilot e ActionEngine

Foram criadas facts/dimensions, KPIs operacionais, ferramentas de consulta do Copilot e lista explícita de ações. IA não aprova orçamento, não diagnostica tecnicamente e ações críticas exigem permissão/confirmacão humana.

## 23–25. Offline, permissões e auditoria

Relato de falha, inspeção e nota técnica podem entrar na fila offline. As permissões conceituais cobrem visualização, gestão, transferência, atribuição, conclusão, custos, analytics e configurações. Todas as tabelas públicas têm RLS, acesso de aplicação apenas por serviço confiável e eventos imutáveis de auditoria; não há fluxo de exclusão do histórico.

## 26. Testes

O contrato automatizado cobre os 27 casos obrigatórios, mais reutilização de engines, ActionEngine/Copilot e navegação.

## 27. Limitações

Não há depreciação fiscal, marketplace de técnicos, IoT/horímetro simulado, ML preditivo ou portal amplo de fornecedor. MTBF/MTTR só devem ser exibidos quando houver amostra suficiente. Estimativa de downtime não é receita perdida comprovada.

## 28. Recomendações para a Fase 49

Manter telemetria e manutenção preditiva desativadas até existirem dados confiáveis; evoluir assinatura de documentos, portal restrito do prestador e políticas de disponibilidade somente sob nova instrução. A Fase 49 não foi iniciada.
