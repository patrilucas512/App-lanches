import {createHmac,timingSafeEqual} from "node:crypto";
import type {VoiceAction,VoiceEvent} from "./types";

export interface VoiceProvider {
  readonly key:string;
  verifyWebhook(rawBody:string,signature:string|null,secret:string):boolean;
  parseEvent(payload:unknown):VoiceEvent;
  formatActions(actions:VoiceAction[]):unknown;
}

function safeEqual(left:string,right:string){
  const a=Buffer.from(left); const b=Buffer.from(right);
  return a.length===b.length&&timingSafeEqual(a,b);
}

export class GenericVoiceProvider implements VoiceProvider {
  readonly key="generic";
  verifyWebhook(rawBody:string,signature:string|null,secret:string){
    if(!signature||!secret)return false;
    const expected=createHmac("sha256",secret).update(rawBody).digest("hex");
    return safeEqual(signature.replace(/^sha256=/,""),expected);
  }
  parseEvent(payload:unknown):VoiceEvent{
    const item=(payload&&typeof payload==="object"?payload:{}) as Record<string,unknown>;
    const type=String(item.type||"");
    if(!["incoming_call","speech","barge_in","call_ended","provider_unavailable"].includes(type))throw new Error("Evento de voz não suportado.");
    const event={id:String(item.id||""),type,provider:String(item.provider||"generic"),providerCallId:String(item.call_id||""),providerConnectionId:String(item.connection_id||""),from:String(item.from||""),to:item.to?String(item.to):undefined,transcript:item.transcript?String(item.transcript):undefined,confidence:item.confidence===undefined?undefined:Number(item.confidence),durationSeconds:item.duration_seconds===undefined?undefined:Number(item.duration_seconds),metadata:(item.metadata&&typeof item.metadata==="object"?item.metadata:{}) as Record<string,unknown>} as VoiceEvent;
    if(!event.id||!event.providerCallId||!event.providerConnectionId)throw new Error("Identidade do evento incompleta.");
    return event;
  }
  formatActions(actions:VoiceAction[]){return {actions};}
}

export function getVoiceProvider(key:string):VoiceProvider{
  // Vendor adapters implement the same contract. The generic signed adapter is
  // production-safe and is the integration boundary until credentials are linked.
  if(["generic","twilio","vonage","telnyx"].includes(key))return new GenericVoiceProvider();
  throw new Error("Provider de voz não configurado.");
}

