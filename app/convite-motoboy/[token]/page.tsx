import { DriverInviteClaim } from "@/components/driver-access";

export default async function DriverInvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <main className="auth-page"><section className="auth-panel"><DriverInviteClaim token={token}/></section><aside className="auth-art"><span>ACESSO SEGURO</span><h2>Seu turno,<br/><em>suas entregas.</em></h2></aside></main>;
}
