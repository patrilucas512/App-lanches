import { notFound } from "next/navigation";
import { PublicMenuView, type PublicMenu } from "@/components/public-menu";

const demo: PublicMenu = {
  establishment: { name: "Bistrô Aurora", slug: "demo", accent_color: "#6d2627" },
  settings: { delivery_enabled: true, pickup_enabled: true },
  categories: [
    { id: "1", name: "Favoritos da casa", products: [
      { id: "1", name: "Brasa Nobre", description: "Blend de 180g, queijo meia cura, cebola caramelizada e aioli defumado.", price_cents: 4290, image_url: "https://images.unsplash.com/photo-1568901346375-23c9450c58cd?auto=format&fit=crop&w=700&q=85" },
      { id: "2", name: "Costela 12 horas", description: "Costela desfiada, purê rústico, molho roti e farofa crocante.", price_cents: 6290, image_url: "https://images.unsplash.com/photo-1546833999-b9f581a1996d?auto=format&fit=crop&w=700&q=85" },
    ] },
    { id: "2", name: "Sobremesas", products: [
      { id: "3", name: "Cacau intenso", description: "Brownie 70%, caramelo salgado e sorvete de baunilha.", price_cents: 2690, image_url: "https://images.unsplash.com/photo-1578985545062-69928b1d9587?auto=format&fit=crop&w=700&q=85" },
    ] },
  ],
};

async function getMenu(slug: string): Promise<PublicMenu | null> {
  if (slug === "demo") return demo;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) return null;
  const headers = { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" };
  const [menuResponse, modeResponse] = await Promise.all([
    fetch(`${url}/rest/v1/rpc/get_public_menu`, { method: "POST", headers, body: JSON.stringify({ requested_slug: slug }), next: { revalidate: 30 } }),
    fetch(`${url}/rest/v1/rpc/get_public_service_mode`, { method: "POST", headers, body: JSON.stringify({ requested_slug: slug }), next: { revalidate: 30 } }),
  ]);
  if (!menuResponse.ok) return null;
  const menu = await menuResponse.json() as PublicMenu;
  if (modeResponse.ok) menu.service_mode = await modeResponse.json();
  return menu;
}

export default async function PublicMenuPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ mesa?: string; origem?: string }> }) {
  const { slug } = await params;
  const query = await searchParams;
  const menu = await getMenu(slug);
  if (!menu) notFound();
  return <PublicMenuView menu={menu} tableNumber={query.mesa} source={query.origem} />;
}
