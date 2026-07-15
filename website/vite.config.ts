import { cloudflare } from "@cloudflare/vite-plugin";
import { defineConfig } from "vite";
import vinext from "vinext";
import hostingConfig from "./.openai/hosting.json";
import { sites } from "./build/sites-vite-plugin";

export default defineConfig({
  plugins: [
    vinext(),
    sites(),
    cloudflare({
      viteEnvironment: { name: "rsc", childEnvironments: ["ssr"] },
      config: {
        main: "./worker/index.ts",
        compatibility_flags: ["nodejs_compat"],
        d1_databases: hostingConfig.d1 ? [] : [],
        r2_buckets: hostingConfig.r2 ? [] : [],
      },
    }),
  ],
});
