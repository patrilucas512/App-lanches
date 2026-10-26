import { SimpleCreateForm } from "@/components/superadmin-actions";
import { PageHead } from "@/components/superadmin-ui";
import { date, requireSuperadmin } from "@/lib/superadmin";

export default async function SettingsPage() { const { supabase } = await requireSuperadmin(); const { data: rows } = await supabase.from("platform_settings").select("*").order("key"); return <><PageHead title="Configurações globais" description="Identidade, suporte, períodos padrão e manutenção da plataforma." /><section className="sa-split"><article className="sa-panel"><header><h2>Configuração principal</h2></header><SimpleCreateForm type="settings" /></article><article className="sa-panel"><header><h2>Valores em vigor</h2></header>{rows?.map(row => <div className="sa-setting" key={row.key}><b>{row.key}</b><pre>{JSON.stringify(row.value, null, 2)}</pre><small>Atualizado em {date(row.updated_at, true)}</small></div>)}</article></section></>; }
