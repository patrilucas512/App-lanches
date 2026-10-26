# Fase 35 — Forecasting e inteligência preditiva

## Diagnóstico dos dados em 20/10/2026

A fonte única é a Data Platform da Fase 34. O diagnóstico de produção encontrou 25 pedidos em 9 dias ativos, 30 itens de pedido, uma organização e uma unidade. `analytics_fact_inventory_movements` e `analytics_fact_delivery` ainda não possuem fatos; também não há escalas futuras nem reservas. O histórico de pedidos vai de 08/08/2026 a 22/09/2026. Essa amostra não sustenta precisão alta, granularidade de 15 minutos ou modelos complexos.

O sistema, portanto, inicia em **low data mode**: usa baseline simples, mantém confiança baixa, amplia o intervalo, explica a limitação e impede a publicação de previsão dinâmica ao cliente. Clima e eventos externos não são usados porque não existe integração confiável. Feriados podem entrar apenas quando houver calendário oficial; eventos locais entram como contexto estruturado informado pelo gestor.

## Arquitetura

`analytics_fact_orders` e `analytics_fact_order_items` alimentam a camada de features agregadas por tenant/unidade. O pipeline faz validação temporal, separa treino e validação, compara média móvel, seasonal naive e suavização exponencial, executa backtest e publica apenas um champion versionado. Previsões carregam modelo, faixa, confiança, contexto, forecast de sistema, ajuste humano e forecast operacional final.

O treinamento usa a fila lógica `analytics_forecasting` e possui quota diária por tenant. Nowcasting atualiza a leitura com o realizado do próprio dia sem retreinar a cada pedido. Drift de volume, mix, horário, ticket e erro do modelo degrada o champion e recomenda fallback ao baseline.

## Baselines e backtest

- média móvel das últimas observações;
- seasonal naive pelo mesmo dia da semana/faixa horária;
- suavização exponencial como challenger estatístico;
- split temporal, nunca aleatório;
- MAE, RMSE, WAPE, bias, underforecast e overforecast;
- MAPE é armazenável, mas não é a métrica principal em volumes próximos de zero.

## Forecasts operacionais

- Pedidos, receita e ticket: sempre exibidos como ponto mais intervalo.
- Produto e categoria: agregação por item do warehouse.
- Estoque: demanda de produto × ficha técnica da Fase 16; o saldo atual só contextualiza o risco.
- Equipe: demanda versus throughput histórico de equipe, sem avaliação punitiva individual.
- Delivery: carga e faixa provável, sem prometer prazo ao cliente.
- Reservas: sinal futuro forte quando houver dados.
- Multiunidade: modelos e previsões têm `organization_id` e `store_id`; consolidado nunca mistura tenants.

## Recomendações e controle humano

Recomendações podem sugerir estoque, compra, preparo, equipe, delivery, disponibilidade ou transferência. Estados: `suggested`, `accepted`, `dismissed`, `completed`. Aceitar registra a decisão; não cria compra, não ajusta estoque, não escala funcionário, não altera preço e não despacha motoboy.

Overrides guardam valor, modo, motivo e usuário. O treino continua usando apenas o realizado — nunca o override. Cenários base/alta/baixa e what-if são rotulados como cenário, não previsão.

## Manager Copilot

Ferramentas aprovadas: `getDemandForecast`, `getPeakHoursForecast`, `getProductDemandForecast`, `getInventoryRiskForecast`, `getStaffingForecast`, `getDeliveryLoadForecast` e `getForecastAccuracy`. Toda resposta inclui previsão, faixa, confiança, fatores de contexto e recomendação humana.

## Segurança e privacidade

RLS protege todas as tabelas expostas. Leitura exige escopo analítico da organização; escrita ocorre apenas nas rotas de servidor auditadas. Artefatos não armazenam PII. Não há modelo global, compartilhamento entre empresas ou treino com dados privados de outro tenant. A migração concede acesso de forma explícita, compatível com a mudança da Data API anunciada pelo Supabase.

## Limitações atuais

- amostra real insuficiente para confiança alta;
- ausência de histórico de estoque, delivery, escalas e reservas no warehouse;
- sem clima, calendário oficial ou eventos externos automáticos;
- sem ML complexo, modelo global ou canibalização entre lojas;
- custo e duração são observáveis, mas o executor batch dedicado ainda é uma evolução futura;
- previsão para cliente permanece desativada até o gate de qualidade ser aprovado.

## Recomendação para a Fase 36

Consolidar pelo menos 8 a 12 semanas de histórico, completar a ingestão operacional no warehouse e criar o executor assíncrono agendado com monitoramento de custo. Só depois avaliar modelos avançados por tenant, mantendo champion/challenger e baseline obrigatório. A Fase 36 não foi iniciada.
