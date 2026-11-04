import { test as base, expect } from "@playwright/test";

// The core E2E writes real orders. They run only against homologação (masterapp-dev) or a local server.
const PRODUCTION_ORIGINS = ["https://app-lanches-psi.vercel.app", "https://app-lanches-lucas-patrick.vercel.app", "https://app-lanches-git-main-lucas-patrick.vercel.app"];

export const STORE_SLUG = process.env.E2E_STORE_SLUG || "lanchonete-teste";
export const owner = {
  email: process.env.E2E_OWNER_EMAIL || process.env.DEV_OWNER_EMAIL || "",
  password: process.env.E2E_OWNER_PASSWORD || process.env.DEV_OWNER_PASSWORD || "",
};

export const test = base.extend<{ guardTarget: void }>({
  guardTarget: [async ({ baseURL }, use) => {
    const origin = new URL(baseURL || "http://localhost:3000").origin;
    if (PRODUCTION_ORIGINS.includes(origin)) throw new Error(`E2E bloqueado: ${origin} é produção.`);
    await use();
  }, { auto: true }],
});

export { expect };
