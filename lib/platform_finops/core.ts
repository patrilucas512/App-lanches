/* Internal Platform FinOps. All monetary math is fixed-point bigint; JavaScript float is never used. */
const BIG_ZERO=BigInt(0),SCALE=BigInt(12),FACTOR=BigInt(10)**SCALE;
export type DecimalInput=string|bigint|number;
export class DecimalValue{
  readonly atoms:bigint;
  private constructor(atoms:bigint){this.atoms=atoms}
  static parse(value:DecimalInput){if(typeof value==="bigint")return new DecimalValue(value*FACTOR);const text=String(value).trim();if(!/^-?\d+(\.\d+)?$/.test(text))throw new Error(`INVALID_DECIMAL:${text}`);const negative=text.startsWith("-"),clean=negative?text.slice(1):text,[whole,fraction=""]=clean.split("."),atoms=BigInt(whole)*FACTOR+BigInt((fraction+"0".repeat(Number(SCALE))).slice(0,Number(SCALE)));return new DecimalValue(negative?-atoms:atoms)}
  static fromAtoms(atoms:bigint){return new DecimalValue(atoms)}
  add(other:DecimalValue){return new DecimalValue(this.atoms+other.atoms)}
  sub(other:DecimalValue){return new DecimalValue(this.atoms-other.atoms)}
  mul(other:DecimalValue){return new DecimalValue(this.atoms*other.atoms/FACTOR)}
  div(other:DecimalValue){if(other.atoms===BIG_ZERO)throw new Error("DIVISION_BY_ZERO");return new DecimalValue(this.atoms*FACTOR/other.atoms)}
  max(other:DecimalValue){return this.atoms>=other.atoms?this:other}
  min(other:DecimalValue){return this.atoms<=other.atoms?this:other}
  abs(){return new DecimalValue(this.atoms<BIG_ZERO?-this.atoms:this.atoms)}
  isNegative(){return this.atoms<BIG_ZERO}
  toString(scale=8){const neg=this.atoms<BIG_ZERO,raw=neg?-this.atoms:this.atoms,whole=raw/FACTOR,fraction=(raw%FACTOR).toString().padStart(Number(SCALE),"0").slice(0,scale).replace(/0+$/,"");return `${neg?"-":""}${whole}${fraction?`.${fraction}`:""}`}
}
const d=(value:DecimalInput|DecimalValue)=>value instanceof DecimalValue?value:DecimalValue.parse(value);
const zero=()=>d("0");
export const decimal=(value:DecimalInput)=>d(value);
export const sumDecimalStrings=(values:Array<string|number|bigint>)=>values.reduce<DecimalValue>((sum,value)=>sum.add(d(value)),zero()).toString();

export type PricingModel="per_unit"|"tiered"|"volume_tiered"|"fixed_monthly"|"fixed_plus_usage"|"percentage"|"minimum_commit"|"custom_safe_formula";
export type RateComponent={tierFrom?:string|null;tierTo?:string|null;unitPrice:string;fixedFee?:string|null;percentage?:string|null;minimumFee?:string|null};
export type CostCalculation={status:"estimated"|"unknown";amount:string;method:"direct_meter"|"unknown";quality:"direct"|"unknown";explanation:string};

