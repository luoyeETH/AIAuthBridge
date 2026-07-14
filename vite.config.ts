import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // GitHub Pages project site base. Override with VITE_BASE=/ for custom domain.
  base: process.env.VITE_BASE || "./",
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
});
