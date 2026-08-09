import { redirect } from "next/navigation";

export default async function WaiterReportPage() {
  redirect("/painel/equipe#relatorio-garcons");
}
