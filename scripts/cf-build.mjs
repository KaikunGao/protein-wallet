// Build for Cloudflare without baking local secrets into the Worker.
//
// OpenNext reads every .env* file at build time and inlines the values into
// .open-next/cloudflare/next-env.mjs, so a plain `opennextjs-cloudflare build`
// would ship .env.local (API keys) inside the uploaded bundle. We hide the
// local-only env files while the build runs and restore them afterwards;
// production values come from `wrangler secret put` / wrangler.jsonc `vars`.
import { existsSync, renameSync } from "node:fs";
import { spawnSync } from "node:child_process";

const localOnly = [".env.local", ".env.development.local", ".env.production.local"].filter(existsSync);
for (const f of localOnly) renameSync(f, `${f}.cf-hidden`);
try {
  const r = spawnSync("npx", ["opennextjs-cloudflare", "build"], {
    stdio: "inherit",
    env: { ...process.env, CF_BUILD: "1" },
  });
  process.exitCode = r.status ?? 1;
} finally {
  for (const f of localOnly) renameSync(`${f}.cf-hidden`, f);
}
