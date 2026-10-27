import { notFound } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { getPortalContext } from "@/lib/customer-portal";
import { CustomerPortalApp, CustomerPortalLogin } from "@/components/customer-portal";

export default async function CustomerPortalPage({ params }: { params: Promise<{ slug:string }> }) {
  const { slug }=await params; const admin=createAdminClient();
  const {data:store}=await admin.from("establishments").select("id,name,logo_url,accent_color,active").eq("slug",slug).eq("active",true).maybeSingle(); if(!store)notFound();
  const {data:config}=await admin.from("customer_portal_configs").select("*").eq("establishment_id",store.id).eq("enabled",true).maybeSingle(); if(!config)notFound();
  const context=await getPortalContext(slug);
  return context?<CustomerPortalApp slug={slug} initial={context}/>:<CustomerPortalLogin slug={slug} config={config}/>;
}
