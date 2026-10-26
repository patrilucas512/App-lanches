# Fase 73 — Gestão de Transporte (TMS)

1. **Objetivo:** coordenar transporte B2B e interno sem substituir delivery ao consumidor.
2. **Diagnóstico:** WMS, transferências, Supply Chain, Geo, Ativos, Financeiro e Incidentes já eram fontes oficiais.
3. **Decisão arquitetural:** o TMS referencia esses registros; não replica estoque, veículos, fornecedores ou entregas.
4. **Escopo:** ordens, cargas, viagens, rotas, paradas, POD, ocorrências, custos e transportadoras.
5. **Fora do escopo:** entrega ao consumidor da Fase 40 e recebimento físico do WMS.
6. **Ordens:** `transport_orders` liga expedição, transferência, origem e destino.
7. **Cargas:** `transport_loads` consolida ordens com revisão gerencial.
8. **Itens:** `transport_load_items` preserva pacote, handling unit e lote.
9. **Veículos:** perfil TMS estende `assets` por chave estrangeira.
10. **Motoristas:** perfil mínimo, sem duplicar RH.
11. **Transportadoras:** cadastro operacional opcionalmente vinculado ao fornecedor.
12. **Viagens:** uma viagem referencia uma carga, recurso e planejamento.
13. **Rotas:** sequência aprovada e versão de sugestão preservada.
14. **Paradas:** coleta, entrega e retorno com ordem e janela.
15. **Capacidade:** peso, volume e pallets; dado ausente vira alerta explícito.
16. **Compatibilidade:** cadeia fria, lote e disponibilidade de ativo são bloqueios configuráveis.
17. **Consolidação:** sugestão determinística; nunca despacha automaticamente.
18. **Despacho:** requer carga conferida, revisão humana e permissão específica.
19. **WMS:** expedição é a fonte do conteúdo e do handoff.
20. **Estoque:** transição usa `dispatch_internal_transfer`; não há ledger paralelo.
21. **POD:** entregue, parcial, falha ou devolução com evidência.
22. **PIN:** somente hash; não há biometria facial.
23. **Recebimento:** POD não confirma entrada no estoque; o WMS continua responsável.
24. **Ocorrências:** atraso, avaria, temperatura, segurança e acidente podem abrir candidatos de incidente.
25. **Custos:** previsto, estimado e realizado permanecem identificados.
26. **Financeiro:** custo guarda referência; não cria lançamento financeiro silencioso.
27. **Rate cards:** calculam cotação estimada e não contratam automaticamente.
28. **Geo:** provedor é adaptador; heurística é marcada como estimativa.
29. **Tracking:** desligado por padrão, condicionado a consentimento, viagem ativa e retenção.
30. **Offline:** comandos idempotentes preservam horário do aparelho e são revalidados no servidor.
31. **RBAC:** gestão e motorista possuem permissões separadas.
32. **Auditoria:** despacho, POD, configurações e custos geram trilha.
33. **RLS:** todas as tabelas operacionais são isoladas por organização.
34. **Analytics:** fatos e dimensões do transporte ficam na camada semântica.
35. **Relatórios:** nove datasets e nove métricas certificadas foram registrados.
36. **Copiloto:** apenas ferramentas aprovadas, sem GPS inventado nem execução crítica automática.
37. **Interface:** central responsiva com doze áreas e nove indicadores executivos.
38. **Operação e rollout:** flags por plano, fallback manual autorizado, health check e nenhum início da Fase 74.
