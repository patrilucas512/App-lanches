"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { DashboardLink } from "@/components/dashboard-shell";

export function WhatsAppNavItem({ link, active, establishmentId, role }: { link: DashboardLink; active: boolean; establishmentId: string; role?: string }) {
  const [allowed, setAllowed] = useState(role === "owner" || role === "manager");
  const [unread, setUnread] = useState(0);
  useEffect(() => {
    const supabase = createClient();
    const refresh = async () => {
      if (!(role === "owner" || role === "manager")) {
        const { data } = await supabase.from("whatsapp_member_permissions").select("can_view").eq("establishment_id", establishmentId).maybeSingle();
        setAllowed(Boolean(data?.can_view));
        if (!data?.can_view) return;
      }
      const { data } = await supabase.from("whatsapp_conversations").select("unread_count").eq("establishment_id", establishmentId).gt("unread_count", 0);
      setUnread(((data || []) as Array<{ unread_count?: number }>).reduce((total: number, item: { unread_count?: number }) => total + Number(item.unread_count || 0), 0));
    };
    void refresh();
    const channel = supabase.channel(`wa-nav-${establishmentId}`).on("postgres_changes", { event: "*", schema: "public", table: "whatsapp_conversations", filter: `establishment_id=eq.${establishmentId}` }, refresh).subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [establishmentId, role]);
  if (!allowed) return null;
  return <Link className={active ? "active" : ""} href={link.href} aria-current={active ? "page" : undefined}><span aria-hidden="true">{link.icon}</span><b>{link.label}</b>{unread > 0 && <em className="whatsapp-nav-badge" aria-label={`${unread} mensagens não lidas`}>{unread > 99 ? "99+" : unread}</em>}</Link>;
}

