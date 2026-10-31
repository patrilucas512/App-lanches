export function DevEnvironmentBanner() {
  if (process.env.NODE_ENV !== "development") return null;
  const supabaseHost = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/^https?:\/\//, "");
  return <div role="status" style={{ position: "sticky", top: 0, zIndex: 2147483647, padding: "4px 12px", background: "#b45309", color: "#fff", font: "700 12px/1.4 system-ui, sans-serif", letterSpacing: "0.04em", textAlign: "center" }}>
    AMBIENTE DE DESENVOLVIMENTO{supabaseHost ? ` · Supabase: ${supabaseHost}` : " · Supabase não configurado"}
  </div>;
}
