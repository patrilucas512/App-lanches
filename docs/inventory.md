# Estoque integrado

## Onde configurar
Painel → Estoque. Somente proprietário e gerente. Reutiliza a identidade visual compartilhada.

1. Cadastre produtos físicos ou ingredientes em un, g, kg, ml ou l.
2. Registre a contagem física como entrada com motivo/documento.
3. Vincule os produtos existentes aos itens de estoque em Fichas técnicas.
4. Defina mínimo e, opcionalmente, bloqueio por falta de saldo.

## Regras
- Não há carga de vendas históricas, saldos inventados ou vínculos automáticos.
- Produtos sem ficha técnica mantêm o funcionamento anterior.
- Cada novo item de pedido do cliente ou garçom baixa os insumos vinculados na mesma transação.
- Pix pendente também compromete saldo. Se abandonado, o pedido deve ser cancelado.
- Vendas diretas do caixa baixam estoque; recebimentos de pedidos existentes não repetem a baixa.
- Adicionais são multiplicados pela quantidade escolhida e pela quantidade do produto.
- Ingredientes retirados não consomem a linha correspondente.
- Nomes de adicionais/ingredientes devem coincidir com o cardápio; renomeá-los exige revisar a ficha.
- Não há conversão automática de unidades.
- Cancelamento antes de preparo devolve a quantidade originalmente baixada, uma vez.
- Após preparo, entrega ou estorno do PDV, eventual devolução física é ajuste manual com motivo.
- Linhas de pedido já movimentadas não podem ser editadas/apagadas; preservar cancelamento e histórico.
- Arquivamento exige saldo zero e ausência de vínculos. Movimentos nunca são excluídos.
- Sem bloqueio, saldos negativos ficam visíveis para reposição; com bloqueio, pedido insuficiente falha integralmente.

## Segurança e validação
Tabelas novas com RLS, sem escrita direta pelo cliente. RPCs autorizam tenant e papel.
Implementações privilegiadas ficam no schema inventory_private, sem ampliar acesso ao schema private existente.
Movimentos com chave de idempotência, snapshot de quantidade, ator e saldo após operação.
Uma trava transacional por estabelecimento serializa ajustes, fichas e baixas.
Testes SQL executados em transação com ROLLBACK: entradas duplicadas, adicionais, retiradas,
Pix, venda duplicada no caixa, cancelamentos, preparo, PDV, garçom, falta de saldo e RPC/RLS autenticada.
Não houve teste físico com scanner, contagem real nem entrega. Não há integração fiscal ou compras de fornecedores nesta etapa.
