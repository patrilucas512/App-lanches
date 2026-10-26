import{requireSuperadmin}from"@/lib/superadmin";import{InternalOperationsCenter}from"@/components/internal-operations-center";
export const dynamic="force-dynamic";
export default async function InternalOperationsPage(){await requireSuperadmin();return <><header className="sa-page-head"><div><small>MASTERAPP · USO INTERNO</small><h1>Operações Internas</h1><p>Projetos, execução, aprovações, decisões, documentos e roadmap do próprio MasterApp — separados da operação dos restaurantes.</p></div></header><InternalOperationsCenter/></>}
