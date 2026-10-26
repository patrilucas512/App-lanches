# Fase 36 — Engenharia de Cardápio e Rentabilidade

## Objetivo

Transformar vendas, ficha técnica, estoque, canais e previsões em uma leitura gerencial rastreável de margem de contribuição, popularidade e oportunidades comerciais. O módulo não confunde margem com lucro líquido e nunca altera preços, cria promoções ou monta combos automaticamente.

## Arquitetura

- `MenuProfitabilityService`: cálculo determinístico de custo, margem, saúde, matriz e recomendações.
- `/api/profitability`: agregação por organização e unidade, simulações e fluxo protegido de ações.
- `/painel/engenharia-cardapio`: visão gerencial com abas, matriz 2x2, diagnósticos, simulador e histórico.
- Banco: configurações, metas, snapshots, recomendações, simulações, previews, histórico de preço e auditoria.
- Copiloto: ferramentas de leitura e simulação; ações sensíveis continuam exigindo permissão e confirmação humana.

## Fontes e rastreabilidade

O custo de produto parte da ficha técnica (`inventory_recipes`) e do custo médio do item de estoque (`inventory_items.average_cost_cents`). Embalagem, gateway, marketplace, subsídio e outros custos variáveis podem ser configurados separadamente. A análise comercial usa fatos de pedidos aprovados, por canal e unidade. Previsões de demanda entram apenas como contribuição identificada, nunca como fato realizado.

Cada cálculo informa o estado do custo:

- `complete`: todos os componentes necessários estão disponíveis e atuais;
- `partial`: existe custo conhecido, mas a ficha ou os componentes estão incompletos;
- `missing`: não há base suficiente para calcular;
- `outdated`: a fonte existe, porém está desatualizada.

Dados ausentes permanecem ausentes. O serviço não inventa custo nem elasticidade.

## Métricas

- Receita aprovada: soma dos itens de pedidos aprovados no período.
- CMV conhecido: custo variável conhecido multiplicado pela quantidade vendida.
- Margem de contribuição estimada: preço menos custos variáveis conhecidos.
- Margem percentual: margem de contribuição estimada dividida pelo preço.
- Rentabilidade por canal: aplica taxas e subsídios específicos sem misturar canais.
- Popularidade: quantidade normalizada dentro da categoria ou globalmente, conforme configuração.

Impostos e custos fixos só entram quando fornecidos como dados identificáveis. Por isso, a interface declara que margem bruta estimada não é lucro líquido.

## Matriz de engenharia de cardápio

A classificação usa mediana e normalização no escopo escolhido:

1. Estrela: popularidade e margem acima da referência.
2. Popular com margem baixa: vende bem, mas exige análise de custo ou preço.
3. Rentável com pouca saída: margem saudável, baixa popularidade.
4. Baixa saída e baixa margem: item crítico para revisão gerencial.

## Recomendações explicáveis

Toda recomendação registra motivo, métricas, confiança, fonte de dados e ação sugerida. Exemplos: revisar ficha técnica incompleta, investigar compressão de margem, melhorar exposição de item rentável, simular novo preço, testar combo ou complemento. Recomendações são propostas, não comandos automáticos.

## Segurança de alteração de preço

Fluxo obrigatório:

`Recomendação → Simulação → Preview de impacto → Confirmação humana → Permissão → Atualização → Histórico e auditoria`

O preview guarda o preço esperado. Se outra alteração ocorrer antes da execução, a operação é recusada. Mudanças em lote exigem confirmação reforçada e revalidam cada item. A reversão usa o mesmo fluxo de preview e só é aceita quando o preço atual corresponde ao histórico selecionado.

## Isolamento e permissões

Todas as tabelas analíticas carregam `organization_id` e `store_id`. RLS e políticas explícitas limitam a leitura ao tenant autorizado. Escritas passam pelo servidor e pelo conjunto de permissões:

- `menu_profitability:view`
- `menu_profitability:manage`
- `pricing:view`
- `pricing:simulate`
- `pricing:change`
- `pricing:bulk_change`
- `menu_engineering:view`

## Estado inicial dos dados

No diagnóstico de implantação havia produtos e pedidos suficientes para exibir a estrutura, mas apenas uma ficha técnica e um item de estoque, sem base de complementos, combos, compras ou desperdícios. Portanto, a primeira leitura deve aparecer como parcial/insuficiente até que o estabelecimento complete fichas técnicas e custos. Isso é comportamento esperado e evita falsa precisão.

## Operação e evolução

- Cache é invalidado após atualização confirmada de catálogo.
- Sincronização com marketplaces não é presumida; o resultado informa quando não foi solicitada.
- Alterações futuras podem usar a tabela de agendamento, mantendo preview, confirmação e auditoria.
- Snapshots permitem comparação histórica sem reescrever fatos antigos.
- Flags de plano e unidade controlam liberação gradual do recurso.

## Validação

A suíte `test:phase36` cobre cálculo, dados incompletos, canais, classificação, histórico, compressão, metas, simulação, elasticidade, cesta, combos, complementos, variações, fornecedor, multiunidade, previsão, recomendações, Action Engine, lote, permissões, auditoria, RLS, interface e Copiloto.

