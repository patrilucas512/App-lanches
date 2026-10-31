/* eslint-disable @typescript-eslint/no-explicit-any */
import type {Signal} from "./core";
type Domain="orders"|"kds"|"inventory"|"capacity"|"wms"|"tms"|"delivery"|"hardware"|"integrations"|"payments"|"fiscal"|"offline";
export type NOCAdapter={domain:Domain;read(input:Record<string,unknown>):Partial<Signal>[]};
const adapter=(domain:Domain,signalType:string):NOCAdapter=>({domain,read(input){const rows=Array.isArray(input.signals)?input.signals:[];return rows.map((x:any)=>({...x,sourceDomain:domain,sourceType:x.sourceType||`${domain}_health`,signalType:x.signalType||signalType,metadata:{...(x.metadata||{}),adapter:`${domain}_public_read_service`}}))}});
export const OrdersNOCAdapter=adapter("orders","backlog");
export const KDSNOCAdapter=adapter("kds","backlog");
export const InventoryNOCAdapter=adapter("inventory","stock");
export const CapacityNOCAdapter=adapter("capacity","capacity");
export const WMSNOCAdapter=adapter("wms","backlog");
export const TMSNOCAdapter=adapter("tms","transport");
export const DeliveryNOCAdapter=adapter("delivery","transport");
export const HardwareNOCAdapter=adapter("hardware","hardware");
export const IntegrationNOCAdapter=adapter("integrations","integration");
export const PaymentNOCAdapter=adapter("payments","payment");
export const FiscalNOCAdapter=adapter("fiscal","fiscal");
export const OfflineNOCAdapter=adapter("offline","network");
export const NOC_ADAPTERS=[OrdersNOCAdapter,KDSNOCAdapter,InventoryNOCAdapter,CapacityNOCAdapter,WMSNOCAdapter,TMSNOCAdapter,DeliveryNOCAdapter,HardwareNOCAdapter,IntegrationNOCAdapter,PaymentNOCAdapter,FiscalNOCAdapter,OfflineNOCAdapter];
