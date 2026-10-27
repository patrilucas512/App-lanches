# Fase 37 — Relatório de entrega

## 1. Escopo
Inteligência de marketing, promoções orientadas por margem, segmentação comportamental, experimentos e atribuição. A Fase 38 não foi iniciada.

## 2. Reuso da plataforma
Clientes, segmentos, campanhas, destinatários, eventos, consentimentos, cupons, fidelidade, pedidos, previsão e rentabilidade continuam sendo as fontes canônicas. Não existe CRM paralelo.

## 3. Oportunidades
`MarketingOpportunityEngine` suporta inatividade, alto valor/baixa frequência, recompra, margem, desempenho, excesso, baixa demanda, aniversário, fidelidade, cross-sell, upsell, abandono, previsão, lançamento e categoria perdida.

## 4. Evidência mínima
Oportunidades e testes carregam tamanho da amostra e classificação. Taxas e uplift ficam indisponíveis quando a amostra mínima não é atendida.

## 5. Segmentação
Segmentos do CRM são reutilizados e aceitam leitura RFM. A audiência é pré-visualizada antes e congelada em snapshot no momento da publicação.

## 6. Privacidade
Consentimento, opt-out por canal, bloqueios, reclamações, horário silencioso, intervalo mínimo e frequência são tratados como supressões explícitas.

## 7. Promoções
Tipos estruturados: percentual, valor fixo, leve X/pague Y, frete grátis, item grátis, bundle e pontos bônus; condições e benefícios ficam em campos separados.

## 8. Margem
Guardrails existem por organização, unidade, categoria ou produto. Custo ausente impede afirmar margem; override requer permissão e motivo; loss leader é explícito.

## 9. Simulação
O simulador retorna preço, desconto, margem, break-even, estoque, capacidade e riscos. Ele não presume conversão.

## 10. Planejador
Wizard objetivo-first em dez etapas: objetivo, escopo, público, oferta, margem, estoque/capacidade, conteúdo, canal/horário, experimento e aprovação.

## 11. Capacidade e estoque
Alertas comparam pedidos assumidos pelo operador com estoque e capacidade. Previsão é sinal, não ordem automática.

## 12. Conteúdo assistido
IA pode propor rascunhos e recomendações, mas não publica nem envia mensagens.

## 13. Canais
WhatsApp, web, push e e-mail são representados com políticas por canal; métricas do provedor só aparecem quando eventos reais existem.

## 14. Orquestração
Publicação cria snapshot e lotes idempotentes em `marketing_delivery_jobs`. A fila inclui rate limit, tentativas, próximo retry, pausa e dead letter; nenhum envio ocorre dentro do request HTTP.

## 15. Testes A/B
Cada experimento aceita uma variável primária, métrica principal, métricas de proteção, grupo de controle e amostra mínima.

## 16. Atribuição
Receita atribuída, margem atribuída e incrementalidade são separadas. A interface explica que atribuição não prova causalidade.

## 17. ROI e ROAS
ROI só é calculado quando existe custo de campanha; ROAS só quando existe investimento de mídia paga.

## 18. Multiloja
Todas as entidades usam `organization_id` e `store_id`, com RLS por organização e escopo de unidade.

## 19. Copiloto Gerencial
Ferramentas: oportunidades, melhor audiência, rentabilidade da campanha, inativos, candidatos de alta margem, janelas de baixa demanda, atribuição e simulação.

## 20. Ações sensíveis
Criar, aprovar, publicar e pausar campanhas e ativar/desativar promoções exigem confirmação; ações em lote usam confirmação reforçada.

## 21. Auditoria
Eventos registram ator, entidade, motivo, estados anterior/posterior e metadados. Previews expiram e distinguem confirmação de execução.

## 22. Segurança e dados
Todas as tabelas analíticas têm RLS e grants explícitos. A fila é exclusiva do `service_role`. O mart e quatro regras de qualidade foram registrados no catálogo analítico.

## 23. Validação e publicação
Foram executados 32 testes da fase e build de produção completo. A migração foi aplicada no projeto Supabase e o artefato publicado pelo fluxo de Sites.
