# Fase 39 — Compras Inteligentes

## Diagnóstico inicial

A implementação reaproveita `inventory_items`, `inventory_movements`, `inventory_recipes`, `suppliers`, `supplier_inventory_items`, `purchase_orders`, `purchase_order_items`, `purchase_receipts`, `purchase_receipt_items`, custo médio ponderado, `forecast_inventory_requirements`, `inventory_transfers`, `financial_entries`, Data Platform e auditoria. Nenhum segundo cadastro de fornecedor ou sistema de compras foi criado.

## Entrega

- `ReplenishmentService`: estoque disponível, consumo previsto, lead time, safety stock configurável, ponto de reposição, MOQ, pack size, cobertura, ruptura, excesso, validade e capital empatado.
- `SupplierPerformanceService`: preço, variação, pontualidade, lead time real, fill rate, rejeição, divergências, qualidade, volume e amostra.
- recomendações versionadas com evidência, confiança, prioridade e decisão humana;
- histórico de preços, cotações, RFQ em rascunho e comparação por custo total/prazo/confiabilidade;
- rascunho de PO reutilizando `purchase_orders`, com threshold de aprovação e sem envio automático;
- recebimento ampliado com qualidade, avaria, temperatura aplicável, lote, validade e incidentes;
- three-way match entre PO, recebimento e invoice, sem pagamento automático;
- compra versus transferência e consolidação sem elevar risco de ruptura;
- impacto gerencial em caixa e orçamento sem bloqueio automático;
- dashboard `/painel/compras`, revisão diária, spend analysis e Procurement Copilot;
- fatos/dimensões e métricas semânticas do Procurement Mart;
- permissões, RLS, grants explícitos, auditoria e isolamento por tenant.

## Limitações responsáveis

O sistema não envia pedidos, paga fornecedores, altera dados bancários, transfere estoque ou escolhe fornecedor automaticamente. Economia só pode ser chamada estimada quando houver baseline. Stockout datetime só é apresentado com qualidade suficiente. Portal completo de fornecedor, WhatsApp de fornecedor e cálculo estatístico avançado de safety stock ficam preparados, não implementados.

## Recomendação para a Fase 40

Priorizar validação operacional com dados reais, política de aprovação dupla, integração documental fiscal e piloto controlado do portal do fornecedor. A Fase 40 não foi iniciada.
