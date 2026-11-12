import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Abertura da landing: letras voando, blocos se montando e prévia ganhando cor, sem quebrar acessibilidade.
const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");
const page = read("components/landing/landing-page.tsx");
const css = read("app/landing.css");

test("título continua legível para leitores de tela e buscadores", () => {
  assert.match(page, /<h1[^>]*aria-label="Seu movimento aumentou\? Sua operação precisa acompanhar\."/);
  assert.match(page, /<FlyInText text="Seu movimento aumentou\? Sua operação precisa" start=\{0\.55\} \/>/);
  assert.match(page, /text\.split\(\/\(\\s\+\)\/\)/);
});

test("deslocamentos das letras são determinísticos (sem Math.random)", () => {
  const fly = page.slice(page.indexOf("function introOffset"), page.indexOf("function DashboardPreview"));
  assert.doesNotMatch(fly, /Math\.random|Date\.now|Math\.sin/);
  assert.match(fly, /Math\.imul/);
});

test("animação some para quem pede menos movimento", () => {
  const reduced = css.slice(css.lastIndexOf("@media (prefers-reduced-motion: reduce)"));
  assert.match(reduced, /\.intro-block, \.intro-char, \.intro-highlight, \.intro-preview img \{ animation: none; \}/);
  assert.match(reduced, /\.intro-block::after, \.intro-preview > div:first-child::before \{ display: none; \}/);
});
