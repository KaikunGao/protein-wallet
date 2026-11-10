import type { NextConfig } from "next";

// CF_BUILD=1 is set by the cf:* scripts (OpenNext → Cloudflare Workers). Cache Components rely on
// Node's setTimeout semantics and hang every page render in workerd (verified 2026-11-10), so the
// Cloudflare build renders pages the plain dynamic way; Vercel keeps the optimisation.
const forCloudflare = process.env.CF_BUILD === "1";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: !forCloudflare,
  partialPrefetching: !forCloudflare,
  experimental: {
    // DECISION: set by `next upgrade --agent=security` (16.4.0 -> 16.4.3).
    // 'security' is already the default; recording it keeps future
    // security-advisory upgrade reminders on. Set to false to silence them.
    agentUpgrade: "security",
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
