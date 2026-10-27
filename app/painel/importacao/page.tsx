import { DashboardShell } from "@/components/dashboard-shell";
import { MigrationWizard } from "@/components/migration-wizard";
import { getDashboardContext } from "@/lib/dashboard";
export default async function ImportPage(){const{establishment,member}=await getDashboardContext();return <DashboardShell brand={establishment} active="onboarding" storeSlug={establishment.slug} role={member.role}><header className="admin-page-heading"><div><small>PRIMEIROS PASSOS · MIGRAÇÃO</small><h1>Importação assistida.</h1><p>CSV e XLSX com mapeamento, preview, validação, idempotência e rollback seguro.</p></div></header><MigrationWizard/></DashboardShell>}
