import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function proxy(request: NextRequest) {
  const requestHeaders = new Headers(request.headers);
  const incomingCorrelation = request.headers.get("x-correlation-id")?.trim();
  const correlationId = incomingCorrelation && incomingCorrelation.length <= 160 && /^[a-zA-Z0-9._:-]+$/.test(incomingCorrelation) ? incomingCorrelation : crypto.randomUUID();
  requestHeaders.set("x-correlation-id", correlationId);
  requestHeaders.set("x-request-id", request.headers.get("x-request-id") || correlationId);
  let response = NextResponse.next({ request: { headers: requestHeaders } });
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  const applySecurityHeaders = (target: NextResponse) => {
    const csp = ["default-src 'self'", "base-uri 'self'", "frame-ancestors 'none'", "object-src 'none'", "form-action 'self'", "script-src 'self' 'unsafe-inline'", "style-src 'self' 'unsafe-inline'", "img-src 'self' data: blob: https:", "font-src 'self' data:", "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://api.mercadopago.com https://api.pagar.me https://graph.facebook.com", "upgrade-insecure-requests"].join("; ");
    target.headers.set("Content-Security-Policy", csp);
    target.headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
    target.headers.set("X-Content-Type-Options", "nosniff");
    target.headers.set("X-Frame-Options", "DENY");
    target.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
    target.headers.set("Permissions-Policy", "camera=(), microphone=(self), geolocation=(self), payment=(self), usb=(self)");
    target.headers.set("X-Correlation-Id", correlationId);
    target.headers.set("X-MasterApp-Release", process.env.CF_PAGES_COMMIT_SHA || process.env.NEXT_PUBLIC_RELEASE_VERSION || "development");
    return target;
  };
  if (!url || !key) return applySecurityHeaders(response);
  const supabase = createServerClient(url, key, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (items) => {
        items.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request: { headers: requestHeaders } });
        items.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });
  const { data: claimData } = await supabase.auth.getClaims();
  const sessionId = claimData?.claims?.session_id;
  if (sessionId) {
    const { data: tracked } = await supabase.from("security_sessions").select("revoked_at").eq("auth_session_id", sessionId).maybeSingle();
    if (tracked?.revoked_at) {
      await supabase.auth.signOut({ scope: "local" });
      if (request.nextUrl.pathname.startsWith("/painel") || request.nextUrl.pathname.startsWith("/superadmin")) return applySecurityHeaders(NextResponse.redirect(new URL("/login?sessao=revogada", request.url)));
    }
  }
  return applySecurityHeaders(response);
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"] };
