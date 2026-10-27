import type { CSSProperties } from "react";

export type EstablishmentBrand = { id?: string | null; name?: string | null; logo_url?: string | null; menu_display_name?: string | null; menu_logo_url?: string | null; accent_color?: string | null; menu_background_color?: string | null; menu_surface_color?: string | null; menu_text_color?: string | null; menu_muted_color?: string | null };
export const brandName = (brand: EstablishmentBrand) => brand.menu_display_name?.trim() || brand.name || "MasterApp";
export const brandLogo = (brand: EstablishmentBrand) => brand.menu_logo_url || brand.logo_url || "";
const hex = (value: string | null | undefined, fallback: string) => /^#[0-9a-f]{6}$/i.test(value || "") ? value! : fallback;
function luminance(color: string) {
  const rgb = [1, 3, 5].map(start => parseInt(color.slice(start, start + 2), 16) / 255)
    .map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4);
  return rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722;
}
export function readableText(background: string, preferred = "#fffaf1") {
  const a = luminance(background), b = luminance(preferred);
  if ((Math.max(a, b) + .05) / (Math.min(a, b) + .05) >= 4.5) return preferred;
  return a > .179 ? "#000000" : "#ffffff";
}
export function operationTheme(brand: EstablishmentBrand): CSSProperties {
  const surface = hex(brand.menu_surface_color, "#151411");
  const accent = hex(brand.accent_color, "#ff5a1f");
  const background = hex(brand.menu_background_color, "#080707");
  return { "--op-background": background, "--op-background-text": readableText(background, hex(brand.menu_text_color, "#fffaf1")),
    "--op-background-muted": readableText(background, hex(brand.menu_muted_color, "#aaa59c")),
    "--op-surface": surface, "--op-text": readableText(surface, hex(brand.menu_text_color, "#fffaf1")),
    "--op-accent": accent, "--op-on-accent": readableText(accent),
    "--op-muted": readableText(surface, hex(brand.menu_muted_color, "#aaa59c")),
    "--op-link": readableText(surface, accent),
    colorScheme: luminance(surface) > .179 ? "light" : "dark" } as CSSProperties;
}
