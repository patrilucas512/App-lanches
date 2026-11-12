import { createAdminClient } from "@/lib/supabase/admin";

// Link do cardápio: a loja escolhe a parte do nome; o domínio continua sendo do MasterApp.
export const MENU_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

// Mesmo resultado de public.normalize_menu_slug no banco, para a prévia na tela bater com o salvo.
export function normalizeMenuSlug(raw: string) {
  const from = "áàâãäåéèêëíìîïóòôõöúùûüçñ";
  const to = "aaaaaaeeeeiiiiooooouuuucn";
  const lowered = [...raw.toLowerCase()].map(char => { const i = from.indexOf(char); return i >= 0 ? to[i] : char; }).join("");
  return lowered.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

export const MENU_SLUG_ERRORS: Record<string, string> = {
  SLUG_LENGTH: "Use entre 3 e 40 letras ou números.",
  SLUG_RESERVED: "Esse nome é reservado pelo MasterApp. Escolha outro.",
  SLUG_TAKEN: "Esse nome já está em uso por outra loja. Tente outro.",
  FORBIDDEN: "Só o dono ou o gerente da loja pode mudar o link.",
};

// Nome antigo de uma loja que trocou o link: devolve o nome atual para redirecionar.
export async function resolveRenamedSlug(slug: string) {
  if (!MENU_SLUG_PATTERN.test(slug)) return null;
  try {
    const admin = createAdminClient();
    const { data } = await admin.from("establishment_slug_history").select("establishments(slug,active)").eq("slug", slug).maybeSingle();
    const raw = (data as { establishments?: unknown } | null)?.establishments;
    const store = (Array.isArray(raw) ? raw[0] : raw) as { slug?: string; active?: boolean } | undefined;
    return store?.active && store.slug && store.slug !== slug ? store.slug : null;
  } catch {
    return null;
  }
}
