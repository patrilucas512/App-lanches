export type FiscalDocumentStatus = "draft"|"pending"|"processing"|"authorized"|"rejected"|"cancelled"|"contingency"|"error";
import { assertExternalEffectAllowed } from "@/lib/quality/core";
export type FiscalProviderResult = { providerDocumentId?:string; status:FiscalDocumentStatus; number?:string; series?:string; accessKey?:string; xml?:string; pdfUrl?:string; errorCode?:string; errorMessage?:string };
export type FiscalIssueInput = { id:string; idempotencyKey:string; documentType:string; environment:"test"|"production"; declaredPayload:Record<string,unknown> };
export interface FiscalProvider {
 readonly key:string;
 issue(input:FiscalIssueInput):Promise<FiscalProviderResult>;
 cancel(providerDocumentId:string,reason:string,idempotencyKey:string):Promise<FiscalProviderResult>;
 status(providerDocumentId:string):Promise<FiscalProviderResult>;
 pdf(providerDocumentId:string):Promise<{url?:string;bytes?:Uint8Array}>;
 xml(providerDocumentId:string):Promise<{content?:string;bytes?:Uint8Array}>;
 list(filters:{from?:string;to?:string;status?:FiscalDocumentStatus}):Promise<FiscalProviderResult[]>;
 validate(config:Record<string,unknown>):Promise<{ok:boolean;message:string}>;
}
class ManualFiscalProvider implements FiscalProvider {
 readonly key="manual";
 async issue(){return {status:"pending" as const,errorMessage:"Emissão manual: conclua no sistema fiscal autorizado e anexe o retorno."};}
 async cancel(){return {status:"processing" as const,errorMessage:"Cancelamento manual aguardando confirmação externa."};}
 async status(){return {status:"pending" as const};} async pdf(){return {};} async xml(){return {};} async list(){return [];}
 async validate(){return {ok:true,message:"Modo manual ativo. Nenhuma transmissão automática será realizada."};}
}
class SandboxFiscalProvider implements FiscalProvider {
 readonly key="sandbox_adapter";
 async issue(input:FiscalIssueInput){return {providerDocumentId:"sandbox-"+input.id,status:"authorized" as const,number:"T-"+input.id.slice(0,8),series:"TESTE"};}
 async cancel(providerDocumentId:string){return {providerDocumentId,status:"cancelled" as const};}
 async status(providerDocumentId:string){return {providerDocumentId,status:"authorized" as const};}
 async pdf(){return {};} async xml(){return {};} async list(){return [];}
 async validate(config:Record<string,unknown>){return {ok:config.environment!=="production",message:config.environment==="production"?"O adaptador sandbox não pode operar em produção.":"Adaptador de teste saudável."};}
}
export function getFiscalProvider(key:string):FiscalProvider {if(key!=="sandbox_adapter")assertExternalEffectAllowed("fiscal",process.env.FISCAL_ENVIRONMENT==="production"?"production":"test");return key==="sandbox_adapter"?new SandboxFiscalProvider():new ManualFiscalProvider();}
export interface AccountingConnector {readonly key:string;validate(config:Record<string,unknown>):Promise<{ok:boolean;message:string}>;export(input:{from:string;to:string;format:"csv"|"xlsx"|"xml"|"pdf"|"zip"}):Promise<{fileName:string;contentType:string;bytes:Uint8Array}>;}
