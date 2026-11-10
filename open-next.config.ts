import { defineCloudflareConfig } from "@opennextjs/cloudflare";

// No incremental cache: the app has no ISR pages, every API call is dynamic.
export default defineCloudflareConfig({});
