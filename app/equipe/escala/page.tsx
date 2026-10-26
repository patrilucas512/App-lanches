import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { MySchedule } from "@/components/my-schedule";
import "./my-schedule.css";
export default async function MySchedulePage(){const db=await createClient(),{data}=await db.auth.getClaims(),uid=String(data?.claims?.sub||"");if(!uid)redirect("/");const{data:employee}=await db.from("custom_staff_members").select("primary_store_id,establishment_id").eq("user_id",uid).eq("status","active").maybeSingle();const storeId=employee?.primary_store_id||employee?.establishment_id;if(!storeId)redirect("/");return <MySchedule storeId={storeId}/>}
