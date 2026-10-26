import {notFound} from "next/navigation";
import {createAdminClient} from "@/lib/supabase/admin";
import {WebChatWidget} from "@/components/web-chat-widget";
export default async function WidgetPage({params,searchParams}:{params:Promise<{publicKey:string}>;searchParams:Promise<{origin?:string}>}){const{publicKey}=await params;const{origin}=await searchParams;const{data:config}=await createAdminClient().from("web_chat_widget_configs").select("public_key,display_name,logo_url,position,initial_message,accent_color,attendant_name,enabled").eq("public_key",publicKey).eq("enabled",true).maybeSingle();if(!config)notFound();return <WebChatWidget config={config as never} origin={String(origin||"")}/>}

