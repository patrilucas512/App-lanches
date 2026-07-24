import { redirect } from "next/navigation";
export default async function WaiterEstablishmentPage({ params }: { params: Promise<{ establishmentSlug: string }> }) {
  const { establishmentSlug } = await params;
  redirect(`/garcom/login?estabelecimento=${encodeURIComponent(establishmentSlug)}`);
}
