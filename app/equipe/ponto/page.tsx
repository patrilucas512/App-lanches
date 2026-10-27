import { redirect } from "next/navigation";
import { EmployeeTimeClock } from "@/components/employee-time-clock";
import { createClient } from "@/lib/supabase/server";
export default async function TimeClockPage(){const db=await createClient();const {data:claims}=await (db.auth as any).getClaims();const userId=claims?.claims?.sub;if(!userId)redirect("/");const {data:employee}=await db.from("custom_staff_members").select("id,name,primary_store_id,establishment_id,status").eq("user_id",userId).eq("status","active").maybeSingle();if(!employee)redirect("/");return <main className="employee-time-clock-page"><EmployeeTimeClock establishmentId={employee.primary_store_id||employee.establishment_id} employeeName={employee.name}/></main>}
