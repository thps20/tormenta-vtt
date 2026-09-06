import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig(({ mode }) => {
  // Lê o .env da raiz do monorepo (padrão seria apps/web/.env).
  const envDir = "../../";
  const env = loadEnv(mode, envDir, "");
  const serverUrl = `http://localhost:${env.SERVER_PORT || "3000"}`;

  return {
    plugins: [react(), tailwindcss()],
    envDir,
    server: {
      port: 5173,
      strictPort: true,
      // Proxy: o navegador fala só com o Vite (mesma origem) e o Vite repassa
      // API, uploads e socket para o server. Assim um único túnel público
      // (make tunnel) expõe web + server, sem CORS nem URL fixa no frontend.
      proxy: {
        "/api": serverUrl,
        "/uploads": serverUrl,
        "/health": serverUrl,
        "/socket.io": { target: serverUrl, ws: true },
      },
      // Vite bloqueia hosts desconhecidos por segurança; libera o domínio do
      // túnel rápido do Cloudflare (make tunnel).
      allowedHosts: [".trycloudflare.com"],
    },
  };
});
