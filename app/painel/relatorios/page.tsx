import { redirect } from "next/navigation";
import { DashboardShell } from "@/components/dashboard-shell";
import { ReportingCenter } from "@/components/reporting-center";
import { getDashboardContext } from "@/lib/dashboard";
import "./reporting.css";
export const dynamic="force-dynamic";
export default async function ReportsPage(){const{establishment,member}=await getDashboardContext();if(["catalog_editor"].includes(member.role))redirect("/painel");return <DashboardShell brand={establishment} active="reports" storeSlug={establishment.slug} role={member.role}><ReportingCenter storeId={establishment.id}/></DashboardShell>}
