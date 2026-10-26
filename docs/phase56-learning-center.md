# Fase 56 — Centro de Aprendizado e Universidade Corporativa

## 1. Resultado

A Fase 56 adiciona aprendizado interno, trilhas, avaliações, onboarding educacional, competências e certificações internas ao MasterApp. A implantação preserva os módulos existentes e não cria um segundo cadastro de funcionários.

## 2. Auditoria do ecossistema existente

`custom_staff_members` continua sendo a fonte oficial de funcionários. Documentos permanecem em `compliance_documents`; tarefas em `internal_tasks`; notificações na Central da Fase 52; automações na Fase 50; relatórios na Fase 54; gestão de pessoas e unidades continuam em seus domínios originais.

## 3. Limites do domínio

O Centro de Aprendizado não é folha de pagamento, RHMS, registro profissional, órgão certificador, prontuário legal ou repositório genérico de documentos. Ele organiza capacitação operacional interna.

## 4. Entitlements

Planos e unidades recebem os controles `learning_center_enabled`, `learning_paths_enabled`, `assessments_enabled`, `internal_certifications_enabled` e `learning_ai_assistant_enabled`.

## 5. Permissões

O catálogo de permissões cobre visão própria, visão de equipe, relatórios, gestão, criação, publicação, atribuição, validação prática, certificações, políticas e IA. A API sempre deriva o tenant e o escopo da sessão autenticada.

## 6. Catálogo de cursos

Cursos possuem título, resumo, categoria, dificuldade, idioma, duração, responsável e ciclo de vida: rascunho, revisão, publicado e arquivado.

## 7. Versionamento imutável

Uma versão publicada é marcada como imutável. Correções posteriores exigem nova versão, preservando a versão efetivamente cursada por cada funcionário.

## 8. Módulos e aulas

O conteúdo é ordenado por módulos e aulas. Aulas aceitam texto estruturado, vídeo, documento existente, checklist, conteúdo interativo, encontro ao vivo e link HTTPS seguro. HTML arbitrário é proibido.

## 9. Regras de conclusão

Uma aula pode concluir por abertura, visualização de 90%, checklist completo, confirmação, avaliação aprovada ou validação prática. O progresso é incremental e idempotente por evento do dispositivo.

## 10. Trilhas

Trilhas reúnem cursos em sequência e podem representar função, onboarding, desenvolvimento ou recertificação. Regras de desbloqueio ficam em estrutura declarativa segura.

## 11. Requisitos e multiunidade

Requisitos podem mirar organização, marca, região, unidade, equipe, função ou funcionário. Requisitos corporativos bloqueados são herdados e não podem ser desativados localmente; os editáveis permitem adaptação controlada.

## 12. Matrículas

Matrículas ligam o funcionário canônico ao curso e à versão publicada. A chave `employee + course + cycle` impede duplicidade em reprocessamentos, automações e recertificações.

## 13. Meu Aprendizado

A rota `/painel/aprendizado` é móvel e mostra pendências, progresso, prazos, concluídos e certificações internas. Ela não expõe controles administrativos.

## 14. Administração

A rota `/painel/treinamentos` concentra visão geral, cursos, trilhas, pessoas, conformidade, certificações e configurações. O cadastro de pessoas é apenas referenciado, nunca duplicado.

## 15. Onboarding de funcionários

`employee_learning_onboarding` liga funcionários a trilhas de entrada. Ele complementa a gestão de pessoas e não substitui o onboarding comercial do estabelecimento.

## 16. Avaliações

Avaliações suportam escolha única, múltipla escolha, verdadeiro/falso, resposta curta e prática. Limite de tentativas, nota mínima, tempo e feedback são configuráveis.

## 17. Correção segura

Gabaritos ficam em tabela acessível somente pelo serviço. A correção objetiva acontece no servidor. O navegador recebe nota, estado e feedback permitido, nunca as alternativas corretas da prova ativa.

## 18. Validação prática

Atividades práticas exigem um validador autenticado, resultado explícito, checklist e observação opcional. A aprovação pode concluir a regra prática do curso.

## 19. Certificações internas

O produto usa sempre o rótulo “Certificação interna”. O registro pode vencer ou ser revogado com motivo e auditoria. A página pública por token mostra somente dados mínimos e declara que não substitui habilitação legal ou profissional.

## 20. Certificações externas

Certificados externos podem ser cadastrados com fornecedor, validade e documento existente. O MasterApp registra a revisão documental interna; não afirma autenticidade oficial externa.

## 21. Recertificação

O worker cria ciclos determinísticos de recertificação, evitando matrículas duplicadas e preservando o histórico da certificação anterior.

## 22. Competências

Cursos podem desenvolver competências em níveis de conhecimento, prática, proficiência e especialização. A evidência registra a origem: curso, validação prática, revisão gerencial ou certificado externo.

## 23. Conformidade

Snapshots agregam atribuídos, concluídos, vencidos e certificações próximas do vencimento. Dispensas justificadas ficam fora do denominador operacional e preservam trilha de auditoria.

## 24. Integrações

Foram registrados eventos e ações para Automação, fontes para Notificações, widgets para Minha Home, métricas e dataset para Relatórios e atalhos para Busca Global.

## 25. Inteligência artificial

A IA cria somente rascunhos com fontes aprovadas. Revisão humana é obrigatória. A IA não publica curso, não corrige prova, não emite certificação e não fornece resposta ou gabarito durante avaliação.

## 26. Segurança e privacidade

Tabelas sensíveis usam acesso exclusivo do serviço; leituras de catálogo publicado têm RLS por organização. A API valida sessão, unidade, organização e função. Respostas individuais não entram no dataset analítico.

## 27. Operação assíncrona

Jobs suportam lease, tentativas, backoff, idempotência e dead-letter. O worker recalcula progresso, abre recertificações e consolida conformidade sem bloquear a interface.

## 28. Validação e implantação

A suíte da fase cobre mais de 30 cenários de domínio, segurança, avaliação, multiunidade, IA, integração e interface. A migration e o site devem ser implantados somente após autorização específica da Fase 56; nenhuma Fase 57 faz parte desta entrega.
