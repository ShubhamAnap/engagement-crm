import { defineConfig } from "vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import { nitro } from "nitro/vite";
import viteReact from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import viteTsConfigPaths from "vite-tsconfig-paths";

export default defineConfig(({ command }) => ({
  server: {
    host: true,
    port: 8080,
  },
  build: {
    sourcemap: false,
    reportCompressedSize: false,
  },
  // Node SMTP client — must not be prebundled for the browser.
  optimizeDeps: {
    exclude: ["nodemailer"],
  },
  ssr: {
    external: ["nodemailer"],
  },
  plugins: [
    viteTsConfigPaths({ projects: ["./tsconfig.json"] }),
    tailwindcss(),
    tanstackStart({
      // Use src/server.ts (SSR error wrapper) instead of the default server entry.
      server: { entry: "server" },
    }),
    // Nitro only for production builds (Render / node-server). Skip in `vite dev`.
    ...(command === "build" ? [nitro({ preset: "node-server" })] : []),
    viteReact(),
  ],
}));
