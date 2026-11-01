/* eslint-disable @typescript-eslint/no-explicit-any */
/* Explainable analysis: every sentiment, topic and risk signal keeps the excerpt that produced it and a confidence level. */
import {maskPii} from "./core.ts";

export const RISK_SIGNALS=["allergy","food_poisoning","foreign_object","contamination","accident","threat_harassment"] as const;
export const FOOD_SAFETY_SIGNALS=["allergy","food_poisoning","foreign_object","contamination"] as const;
export const RISK_LABELS:Record<string,string>={allergy:"Alergia",food_poisoning:"Possível intoxicação",foreign_object:"Corpo estranho",contamination:"Possível contaminação",accident:"Acidente",threat_harassment:"Ameaça ou assédio"};
export type Confidence="low"|"medium"|"high";
export type Sentiment="positive"|"neutral"|"negative"|"mixed";

const RISK_RULES:Array<[string,RegExp,Confidence]>=[
  ["allergy",/\balerg|\banafila|\bcrise alergica/,"high"],
  ["food_poisoning",/\bintoxica|\bpass(ei|amos|ou|aram) mal\b|\bvomit|\bdiarreia|\binfeccao alimentar|\bfui (ao|para o) hospital|\bpronto.?socorro/,"high"],
  ["foreign_object",/\bcabelo\b|\bbarata\b|\binseto\b|\bmosca\b|\blarva|\bminhoca|\bcorpo estranho|\bpedaco de (vidro|plastico|metal)|\bcaco de vidro|\bprego\b/,"high"],
  ["contamination",/\bcontamina|\bestragad|\bpodre\b|\bmofo\b|\bmofad|\bvencid|\bazedo\b/,"medium"],
  ["accident",/\bacidente\b|\batropel|\bme machuc|\bse machuc|\bferid[oa]\b|\bqueimadur|\bme queimei/,"high"],
  ["threat_harassment",/\bamea[cç]|\bassedi|\bagredi|\bagressao\b/,"high"],
];
const TOPIC_RULES:Array<[string,RegExp,"positive"|"negative"]>=[
  ["temperature",/\b(frio|fria|gelad[oa]|morno|morna)\b/,"negative"],["temperature",/\b(quentinh[oa]|bem quente)\b/,"positive"],
  ["delivery_time",/\b(demor|atras|lento|lenta|nunca chegou|nao chegou)/,"negative"],["delivery_time",/\b(rapid[oa]|no prazo|chegou antes)\b/,"positive"],
  ["delivery_courier",/\b(entregador|motoboy|motoqueiro)\b.{0,40}\b(grosso|mal educad|rude|sem educacao|nao subiu)/,"negative"],["delivery_courier",/\b(entregador|motoboy)\b.{0,40}\b(educad|simpatic|atencios)/,"positive"],
  ["food_quality",/\b(sem gosto|sem sabor|ruim|horrivel|pessim[oa]|queimad[oa]|cru|crua|salgad[oa] demais|oleos[oa])\b/,"negative"],["food_quality",/\b(delicios[oa]|saboros[oa]|gostos[oa]|muito bom|muito boa|excelente|maravilhos[oa])\b/,"positive"],
  ["portion",/\b(porcao pequena|veio pouco|muito pouco|pequen[oa] demais)\b/,"negative"],["portion",/\b(bem servid[oa]|porcao generosa|bem grande)\b/,"positive"],
  ["packaging",/\b(embalagem|vazou|vazando|derramou|amassad[oa]|lacre)\b/,"negative"],
  ["service",/\b(atendimento|atendente|garcom|garconete)\b.{0,40}\b(ruim|pessim|grosso|mal|demorou|horrivel)/,"negative"],["service",/\b(atendimento|atendente|garcom|garconete)\b.{0,40}\b(otimo|excelente|bom|boa|atencios|simpatic)/,"positive"],
  ["cleanliness",/\b(suj[oa]|sujeira|mal cheiro|fedor|banheiro)\b/,"negative"],["cleanliness",/\b(limp[oa]|limpeza)\b/,"positive"],
  ["ambiance",/\b(barulho|barulhent|lotad[oa])\b/,"negative"],["ambiance",/\b(ambiente|aconchegante|agradavel)\b/,"positive"],
  ["price_value",/\b(car[oa]|caro demais|nao vale|preco alto)\b/,"negative"],["price_value",/\b(preco justo|barat[oa]|vale a pena|custo.?beneficio)\b/,"positive"],
  ["order_accuracy",/\b(errad[oa]|veio outro|faltou|faltando|esqueceram|trocaram|sem o que pedi)\b/,"negative"],
  ["app_experience",/\b(aplicativo|app|site|cardapio digital)\b.{0,40}\b(travou|erro|ruim|dificil)/,"negative"],
  ["payment",/\b(cobranca|cobraram|pagamento|pix|troco)\b.{0,40}\b(errad|indevid|falhou|duas vezes|problema)/,"negative"],
];
const POSITIVE=/\b(otimo|otima|excelente|delicios[oa]|maravilhos[oa]|perfeit[oa]|adorei|amei|recomendo|parabens|muito bom|muito boa|saboros[oa]|gostos[oa]|top)\b/g;
const NEGATIVE=/\b(pessim[oa]|horrivel|ruim|nojo|nojent[oa]|decepcion|odiei|detestei|nunca mais|absurdo|demorou|atrasou|errad[oa]|frio|fria|estragad)\w*/g;
const NEGATION=/\b(nao|nunca|sem|nem)\s+(?:\w+\s+)?$/;

