import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Types are checked in CI by scripts/quality/typecheck-baseline.mjs, which knows the legacy diagnostics.
  // Without this, `next build` would also type-check Supabase Edge Functions (Deno) and fail on them.
  typescript: { ignoreBuildErrors: true },
};

export default nextConfig;
