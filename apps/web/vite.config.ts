import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Lê o .env da raiz do monorepo (padrão seria apps/web/.env)
  envDir: "../../",
  server: { port: 5173, strictPort: true },
});
