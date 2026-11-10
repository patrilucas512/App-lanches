// Departamentos do menu do painel, na ordem em que aparecem. Cada item do menu pertence a um só;
// departamento sem item liberado pelo plano não aparece.
export const departmentLabels = {
  inicio: "Início",
  pedidos: "Pedidos e Vendas",
  atendimento: "Atendimento ao Cliente",
  loja: "Cardápio e Loja Online",
  equipe: "Equipe",
  estoque: "Estoque e Compras",
  financeiro: "Financeiro",
  inteligencia: "Relatórios e Inteligência",
  rede: "Rede e Unidades",
  governanca: "Governança e Integrações",
  conta: "Conta e Ajuda",
} as const;

export type Department = keyof typeof departmentLabels;
export const departments = Object.keys(departmentLabels) as Department[];
