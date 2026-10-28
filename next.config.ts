import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  partialPrefetching: true,
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
