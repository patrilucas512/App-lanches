import Link from "next/link";
import { createAdminClient } from "@/lib/supabase/admin";
import { date, requireSuperadmin } from "@/lib/superadmin";

export const dynamic="force-dynamic";

export default async function SuperadminSecurityPage(){
 await requireSuperadmin();const admin=createAdminClient();
 const[organizations,profiles,events,backups,restores,secrets,incidents,sso]=await Promise.all([
  admin.from("organizations").select("id,name,status").order("name"),
  admin.from("user_security_profiles").select("user_id,mfa_enabled"),
  admin.from("security_events").select("id,organization_id,event_type,severity,title,status,detected_at,organizations(name)").eq("status","open").order("detected_at",{ascending:false}).limit(25),
  admin.from("backup_runs").select("id,organization_id,status,backup_type,completed_at,started_at,organizations(name)").order("started_at",{ascending:false}).limit(25),
  admin.from("restore_test_runs").select("id,organization_id,status,completed_at,started_at,organizations(name)").order("started_at",{ascending:false}).limit(25),
  admin.from("secret_rotation_register").select("id,organization_id,reference_name,secret_type,status,rotate_by,organizations(name)").in("status",["due","overdue"]).order("rotate_by"),
  admin.from("security_incidents").select("id,organization_id,title,severity,status,detected_at,organizations(name)").neq("status","resolved").order("detected_at",{ascending:false}),
  admin.from("sso_connections").select("id,organization_id,status,last_error,organizations(name)").neq("status","active"),
 ]);
 const orgs=organizations.data||[],mfaEnabled=(profiles.data||[]).filter(x=>x.mfa_enabled).length;const failedBackups=(backups.data||[]).filter(x=>x.status==="failed").length;const overdueRestores=(restores.data||[]).filter(x=>new Date(x.completed_at||x.started_at).getTime()<Date.now()-90*86400000).length;
 return <><header className="sa-page-head"><div><small>SECURITY COMMAND CENTER</small><h1>Segurança da plataforma</h1><p>Visão global somente leitura e controles operacionais do Super Administrador.</p></div><Link className="sa-button" href="/superadmin/logs">Abrir auditoria</Link></header><section className="sa-kpis"><article><small>ORGANIZAÇÕES</small><strong>{orgs.length}</strong></article><article><small>USUÁRIOS COM MFA</small><strong>{mfaEnabled}</strong></article><article><small>BACKUPS FALHANDO</small><strong>{failedBackups}</strong></article><article><small>RESTORES &gt; 90 DIAS</small><strong>{overdueRestores}</strong></article><article><small>INCIDENTES ABERTOS</small><strong>{incidents.data?.length||0}</strong></article></section><section className="sa-grid"><article className="sa-panel"><header><div><small>ALERTAS OPERACIONAIS</small><h2>Riscos que exigem resposta</h2></div></header><div className="sa-log-list">{(events.data||[]).map((row:any)=><div className="sa-log" key={row.id}><div><b>{row.title}</b><small>{row.organizations?.name||"Plataforma"} · {row.severity}</small></div><time>{date(row.detected_at,true)}</time></div>)}{!events.data?.length&&<p>Nenhum alerta aberto.</p>}</div></article><article className="sa-panel"><header><div><small>CONTINUIDADE</small><h2>Backup e restore</h2></div></header><p><b>{failedBackups}</b> backup(s) com falha.</p><p><b>{overdueRestores}</b> teste(s) de restore atrasado(s).</p><p><b>{secrets.data?.length||0}</b> segredo(s) próximos ou além da rotação.</p><p><b>{sso.data?.length||0}</b> conexão(ões) SSO aguardando validação.</p></article><article className="sa-panel"><header><div><small>INCIDENT RESPONSE</small><h2>Incidentes ativos</h2></div></header><div className="sa-log-list">{(incidents.data||[]).map((row:any)=><div className="sa-log" key={row.id}><div><b>{row.title}</b><small>{row.organizations?.name||"Plataforma"} · {row.severity} · {row.status}</small></div><time>{date(row.detected_at,true)}</time></div>)}{!incidents.data?.length&&<p>Nenhum incidente ativo.</p>}</div></article></section></>;
}
