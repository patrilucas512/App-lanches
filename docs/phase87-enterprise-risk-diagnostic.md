# Fase 87 — diagnóstico inicial

## Inventário anterior à implementação

- Incidentes: `operational_incidents` e Fase 59 já são o registro oficial; o ERM recebe referências, eventos e candidatos.
- Continuidade: Fase 86 já possui BIA, objetivos, planos, restore e riscos locais; gaps viram candidatos, sem duplicar execução.
- Confiabilidade/NOC: Fases 85/84 são fontes de SLO, error budget e saúde atual.
- Segurança: Fase 25 mantém achados técnicos; o ERM recebe apenas exposição material e respeita mascaramento.
- Qualidade/auditoria: Fases 47/67 são fonte dos achados e evidências.
- Fornecedores: Procurement/Supply Chain permanecem registros canônicos; o ERM guarda perfil de dependência e avaliação.
- Finance/FinOps, Data Governance e Integration Hub: fornecem métricas, dependências e candidatos; não são recalculados no ERM.
- Contratos/documentos: permanecem fonte de evidência referenciada, sem cópia de documento.
- Tarefas/projetos/aprovações: Fase 32 e ActionEngine/Policy Engine continuam donos da execução e aprovação.

## Decisões

1. `enterprise_risks` é o registro corporativo; registros de domínio são fontes ligadas.
2. Avaliações e matrizes são versionadas; versões históricas não são recalculadas silenciosamente.
3. Risco inerente e residual ficam em campos distintos.
4. Mapeamento de controle não prova eficácia; teste e evidência vigente são obrigatórios.
5. Aceite não encerra risco e high/critical exige expiração.
6. Não existe score único corporativo; portfólio mostra níveis, concentração, tendência e gaps explicáveis.
7. IA é assistente somente leitura/redação e não aprova decisões.