function fixed(components:RateComponent[]){return components.reduce((total,x)=>total.add(d(x.fixedFee||"0")),zero())}
function minimum(components:RateComponent[]){return components.reduce((value,x)=>value.max(d(x.minimumFee||"0")),zero())}
export function calculateProviderCost(input:{pricingModel:PricingModel;quantity:string;components:RateComponent[];percentageBasis?:string}) : CostCalculation{
  const quantity=d(input.quantity),components=[...input.components].sort((a,b)=>d(a.tierFrom||"0").atoms<d(b.tierFrom||"0").atoms?-1:1);
  if(!components.length)return{status:"unknown",amount:"0",method:"unknown",quality:"unknown",explanation:"No effective rate card; unknown is not zero."};
  let amount=zero();
  if(input.pricingModel==="per_unit")amount=quantity.mul(d(components[0].unitPrice));
  else if(input.pricingModel==="fixed_monthly")amount=fixed(components).add(d(components[0].unitPrice));
  else if(input.pricingModel==="fixed_plus_usage")amount=fixed(components).add(quantity.mul(d(components[0].unitPrice)));
  else if(input.pricingModel==="percentage")amount=d(input.percentageBasis||"0").mul(d(components[0].percentage||"0")).div(d("100")).max(minimum(components));
  else if(input.pricingModel==="minimum_commit")amount=quantity.mul(d(components[0].unitPrice)).max(fixed(components).add(minimum(components)));
  else if(input.pricingModel==="tiered"){
    for(const component of components){const from=d(component.tierFrom||"0"),to=component.tierTo?d(component.tierTo):quantity;if(quantity.atoms<=from.atoms)continue;amount=amount.add(quantity.min(to).sub(from).mul(d(component.unitPrice)))}
    amount=amount.add(fixed(components)).max(minimum(components));
  }else if(input.pricingModel==="volume_tiered"){
    const match=components.find(x=>quantity.atoms>=d(x.tierFrom||"0").atoms&&(!x.tierTo||quantity.atoms<d(x.tierTo).atoms))||components.at(-1)!;amount=quantity.mul(d(match.unitPrice)).add(d(match.fixedFee||"0")).max(d(match.minimumFee||"0"));
  }else{
    return{status:"unknown",amount:"0",method:"unknown",quality:"unknown",explanation:"Custom formula requires a reviewed safe-formula adapter."};
  }
  return{status:"estimated",amount:amount.toString(),method:"direct_meter",quality:"direct",explanation:`${input.pricingModel} using the effective versioned rate card.`};
}

export function convertCurrency(input:{amount:string;from:string;to:string;fxRate?:string|null;fxRateDate?:string|null}){
  if(input.from===input.to)return{status:"converted" as const,amount:d(input.amount).toString(),fxRate:"1",fxRateDate:input.fxRateDate||null};
  if(!input.fxRate||!input.fxRateDate)return{status:"unknown" as const,amount:null,reason:"Historical FX rate is required; current FX cannot backfill history."};
  return{status:"converted" as const,amount:d(input.amount).mul(d(input.fxRate)).toString(),fxRate:d(input.fxRate).toString(),fxRateDate:input.fxRateDate};
}

export type AllocationDriver={key:string;driverQuantity:string};
export function allocateSharedCost(totalCost:string,drivers:AllocationDriver[]){
  if(!drivers.length)return{status:"unknown" as const,allocations:[],unallocated:d(totalCost).toString(),quality:"unknown" as const};
  const total=d(totalCost),driverTotal=drivers.reduce((sum,x)=>sum.add(d(x.driverQuantity)),zero());
  if(driverTotal.atoms===BIG_ZERO)return{status:"unknown" as const,allocations:[],unallocated:total.toString(),quality:"unknown" as const};
  let allocatedAtoms=BIG_ZERO;const allocations=drivers.map((driver,index)=>{const weight=d(driver.driverQuantity).div(driverTotal),amount=index===drivers.length-1?DecimalValue.fromAtoms(total.atoms-allocatedAtoms):total.mul(weight);allocatedAtoms+=amount.atoms;return{key:driver.key,driverQuantity:d(driver.driverQuantity).toString(12),weight:weight.toString(12),amount:amount.toString(12)}});
  return{status:"allocated" as const,allocations,unallocated:"0",quality:"high_confidence" as const};
}

export function validateAttribution(input:{sourceIds:string[];exclusiveBucketKeys:string[];estimatedSourceIds:string[];providerReportedSourceIds:string[]}){
  const duplicate=(values:string[])=>values.filter((x,i)=>values.indexOf(x)!==i),overlap=input.estimatedSourceIds.filter(x=>input.providerReportedSourceIds.includes(x));
  const issues=[...duplicate(input.sourceIds).map(x=>`duplicate_source:${x}`),...duplicate(input.exclusiveBucketKeys.filter(Boolean)).map(x=>`double_exclusive_bucket:${x}`),...overlap.map(x=>`estimated_and_reported:${x}`)];
  return{valid:issues.length===0,issues};
}