// Same length as the input, one letter for one letter, so a match index points at the original text.
export const fold=(text:string)=>Array.from(text.normalize("NFC")).map(c=>{const base=c.normalize("NFD")[0];return base.length===c.length?base.toLowerCase():c.toLowerCase()}).join("");

function excerptAt(text:string,index:number,length:number){
  const nfc=text.normalize("NFC"),before=Math.max(nfc.lastIndexOf(".",index),nfc.lastIndexOf("!",index),nfc.lastIndexOf("?",index),nfc.lastIndexOf("\n",index))+1,ends=[".","!","?","\n"].map(x=>nfc.indexOf(x,index+length)).filter(x=>x>=0),end=ends.length?Math.min(...ends):nfc.length,sentence=nfc.slice(before,end).trim();
  return maskPii(sentence.length>160?nfc.slice(Math.max(0,index-60),index+length+60).trim():sentence);
}
const negatedAt=(folded:string,index:number)=>NEGATION.test(folded.slice(Math.max(0,index-24),index));

export class SentimentTopicService{
  analyze(input:{comment?:string|null;score?:number|null;scale?:string|null;dimensionRatings?:Record<string,number>;taxonomy?:Array<{key:string;terms:string[]}>}){
    const text=String(input.comment||"").normalize("NFC"),folded=fold(text),evidence:any[]=[],topics=new Map<string,any>(),risks:any[]=[];let positive=0,negative=0;
    for(const[pattern,polarity]of[[POSITIVE,"positive"],[NEGATIVE,"negative"]] as const){pattern.lastIndex=0;for(const match of folded.matchAll(pattern)){const negated=negatedAt(folded,match.index),effective=negated?(polarity==="positive"?"negative":"positive"):polarity;if(effective==="positive")positive++;else negative++;if(evidence.length<5)evidence.push({signal:"text",polarity:effective,excerpt:excerptAt(text,match.index,match[0].length)})}}
    for(const[key,pattern,polarity]of TOPIC_RULES){if(topics.has(key))continue;const match=pattern.exec(folded);if(match)topics.set(key,{topic_key:key,polarity:negatedAt(folded,match.index)?(polarity==="positive"?"negative":"positive"):polarity,excerpt:excerptAt(text,match.index,match[0].length),confidence:"medium" as Confidence,origin:"rules"})}
    for(const custom of input.taxonomy||[]){if(topics.has(custom.key))continue;for(const term of custom.terms||[]){const index=folded.indexOf(fold(term));if(index>=0){topics.set(custom.key,{topic_key:custom.key,polarity:"neutral",excerpt:excerptAt(text,index,term.length),confidence:"medium",origin:"rules"});break}}}
    for(const[dimension,value]of Object.entries(input.dimensionRatings||{})){const rating=Number(value);if(!Number.isFinite(rating)||rating===3)continue;const polarity=rating<3?"negative":"positive",existing=topics.get(dimension);topics.set(dimension,{topic_key:dimension,polarity,excerpt:existing?.excerpt||null,confidence:"high",origin:"dimension"})}
    // Risk detection stays broad on purpose: a false alarm costs one human review, a missed one costs much more. A negated phrase only lowers the confidence.
    for(const[signal,pattern,confidence]of RISK_RULES){const match=pattern.exec(folded);if(match)risks.push({signal_type:signal,excerpt:excerptAt(text,match.index,match[0].length),confidence:negatedAt(folded,match.index)?"low":confidence})}
    const score=input.score==null?null:Number(input.score),band=score==null?null:input.scale==="0-10"?(score<=6?"negative":score>=9?"positive":"neutral"):input.scale==="1-7"?(score<=3?"negative":score>=6?"positive":"neutral"):(score<=2?"negative":score>=4?"positive":"neutral");
    if(band)evidence.unshift({signal:"score",polarity:band,value:score,scale:input.scale});
    const{sentiment,confidence}=this.combine(band,positive,negative);
    return{sentiment,confidence,evidence,topics:[...topics.values()],risks,method:"rules" as const,opaqueScore:false};
  }
  private combine(band:string|null,positive:number,negative:number):{sentiment:Sentiment;confidence:Confidence}{
    if(positive&&negative)return{sentiment:"mixed",confidence:"medium"};
    const text=positive?"positive":negative?"negative":null;
    if(band&&text)return band===text?{sentiment:text as Sentiment,confidence:"high"}:{sentiment:band==="neutral"?text as Sentiment:"mixed",confidence:"medium"};
    if(text)return{sentiment:text as Sentiment,confidence:"medium"};
    if(band)return{sentiment:band as Sentiment,confidence:"medium"};
    return{sentiment:"neutral",confidence:"low"};
  }
}

