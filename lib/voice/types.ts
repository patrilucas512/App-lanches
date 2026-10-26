export type VoiceEventType = "incoming_call"|"speech"|"barge_in"|"call_ended"|"provider_unavailable";
export type VoiceEvent = {
  id:string; type:VoiceEventType; provider:string; providerCallId:string; providerConnectionId:string;
  from:string; to?:string; transcript?:string; confidence?:number; durationSeconds?:number; metadata?:Record<string,unknown>;
};
export type VoiceAction =
  | {type:"answer"}
  | {type:"speak";text:string;bargeIn:boolean;language:string;voice:string;speed:number}
  | {type:"stop_audio"}
  | {type:"transfer";destination:string;summary:string}
  | {type:"hold";message:string}
  | {type:"end"};
export type VoiceWebhookResult = {callSessionId:string;actions:VoiceAction[];idempotent?:boolean};