export function reconcileProviderCost(input:{estimated:string;reported:string;toleranceAmount:string;tolerancePercent:string}){
  const estimated=d(input.estimated),reported=d(input.reported),variance=reported.sub(estimated),absolute=variance.abs(),amountTolerance=d(input.toleranceAmount),percentTolerance=estimated.atoms===BIG_ZERO?zero():estimated.mul(d(input.tolerancePercent)).div(d("100")),allowed=amountTolerance.max(percentTolerance);
  const status=absolute.atoms===BIG_ZERO?"matched":absolute.atoms<=allowed.atoms?"within_tolerance":"mismatch";
  return{status,variance:variance.toString(),variancePercent:estimated.atoms===BIG_ZERO?null:variance.div(estimated).mul(d("100")).toString(),allowedVariance:allowed.toString()};
}

export function calculateTechnicalMargin(input:{grossRevenue?:string|null;credits?:string|null;discounts?:string|null;paymentFees?:string|null;directCost?:string|null;allocatedOverhead?:string|null}){
  if(input.grossRevenue==null||input.directCost==null)return{status:"unknown" as const,reason:"Revenue and direct platform cost are required."};
  const gross=d(input.grossRevenue),net=gross.sub(d(input.credits||"0")).sub(d(input.discounts||"0")).sub(d(input.paymentFees||"0")),cost=d(input.directCost).add(d(input.allocatedOverhead||"0")),margin=net.sub(cost);
  return{status:"calculated" as const,grossRevenue:gross.toString(),netRevenue:net.toString(),platformCogs:cost.toString(),technicalMargin:margin.toString(),technicalMarginPercent:net.atoms===BIG_ZERO?null:margin.div(net).mul(d("100")).toString(),definition:"Technical Gross Margin; not accounting gross margin."};
}

export function marginGuardrail(input:{marginPercent?:string|null;attentionPercent?:string|null;lowMarginPercent?:string|null;negativeMarginPercent?:string|null}){
  if(input.marginPercent==null)return{state:"unknown" as const,actions:["review_data_coverage"]};const value=d(input.marginPercent),negative=d(input.negativeMarginPercent||"0"),low=d(input.lowMarginPercent||"20"),attention=d(input.attentionPercent||"40");
  if(value.atoms<negative.atoms)return{state:"negative_margin" as const,actions:["alert","recommend_pricing_review","recommend_limit_review","recommend_optimization"]};
  if(value.atoms<low.atoms)return{state:"low_margin" as const,actions:["alert","recommend_optimization"]};
  if(value.atoms<attention.atoms)return{state:"attention" as const,actions:["recommend_optimization"]};return{state:"healthy" as const,actions:[]};
}

export function forecastCost(input:{history:string[];growthPercent?:string;projectedTenantMultiplier?:string;knownCommitment?:string}){
  if(!input.history.length&&!input.knownCommitment)return{status:"unknown" as const,expected:null,low:null,high:null};
  const average=input.history.length?input.history.reduce((sum,x)=>sum.add(d(x)),zero()).div(d(String(input.history.length))):zero(),growth=d("1").add(d(input.growthPercent||"0").div(d("100"))),tenants=d(input.projectedTenantMultiplier||"1"),commitment=d(input.knownCommitment||"0"),expected=average.mul(growth).mul(tenants).max(commitment);
  return{status:"baseline" as const,expected:expected.toString(),low:expected.mul(d("0.9")).toString(),high:expected.mul(d("1.1")).toString(),method:"trend_driver_commitment"};
}

export function detectCostAnomaly(input:{observed:string;baseline:string;warningPercent:string;criticalPercent:string}){
  const observed=d(input.observed),baseline=d(input.baseline);if(baseline.atoms===BIG_ZERO)return{candidate:observed.atoms>BIG_ZERO,severity:observed.atoms>BIG_ZERO?"warning":"info",changePercent:null,claim:"new unexpected meter or cost; review required"};const change=observed.sub(baseline).div(baseline).mul(d("100"));return{candidate:change.atoms>=d(input.warningPercent).atoms,severity:change.atoms>=d(input.criticalPercent).atoms?"critical":change.atoms>=d(input.warningPercent).atoms?"warning":"info",changePercent:change.toString(),claim:"correlated context only; no causality inferred"};
}

