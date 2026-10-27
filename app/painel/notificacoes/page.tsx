import { redirect } from "next/navigation";
import { DashboardShell } from "@/components/dashboard-shell";
import { NotificationCenter } from "@/components/notification-center";
import { getDashboardContext } from "@/lib/dashboard";
import "./notifications.css";
export default async function NotificationsPage() { const { establishment, member } = await getDashboardContext(); if (establishment.plan?.notification_center_enabled === false) redirect("/painel"); return <DashboardShell brand={establishment} active="notifications" storeSlug={establishment.slug} role={member.role}><header className="admin-page-heading notification-heading"><div><small>OPERAÇÃO · FASE 52</small><h1>Central de Notificações.</h1><p>Prioridades, aprovações, alertas e tarefas em uma caixa única, sem perder a origem de cada evento.</p></div><span className="status-pill">Tempo real · auditável</span></header><NotificationCenter storeId={establishment.id} organizationId={establishment.organization_id}/></DashboardShell>; }
