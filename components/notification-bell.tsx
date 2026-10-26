"use client";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";

export function NotificationBell({ storeId, organizationId }: { storeId: string; organizationId?: string }) {
  const [counts, setCounts] = useState({ unread: 0, action: 0, critical: 0 }), supabase = useMemo(() => createClient(), []);
  const load = useCallback(async () => { const response = await fetch(`/api/notifications?store_id=${storeId}&limit=10`, { cache: "no-store" }); if (response.ok) setCounts((await response.json()).counts); }, [storeId]);
  useEffect(() => { void load(); const channel = supabase.channel(`notification-bell-${organizationId || storeId}`).on("postgres_changes", { event: "*", schema: "public", table: "notification_inbox_items", filter: organizationId ? `organization_id=eq.${organizationId}` : undefined }, () => void load()).subscribe(); const timer = setInterval(() => void load(), 30000); return () => { clearInterval(timer); void supabase.removeChannel(channel); }; }, [load, organizationId, storeId, supabase]);
  return <Link className="notification-bell" href="/painel/notificacoes" aria-label={`${counts.unread} notificações não lidas; ${counts.action} precisam de ação`} title="Central de Notificações"><span aria-hidden="true">🔔</span>{counts.unread > 0 && <b>{counts.unread > 99 ? "99+" : counts.unread}</b>}{counts.action > 0 && <em>{counts.action} ação</em>}</Link>;
}
