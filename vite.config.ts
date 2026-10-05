import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import { fileURLToPath, URL } from "node:url";

if ((process.env.VERCEL || process.env.NETLIFY) && process.env.CLINICAL_DATA_STRIPPED !== "true") {
  throw new Error(
    "Despliegue estático bloqueado: el bundle contiene datos clínicos. Usá el servidor privado o generá un dataset demo sin pacientes.",
  );
}

export default defineConfig({
  plugins: [
    tanstackRouter({ target: "react", autoCodeSplitting: true }),
    react(),
    tailwindcss(),
  ],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  server: { host: "0.0.0.0", port: 8080 },
  preview: { port: 8081 },
  build: {
    outDir: "dist",
    sourcemap: false,
  },
});
