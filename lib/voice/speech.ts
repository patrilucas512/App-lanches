const CARD_PATTERN=/\b(?:\d[ -]*?){13,19}\b/g;
const CVV_PATTERN=/\b(?:cvv|codigo de seguranca)\s*[:\-]?\s*\d{3,4}\b/gi;
const CPF_PATTERN=/\b\d{3}\.?\d{3}\.?\d{3}[-.]?\d{2}\b/g;

export function redactSensitiveSpeech(value:string){
  let detected=false;
  const text=value.replace(CARD_PATTERN,()=>{detected=true;return "[DADO DE CARTÃO REMOVIDO]";}).replace(CVV_PATTERN,()=>{detected=true;return "[CÓDIGO DE SEGURANÇA REMOVIDO]";}).replace(CPF_PATTERN,()=>{detected=true;return "[CPF REMOVIDO]";});
  return {text:text.slice(0,4096),detected};
}

export function isCardDisclosure(value:string){return /\b(?:\d[ -]*?){13,19}\b/.test(value)||/\b(cvv|validade do cartao|numero do cartao)\b/i.test(value);}
export function isEmergency(value:string){return /\b(emergencia|socorro|infarto|incendio|assalto|risco de vida|nao esta respirando)\b/i.test(value);}
export function shortVoiceResponse(value:string){
  return value.replace(/https?:\/\/\S+/g,"Enviei o link seguro pelo canal disponível.").replace(/\n+/g," ").replace(/\s+/g," ").trim().slice(0,700);
}
export function normalizePhone(value:string){const digits=value.replace(/\D/g,"");return digits.length===10||digits.length===11?`55${digits}`:digits;}
export function validSpeechConfidence(value:number|undefined){return value===undefined||value>=0.58;}