// AI output is untrusted: it can add detail, but excerpts must exist in the comment and only known values pass.
export function mergeAiAnalysis(rules:ReturnType<SentimentTopicService["analyze"]>,ai:any,maskedComment:string){
  const topics=new Map(rules.topics.map((x:any)=>[x.topic_key,x])),risks=new Map(rules.risks.map((x:any)=>[x.signal_type,x])),inComment=(excerpt:unknown)=>typeof excerpt==="string"&&excerpt.trim().length>2&&maskedComment.includes(excerpt);
  for(const topic of Array.isArray(ai?.topics)?ai.topics:[])if(/^[a-z_]{2,40}$/.test(String(topic?.topic_key))&&inComment(topic.excerpt)&&!topics.has(topic.topic_key))topics.set(topic.topic_key,{topic_key:topic.topic_key,polarity:["positive","neutral","negative"].includes(topic.polarity)?topic.polarity:"neutral",excerpt:topic.excerpt,confidence:"low",origin:"ai"});
  for(const risk of Array.isArray(ai?.risks)?ai.risks:[])if((RISK_SIGNALS as readonly string[]).includes(risk?.signal_type)&&inComment(risk.excerpt)&&!risks.has(risk.signal_type))risks.set(risk.signal_type,{signal_type:risk.signal_type,excerpt:risk.excerpt,confidence:"low"});
  const aiSentiment=["positive","neutral","negative","mixed"].includes(ai?.sentiment)?ai.sentiment:null;
  return{...rules,sentiment:rules.confidence==="low"&&aiSentiment?aiSentiment:rules.sentiment,topics:[...topics.values()],risks:[...risks.values()],method:"rules_and_ai" as const};
}

export function routeForSignal(signal:string){
  const food=(FOOD_SAFETY_SIGNALS as readonly string[]).includes(signal);
  return{requiresHumanReview:true,nonconformity:food?{category:signal==="allergy"?"customer_complaint":"contamination_suspected",severity:"high"}:null,incident:{category:food?"quality":signal==="accident"?"delivery":"security",severity:"SEV2",visibility:signal==="threat_harassment"?"confidential":"restricted",safetyRelated:signal!=="threat_harassment"}};
}
