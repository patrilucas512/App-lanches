import {DashboardShell} from "@/components/dashboard-shell";
import {MyAnnouncements} from "@/components/my-announcements";
import {getDashboardContext} from "@/lib/dashboard";
import "../seguranca/soc/soc.css";
export const dynamic="force-dynamic";
export default async function MyAnnouncementsPage(){const{establishment,member}=await getDashboardContext();return <DashboardShell brand={establishment} active="my-announcements" storeSlug={establishment.slug} role={member.role}><header className="dashboard-head soc-head"><div><small>COMUNICADOS</small><h1>Comunicados</h1><p>O que a empresa avisou para você e o que precisa da sua confirmação.</p></div></header><MyAnnouncements storeId={establishment.id}/></DashboardShell>}