export function coverage(input:{direct:string;allocated:string;estimated:string;unknown:string;unreconciled:string}){const values=Object.fromEntries(Object.entries(input).map(([k,v])=>[k,d(v)])) as Record<string,DecimalValue>,total=Object.values(values).reduce((sum,x)=>sum.add(x),zero());if(total.atoms===BIG_ZERO)return{confidence:"Low",directRate:null,allocatedRate:null,estimatedRate:null,unknownRate:null,unreconciledRate:null};const rate=(x:DecimalValue)=>x.div(total).mul(d("100")).toString(),directRate=rate(values.direct),allocatedRate=rate(values.allocated),estimatedRate=rate(values.estimated),unknownRate=rate(values.unknown),unreconciledRate=rate(values.unreconciled),confidence=values.unknown.add(values.unreconciled).div(total).atoms<=d("0.1").atoms?"High":values.direct.add(values.allocated).div(total).atoms>=d("0.6").atoms?"Medium":"Low";return{confidence,directRate,allocatedRate,estimatedRate,unknownRate,unreconciledRate};}

export function simulatePlanEconomics(input:{monthlyPrice:string;includedUsage:string;usageCostPerUnit:string;expectedUsage:string[];overageRatePerUnit?:string}){
  if(!input.expectedUsage.length)return{status:"unknown" as const};const sorted=[...input.expectedUsage].map(d).sort((a,b)=>a.atoms<b.atoms?-1:1),at=(p:number)=>sorted[Math.min(sorted.length-1,Math.floor((sorted.length-1)*p))],run=(usage:DecimalValue)=>{const included=d(input.includedUsage),overage=usage.atoms>included.atoms?usage.sub(included):zero(),revenue=d(input.monthlyPrice).add(overage.mul(d(input.overageRatePerUnit||"0"))),cost=usage.mul(d(input.usageCostPerUnit)),margin=revenue.sub(cost);return{usage:usage.toString(),revenue:revenue.toString(),cost:cost.toString(),margin:margin.toString(),marginPercent:revenue.atoms===BIG_ZERO?null:margin.div(revenue).mul(d("100")).toString()}};return{status:"simulated" as const,p50:run(at(.5)),p90:run(at(.9)),breakEvenUsage:d(input.monthlyPrice).div(d(input.usageCostPerUnit)).toString(),actionsExecuted:false};
}

const forbiddenContentKeys=/(prompt|response|message_body|transcript|address|card|password|secret|token_value|credential)/i;
export function validateCostMeterPayload(payload:Record<string,unknown>){const issues=Object.keys(payload).filter(key=>forbiddenContentKeys.test(key));return{valid:issues.length===0,issues:issues.map(x=>`forbidden_content:${x}`)};}

export const FINOPS_PERMISSIONS=["finops:view","finops:view_provider_costs","finops:view_tenant_costs","finops:view_margins","finops:manage_rates","finops:manage_allocation_rules","finops:import_provider_statements","finops:reconcile","finops:manage_budgets","finops:manage_forecasts","finops:manage_commitments","finops:review_optimizations","finops:close_period","finops:reopen_period","finops:view_network"] as const;
export const FINOPS_COPILOT_TOOLS=["getPlatformCostSummary","getProviderCosts","getFeatureCosts","getTenantCostSummary","getPlanUnitEconomics","getTechnicalMargins","getCostAnomalies","getProviderReconciliationIssues","getCostForecast","simulatePlanEconomics","getOptimizationRecommendations","getCostLineage"] as const;
export const FINOPS_AUTOMATION_EVENTS=["finops.budget_threshold_reached","finops.cost_anomaly_detected","finops.provider_reconciliation_mismatch","finops.negative_margin_detected","finops.rate_card_expiring","finops.cost_meter_stale","finops.period_closed"] as const;
export const PLATFORM_FINOPS_BOUNDARIES={billingOwns:["prices","customer_charges","invoices","entitlements","commercial_limits"],financeOwns:["accounts_payable","accounting","managerial_revenue","provider_invoice_payment"],finopsOwns:["technical_cost","rate_cards","cost_allocation","reconciliation","technical_margin","forecast","optimization"],tenantVisibility:"denied_by_default",failMode:"open_for_core_product"} as const;
