"use client";
import type{OfflineCommand}from"./core";
const DB="masterapp-operational",VERSION=1,STORES=["snapshots","mutations","attachments","print_jobs","events"] as const;
function open(){return new Promise<IDBDatabase>((resolve,reject)=>{const request=indexedDB.open(DB,VERSION);request.onupgradeneeded=()=>{const db=request.result;for(const name of STORES)if(!db.objectStoreNames.contains(name)){const store=db.createObjectStore(name,{keyPath:"id"});store.createIndex("status","status",{unique:false});store.createIndex("store_id","store_id",{unique:false});store.createIndex("created_at","created_at",{unique:false})}};request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error)})}
async function transaction<T>(name:typeof STORES[number],mode:IDBTransactionMode,fn:(s:IDBObjectStore)=>IDBRequest<T>){const db=await open();return new Promise<T>((resolve,reject)=>{const tx=db.transaction(name,mode),request=fn(tx.objectStore(name));request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);tx.oncomplete=()=>db.close()})}
export const LocalOperationalStore={
 async put(name:typeof STORES[number],record:Record<string,unknown>){return transaction(name,"readwrite",s=>s.put(record))},
 async get<T>(name:typeof STORES[number],id:string){return transaction<T|undefined>(name,"readonly",s=>s.get(id))},
 async all<T>(name:typeof STORES[number]){return transaction<T[]>(name,"readonly",s=>s.getAll())},
 async remove(name:typeof STORES[number],id:string){return transaction(name,"readwrite",s=>s.delete(id))},
 async queue(command:OfflineCommand){return this.put("mutations",{id:command.mutation_id,created_at:command.client_timestamp,...command})},
 async pending(storeId:string){const rows=await this.all<OfflineCommand&{id:string}>("mutations");return rows.filter(x=>x.store_id===storeId&&["pending","failed","conflict"].includes(x.status||"pending"))},
 async snapshot(storeId:string,dataset:string,data:unknown,version:string){return this.put("snapshots",{id:`${storeId}:${dataset}`,store_id:storeId,dataset,data,version,generated_at:new Date().toISOString(),expires_at:new Date(Date.now()+86400000).toISOString(),status:"fresh"})},
 async usage(){return navigator.storage?.estimate?.()||{usage:0,quota:0}}
};

