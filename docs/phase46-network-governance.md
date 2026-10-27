# Fase 46 — Governança de redes e franquias

## 1. Escopo entregue
Centro corporativo de rede para marcas, regiões, clusters e unidades, sem criar uma segunda estrutura de organizações ou lojas.

## 2. Arquitetura reutilizada
`organizations` continua sendo o tenant e `establishments` continua sendo a unidade operacional. Produtos, fornecedores, pessoas, faturamento, onboarding, auditoria, suporte e fatos analíticos existentes foram referenciados.

## 3. Hierarquia
Organização → marca → região → cluster → loja. Marca, região e cluster são opcionais; uma loja pode existir diretamente na organização.

## 4. Classificação das unidades
Uma unidade pode ser própria, franquia, operada por parceiro ou outra. A classificação é operacional e não altera propriedade legal.

## 5. Papéis e permissões
Foram definidos 12 privilégios de rede. A visualização financeira sensível é independente das demais permissões.

## 6. Escopo de acesso
O backend cruza organização, associação ativa e unidades liberadas. A interface não é usada como barreira de segurança.

## 7. Políticas tipadas
Configurações são registradas por domínio, chave, versão de esquema, escopo, valor JSON, vigência e controles de override/aprovação/sensibilidade.

## 8. Herança
A resolução segue organização → marca → região → cluster → loja, sempre expondo origem, versão, autor, data e se houve override.

## 9. Pré-visualização
Mudanças centrais informam quantidade de unidades afetadas, overrides e conflitos antes da aplicação.

## 10. Confirmação reforçada
Alterações em massa e rollouts exigem frase digitada; não são publicados apenas por um clique acidental.

## 11. Rollouts
Rollouts são divididos em piloto, grupo e rede, com alvo por loja, tentativas, erro isolado e chave de idempotência.

## 12. Rollback
O sistema registra se rollback é tecnicamente possível e não promete reversão quando ela não existe.

## 13. Catálogo central
Produtos corporativos referenciam o produto existente e controlam propriedade, versão, campos liberados e estado por loja.

## 14. Templates de menu
Templates cobrem hamburgueria, pizzaria, bar, café, restaurante e formato customizado.

## 15. Preços
Há zonas e políticas fixa central, sugerida, faixa mínima/máxima e controle local, com histórico por unidade.

## 16. Fornecedores
Fornecedores existentes recebem status de rede, acordos e solicitações temporárias de exceção.

## 17. Padrões operacionais
Checklists, padrões internos, execuções e auditorias explicáveis suportam rotina, atendimento, estoque, caixa, hardware, limpeza e segurança alimentar interna.

## 18. Ações corretivas
Problemas de auditoria podem gerar responsável, prazo, estado e evidência fotográfica.

## 19. Drift
Desvios são classificados como override intencional, mudança não autorizada, versão antiga ou falha de sincronização. A correção não é automática sem política.

## 20. Exceções
Pedidos de exceção têm motivo, mudança solicitada, aprovador, prazo e estados pendente/aprovado/rejeitado/expirado/revogado.

## 21. Comunicados
Comunicados aceitam escopo e confirmação individual de leitura.

## 22. Benchmark e privacidade
Resultados são agregados e só aparecem com amostra mínima de três unidades. Financeiro de outro franqueado permanece protegido.

## 23. Expansão
Abertura de loja reutiliza onboarding e permite copiar somente menu, estações, papéis, rotas de hardware, zonas e checklists. Clientes, pedidos, pagamentos, pessoas, segredos e tokens são bloqueados.

## 24. Copiloto e Action Engine
O Copiloto possui nove ferramentas de leitura. Ações governadas passam pelo Action Engine, exigem preview e confirmação e não podem ser publicadas autonomamente pela IA.

## 25. Validação e operação
A entrega inclui cinco feature flags, tabelas fato/dimensão, catálogo semântico, RLS fechada para clientes, auditoria corporativa, API paginada, painel responsivo e 30 testes automatizados. A Fase 47 não foi iniciada.
