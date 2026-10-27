import { createHash, timingSafeEqual } from "node:crypto";

export function sha256(value: string) { return createHash("sha256").update(value).digest("hex"); }
export function safeHashEquals(actual: string, expected: string) {
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(actual), Buffer.from(expected));
}

const blockedHosts = new Set(["localhost", "localhost.localdomain", "metadata.google.internal", "metadata", "0.0.0.0"]);
function privateIp(hostname: string) {
  const host = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (host === "::1" || host === "::" || host.startsWith("fc") || host.startsWith("fd") || host.startsWith("fe80:")) return true;
  const match = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!match) return false;
  const [a, b] = match.slice(1).map(Number);
  return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
}

export function validateWebhookUrl(raw: string) {
  let url: URL;
  try { url = new URL(raw); } catch { throw new Error("URL de webhook inválida."); }
  if (url.protocol !== "https:") throw new Error("Webhooks de produção exigem HTTPS.");
  const hostname = url.hostname.toLowerCase();
  if (blockedHosts.has(hostname) || hostname.endsWith(".local") || hostname.endsWith(".internal") || privateIp(hostname)) throw new Error("Destino privado ou de metadados não é permitido.");
  if (url.username || url.password || url.port && url.port !== "443") throw new Error("URL de webhook contém credenciais ou porta não permitida.");
  return url.toString();
}

export function cursorEncode(value: { created_at: string; id: string }) { return Buffer.from(JSON.stringify(value)).toString("base64url"); }
export function cursorDecode(value?: string | null) {
  if (!value) return null;
  try { const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")); return parsed?.created_at && parsed?.id ? parsed as { created_at: string; id: string } : null; }
  catch { throw new Error("Cursor inválido."); }
}

