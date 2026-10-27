# Fase 58 — Planejamento avançado de escalas e cobertura

## 1. Resumo executivo
Foi criada uma camada de planejamento sobre a Gestão de Pessoas existente. Ela prevê demanda, calcula cobertura por função/faixa, mantém versões de escala, oferece turnos abertos, cenários e custo gerencial. A publicação continua exclusivamente humana.

## 2. Diagnóstico do legado
O cadastro canônico continua em `custom_staff_members`, funções em `staff_roles`, escalas em `work_shifts`, disponibilidade em `employee_availability`, ponto em `time_clock_entries`, templates em `work_shift_templates`, trocas em `shift_exchange_requests` e publicação em `schedule_publications`. Nenhum sistema paralelo de funcionários, ponto ou folha foi criado.

## 3. Modelo canônico e integrações
Fase 18 fornece pessoas, ponto e custos; Fase 35 fornece o contexto de previsão; Fases 41/42 fornecem cozinha/salão; Fase 56 fornece skills; Fases 50/52 tratam automações seguras e notificações; Fases 53/54 recebem widgets e datasets; Fase 46 sustenta o escopo multiunidade.

## 4. Banco, entidades e migrations
Novas entidades: permissões do planejador, regras de staffing, requisitos de cobertura e skills, cenários, forecast de headcount, versões de escala, turnos abertos/interesses, exceções, cobertura ao vivo, jobs, auditoria e fatos analíticos. As tabelas existentes foram apenas ampliadas quando eram canônicas.

## 5. Planejador visual
A rota `/painel/escalas` oferece visão semanal, filtros de período, criação de versão, formulário acessível alternativo ao arrastar, cartões por pessoa/função/estação e validação no servidor.

## 6. Cobertura e previsão de demanda
O `StaffingDemandService` usa razão de produtividade, mínimo/máximo, drivers ponderados, fonte, versão, data e confiança. A tela compara necessário, escalado e gap por faixa, com texto além de cor.

## 7. Regras, validações e overrides
São validados intervalo, sobreposição, disponibilidade, unidade, função, skills, carga configurada e descanso configurado. Overrides permitidos exigem motivo e ficam auditáveis. As regras são organizacionais, não alegações universais de conformidade legal.

## 8. Skills e treinamento
Requisitos de função apontam para `learning_skills` e o domínio do colaborador vem de `employee_learning_skills`. Políticas `warn`, `supervisor_override` e `block` são configuráveis.

## 9. Sugestões assistidas e explicabilidade
O serviço gera alternativas A/B usando disponibilidade, elegibilidade, skills, carga programada, finais de semana e fechamentos. Não usa atributos sensíveis, não escolhe sozinho e não publica.

## 10. Versionamento, templates e cópia
`work_schedules` preserva versões e snapshots publicados. `schedule_templates` é uma view segura sobre o template canônico. Cópias são marcadas e revalidadas contra indisponibilidades.

## 11. Publicação
Publicar exige permissão, validação sem bloqueios e confirmação humana. O snapshot é imutável no histórico e os turnos recebem versão/publicação.

## 12. Minha Escala
A rota `/equipe/escala` apresenta próximos turnos, unidade/função, confirmação operacional de leitura e solicitação de troca. “Visualizado” não representa aceite jurídico.

## 13. Trocas e turnos abertos
Funcionários podem demonstrar interesse ou solicitar troca. A decisão oficial permanece com o gestor autorizado; não existe auto-designação.

## 14. Tempo real e exceções
Cobertura ao vivo cruza planejado com presença do ponto. Atraso por regra continua incerto até confirmação humana; no-show definitivo exige confirmação.

## 15. Custos e orçamento
O cálculo usa taxa agregada por função quando o usuário não possui permissão de detalhe. Valores individuais nunca aparecem no resultado e a saída é explicitamente gerencial, não folha ou cálculo legal.

## 16. Cenários
Base, Pico, Evento, Chuva e Promoção podem ser comparados sem alterar a escala publicada.

## 17. Multiunidade
Todas as entidades têm `organization_id` e, quando aplicável, `store_id`. Permissões de rede são separadas das permissões locais.

## 18. RBAC
Permissões: visualizar, criar, editar, publicar, aprovar, ver custo, gerenciar regras, turnos abertos, trocas e rede. Proprietário/administrador/gerente/supervisor recebem padrões; concessões específicas ficam em tabela própria.

## 19. Privacidade e segurança
Dados detalhados ficam server-side. Novas tabelas têm RLS, acesso apenas por `service_role` e rotas autenticadas com verificação de organização/unidade. A UI evita exposição desnecessária de motivos pessoais.

## 20. Auditoria
Criação de regra, forecast, turno, versão, publicação e exceção registra ator, entidade, motivo e estado relevante.

## 21. Jobs, idempotência e DLQ
O worker usa lease, tentativas, retry e dead letter. Ele atualiza projeções, mas é proibido de designar pessoas ou publicar escala.

## 22. Analytics e camada semântica
Fatos de demanda, turnos, cobertura, turnos abertos, trocas e variação de custo alimentam métricas de cobertura, gap e mão de obra.

## 23. Relatórios
Datasets e templates foram registrados para planejado versus realizado, gaps, trocas, custo versus budget e histórico de publicação.

## 24. Workspace e notificações
Widgets e eventos foram registrados para gaps, picos, turnos abertos, alterações publicadas e solicitações pendentes.

## 25. Automações permitidas
Pode notificar, preparar rascunho, detectar gaps e sugerir opções. Não pode designar, publicar, reduzir horas, punir ou desligar.

## 26. Copiloto
O Copiloto reconhece forecast, cobertura, turnos abertos, avisos, custo versus budget, cobertura ao vivo e próximos picos; fornece fatos/opções/impacto e direciona ao planejador.

## 27. Feature flags
`advanced_workforce_planning_enabled`, `staffing_forecast_enabled`, `schedule_builder_enabled`, `open_shifts_enabled` e `labor_planning_enabled` controlam plano e unidade.

## 28. UX e acessibilidade
Tema escuro consistente, layout responsivo, estados textuais, alertas com `role`, formulário acessível e status que não dependem apenas de cor.

## 29. Testes
Há 38 testes: os 30 cenários obrigatórios e verificações adicionais de rascunho, versionamento, publicação, turnos abertos, interesse voluntário, trocas, no-show, notificações e auditoria.

## 30. Limitações conhecidas
Previsões começam com modelo de razão explicável e dependem da qualidade do histórico. A precisão melhora após calibração por unidade/função. Regras legais devem ser configuradas e revisadas por especialistas da organização.

## 31. Operação e observabilidade
Jobs e auditoria permitem acompanhar falhas, tentativas e freshness. Alertas devem observar gaps críticos, jobs mortos e forecasts antigos.

## 32. Recomendações para a Fase 59
Recomenda-se calibrar modelos por sazonalidade, adicionar conectores externos de clima/eventos e testes E2E com dados reais anonimizados. Nenhuma funcionalidade da Fase 59 foi implementada.
