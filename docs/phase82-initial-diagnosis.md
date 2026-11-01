# Fase 82 — diagnóstico inicial obrigatório

## Fontes revisadas

| Domínio | Fonte oficial | Capacidade reutilizada | Limite preservado |
|---|---|---|---|
| Demanda | Fase 35, `lib/forecasting/core.ts` | `scenarioForecast`, intervalos e vintage | cenário não é previsão nem certeza |
| Supply | Fase 71 | `SupplyScenarioService` e projeção de rede | não cria pedido de compra |
| Produção central | Fase 70 | `ProductionScenarioService` | não cria ordem de produção |
| Capacidade | Fase 63 | `CapacitySimulationService` | dry-run, sem pausar canal |
| WMS | Fase 72 | throughput agregado e estoque oficial | não simula bin a bin nem escreve ledger |
| TMS | Fase 73 | rotas, custos e capacidade existentes | não despacha viagem |
| Workforce | Fase 58 | comparação agregada | não cria escala individual |
| Financeiro | Fase 17 e Fase 74 | reconciliação gerencial do IBP | não cria lançamento contábil |
| IBP | Fase 74 | cenário, constraints e execution bridge | Digital Twin referencia o cenário IBP |
| Geo/expansão | Fases 66 e 65 | topologia, cobertura e candidatos | canibalização permanece estimativa |
| Policy | Fase 79 | versão de policy congelada no snapshot | não consulta regra corrente silenciosamente |

## Simuladores encontrados

O projeto já contém `scenarioForecast`, `SupplyScenarioService`, `CapacitySimulationService`, `ProductionScenarioService`, comparação de workforce e `IBPScenarioService`. A Fase 82 não duplica esses cálculos: adiciona snapshot imutável, adapters, DAG, propagação, comparação e governança.

## Lacunas encontradas

- Não havia snapshot transversal imutável com versões dos engines.
- Os dry-runs eram isolados por domínio e não propagavam impactos.
- Não existia registro uniforme de confiança, qualidade e limitação.
- Não existia comparação reproduzível entre execuções.
- Não havia fronteira persistente garantindo zero mutação dos sistemas oficiais.

## Decisão arquitetural

Criar `digital_twin/` como control plane de simulação. O payload é derivado, reduzido e congelado; a execução usa apenas esse payload. O DAG é determinístico, tolera adapters parciais e registra hashes, versões e warnings. Resultados usam prefixo/label **SIMULAÇÃO / NÃO REAL**. Recomendações ficam em `draft` e só podem chegar a outro domínio via ActionEngine e aprovação humana.

## Limitações iniciais conscientes

- WMS é agregado; não há bin-by-bin.
- Workforce é agregado; não há escala individual.
- Transporte usa estimativas e dados de rota disponíveis.
- Sem Monte Carlo na primeira versão; intervalos usam low/base/high.
- Elasticidade não é inventada.
- Jobs estão modelados para fila; o worker distribuído depende da migration e da infraestrutura de produção.
