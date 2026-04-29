import basicSsl from "@vitejs/plugin-basic-ssl";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [basicSsl()],
  base: "./",
  build: {
    outDir: "C:/xampp/htdocs/CuscAR",
    emptyOutDir: true,
  },
  server: {
    https: true,
    port: 8443,
    host: true,
  },
});
