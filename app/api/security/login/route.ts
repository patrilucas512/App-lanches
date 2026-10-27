import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { assertSameOrigin, requestIp, secureDigest } from "@/lib/security/core";

export async function POST(request: Request) {
  try { assertSameOrigin(request); } catch { return NextResponse.json({ error: "Origem não autorizada." }, { status: 403 }); }
  const body = await request.json().catch(() => ({})) as { email?: string; success?: boolean };
  const email = String(body.email || "").trim().toLowerCase();
  if (!email || email.length > 320) return NextResponse.json({ error: "E-mail inválido." }, { status: 400 });
  const subjectHash = secureDigest(`login:${email}:${requestIp(request)}`);
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("consume_security_rate_limit", {
    requested_bucket: "login", requested_subject_hash: subjectHash, requested_limit: 6,
    requested_window_seconds: 900, requested_block_seconds: 900, requested_success: Boolean(body.success),
  });
  if (error) return NextResponse.json({ error: "Proteção de login indisponível." }, { status: 503 });
  if (!data?.allowed) {
    await admin.from("security_events").insert({ event_type: "brute_force", severity: "high", title: "Tentativas repetidas de login", description: "O limite temporário de tentativas foi atingido.", metadata: { subject_hash: subjectHash, retry_after_seconds: data.retry_after_seconds } });
    return NextResponse.json({ error: "Muitas tentativas. Aguarde antes de tentar novamente.", retry_after_seconds: data.retry_after_seconds }, { status: 429, headers: { "Retry-After": String(data.retry_after_seconds || 900) } });
  }
  return NextResponse.json({ allowed: true, delay_ms: data.delay_ms || 0 });
}
