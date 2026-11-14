// Para onde voltar depois do login (?next=). Só caminhos internos do app: nada de outro site
// ("//", "\\", "http:"), nem de volta para telas de login.
export function safeLoginNext(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const path = value.trim();
  if (!path.startsWith("/") || path.startsWith("//") || path.includes("\\") || /[\u0000-\u001f]/.test(path)) return null;
  if (path.length > 300 || /^\/(login|cadastro|auth)(\/|\?|$)/.test(path)) return null;
  return path;
}

// Monta o endereço com ?next= quando houver destino.
export function withLoginNext(base: string, next: string | null | undefined) {
  const safe = safeLoginNext(next);
  return safe ? `${base}?next=${encodeURIComponent(safe)}` : base;
}
