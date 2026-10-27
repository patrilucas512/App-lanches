"use client";

import { useEffect } from "react";

export function SecuritySessionBeacon({organizationId}:{organizationId?:string}){
  useEffect(()=>{if(!organizationId)return;let id=localStorage.getItem("masterapp_device_id");if(!id){id=crypto.randomUUID()+crypto.randomUUID();localStorage.setItem("masterapp_device_id",id);}fetch("/api/security",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"session_ping",organization_id:organizationId,device_id:id})}).catch(()=>undefined);},[organizationId]);
  return null;
}
