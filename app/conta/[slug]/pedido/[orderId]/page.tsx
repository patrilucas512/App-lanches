import { notFound,redirect } from "next/navigation";
import { getPortalContext } from "@/lib/customer-portal";
import { CustomerPortalApp } from "@/components/customer-portal";
export default async function CustomerPortalOrderPage({params}:{params:Promise<{slug:string;orderId:string}>}){const{slug,orderId}=await params;const context=await getPortalContext(slug);if(!context)redirect(`/conta/${slug}`);if(!(context.orders as Array<{id:string}>||[]).some(o=>o.id===orderId))notFound();return <CustomerPortalApp slug={slug} initial={context} initialOrderId={orderId}/>;}
