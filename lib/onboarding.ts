export const businessTypes = ["Restaurante","Hamburgueria","Pizzaria","Lanchonete","Bar","Pub","Food truck","Cafeteria","Marmitaria","Açaiteria","Delivery","Outro"] as const;

export const operationalQuestions = [
  ["dine_in","Possui salão?"],["delivery","Trabalha com delivery?"],["pickup","Possui retirada?"],
  ["own_drivers","Possui motoboys próprios?"],["whatsapp","Usa WhatsApp?"],["multi_store","Possui mais de uma unidade?"],
  ["kitchen","Possui cozinha?"],["inventory","Precisa de estoque?"],["reservations","Precisa de reservas?"],
  ["finance","Precisa de controle financeiro?"],["ai","Deseja IA?"],
] as const;

export const menuTemplates: Record<string,string[]> = {
  hamburgueria:["Hambúrgueres","Combos","Bebidas","Porções"],
  pizzaria:["Pizzas","Bordas","Bebidas","Sobremesas"],
  cafeteria:["Cafés","Lanches","Doces","Bebidas"],
  acaiteria:["Açaís","Complementos","Combos","Bebidas"],
  restaurante:["Destaques","Pratos","Bebidas","Sobremesas"],
};

export type OnboardingStep = {
  id:string; step_key:string; status:"pending"|"in_progress"|"completed"|"skipped"|"blocked"|"not_applicable";
  applicable:boolean; required:boolean; blocked_reason?:string|null; assigned_to?:string|null; configured_by?:string|null;
  onboarding_step_catalog?: {title:string;description:string;sort_order:number;skippable:boolean;route?:string|null;entitlement_key?:string|null}|null;
};

export function safeImportCell(value:unknown){
  const text=String(value??"").trim();
  return /^[=+@]/.test(text)||/^-[^\d]/.test(text)?`'${text}`:text;
}

export function parseMoneyToCents(value:unknown){
  const normalized=String(value??"").trim().replace(/R\$/gi,"").replace(/\s/g,"").replace(/\.(?=\d{3}(?:\D|$))/g,"").replace(",",".");
  const number=Number(normalized); return Number.isFinite(number)&&number>=0?Math.round(number*100):null;
}

export function onboardingProgress(steps:OnboardingStep[]){
  const applicable=steps.filter(step=>step.applicable&&step.status!=="not_applicable");
  const done=applicable.filter(step=>step.status==="completed"||step.status==="skipped");
  return applicable.length?Math.round(done.length/applicable.length*100):100;
}
