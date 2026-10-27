import { createHash, createHmac, randomBytes, randomInt } from "node:crypto";
import { cookies } from "next/headers";
import { createAdminClient } from "@/lib/supabase/admin";

export const CUSTOMER_PORTAL_COOKIE = "masterapp_customer_portal";

function secret() {
  const value = process.env.CUSTOMER_PORTAL_OTP_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!value) throw new Error("Segurança do portal não configurada.");
  return value;
}

export function secureHash(value: string) {
  return createHmac("sha256", secret()).update(value, "utf8").digest("hex");
}

export function publicFingerprint(value: string) {
  return createHash("sha256").update(value || "unknown", "utf8").digest("hex");
}

export function createOtp() { return String(randomInt(0, 1_000_000)).padStart(6, "0"); }
export function createPortalToken() { return randomBytes(32).toString("hex"); }

export function requestFingerprint(request: Request) {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  return secureHash(`requester:${forwarded}`);
}

export function userAgentFingerprint(request: Request) {
  return publicFingerprint(request.headers.get("user-agent") || "unknown");
}

export async function readPortalToken() { return (await cookies()).get(CUSTOMER_PORTAL_COOKIE)?.value || ""; }

export async function getPortalContext(slug: string) {
  const token = await readPortalToken();
  if (!token) return null;
  const admin=createAdminClient();const sessionHash=secureHash(`session:${token}`);
  const[{data,error},{data:subscriptions},{data:reservationContext}]=await Promise.all([
    admin.rpc("get_customer_portal_context", { requested_session_hash:sessionHash, requested_slug: slug }),
    admin.rpc("get_customer_subscription_portal",{requested_session_hash:sessionHash,requested_slug:slug}),
    admin.rpc("get_reservation_portal_context",{requested_session_hash:sessionHash,requested_slug:slug}),
  ]);
  if (error) return null;
  return {...data,subscriptions:subscriptions?.subscriptions||[],available_subscription_plans:subscriptions?.available_plans||[],reservations:reservationContext?.reservations||[],waitlist:reservationContext?.waitlist||[],reservation_settings:reservationContext?.settings||null} as Record<string, unknown>;
}

