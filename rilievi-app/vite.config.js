import { defineConfig } from 'vite';
export default defineConfig({
  base: './',
  worker: { format: 'es' },
  build: { target: 'es2022', outDir: 'dist' },
  // numero di build (GitHub Actions run_number): serve all'app per sapere se c'è un aggiornamento
  define: { __BUILD__: JSON.stringify(Number(process.env.RILIEVI_BUILD || 0)) },
});
