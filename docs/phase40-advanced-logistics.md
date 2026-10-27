# Fase 40 — Logística Avançada

## 1. Diagnóstico inicial

O projeto já possuía o domínio canônico de delivery: `deliveries`, `delivery_assignments`, `delivery_events`, `driver_profiles`, `driver_availability`, `driver_locations`, `delivery_zones`, PIN, ETA, custódia, agrupamento e a área PWA do motoboy. A Fase 40 estende essas estruturas; não existe um segundo sistema de delivery.

## 2. Arquivos criados

- `lib/logistics/core.ts`
- `app/api/logistics/route.ts`
- `components/logistics-command-center.tsx`
- `app/painel/logistica/page.tsx`
- `app/painel/logistica/logistics.css`
- `supabase/migrations/20261021032754_advanced_logistics_phase40.sql`
- `tests/advanced-logistics-phase40.test.mjs`

## 3. Arquivos modificados

- `components/dashboard-shell.tsx`
- `package.json`

## 4. Migration e delivery jobs

`deliveries` permanece a entidade de trabalho de entrega. Recebe organização, unidade, cliente/endereço, prioridade, deadlines, motoboy atribuído, rota, zona e custo estimado. A sincronização original com `orders` continua sendo a fonte do job.

## 5. DispatchService

Implementa modos manual, assistido e automático configurável. O ranking exclui motoboy offline, pausado, fora da capacidade, unidade, zona ou veículo autorizado e mostra distância, capacidade, acréscimo de rota e risco de SLA. A RPC usa `FOR UPDATE`, idempotency key e auditoria.

## 6. RouteOptimizationService

Rotas e paradas permitem múltiplas entregas. Batching verifica direção, prontidão, capacidade, desvio máximo e tempo máximo do alimento. O fallback aproximado não inventa coordenadas e não paralisa o delivery quando o provider falha.

## 7. Zonas e ETA

Zonas suportam raio, polígono, bairro e faixa de CEP, prioridade de sobreposição, taxa-base, valor por km e SLA. A taxa não muda automaticamente. O ETA separa preparo, espera de despacho, viagem e buffer e sempre é exibido como faixa.

## 8. Tracking e aplicativo do motoboy

Tokens são armazenados somente como hash e expiram. Localização fica vinculada ao turno/rota, com frequência configurável, qualidade de GPS, deduplicação e retenção limitada. O aplicativo existente continua responsável por rota, coleta, PIN, entrega e ocorrências; dados de outros motoboys não são expostos.

## 9. Incidentes e logística externa

Incidentes cobrem endereço, cliente, veículo, acidente, dano, pagamento e bloqueio. Acidente vai para revisão do supervisor e não força continuação. Providers externos têm abstração, cotações e registros separados; nenhuma contratação é feita automaticamente.

## 10. Custos, forecast e analytics

Custo gerencial soma motorista, distância, provider, embalagem e subsídio, sempre rotulado como estimativa. A capacidade futura cruza previsão de entregas e capacidade disponível, mas não contrata nem escala pessoas. Foram adicionadas dimensões/fatos e sete métricas semânticas de logística.

## 11. Manager Copilot e ActionEngine

Ferramentas: operação, pendências, capacidade, sugestões de rota, atrasos, custos, zonas e forecast. A resposta separa situação, risco, opções e recomendação. Ações de atribuir, reatribuir, criar/otimizar rota, cotar/criar delivery externo e pausar auto-dispatch exigem confirmação, exceto auto-dispatch previamente habilitado e limitado por guardrails.

## 12. Privacidade, permissões e auditoria

Nove permissões de logística foram declaradas. Tabelas usam grants explícitos, RLS e isolamento por organização/unidade. A localização histórica, telefone pessoal e pedidos de terceiros não aparecem no tracking. Atribuição, reatribuição, rota, incidente, override e decisões automáticas são auditáveis.

## 13. Testes

Trinta testes cobrem os 27 cenários obrigatórios, além de Central de Despacho, confirmação humana e garantia de não iniciar a Fase 41.

## 14. Limitações

- Sem credencial de mapas configurada, distância e ETA usam fallback aproximado e claramente identificado.
- O mapa operacional é leve e não carrega milhares de marcadores.
- Offline complexo, proxy telefônico e prova fotográfica não foram adicionados.
- Custo é estimativa enquanto todos os componentes não forem configurados.

## 15. Recomendações para a Fase 41

Validar um provider real de mapas por ambiente, definir política jurídica de retenção de localização, calibrar custos e SLAs com dados reais e executar um piloto de auto-dispatch antes de ampliar a automação. A Fase 41 não foi iniciada.
