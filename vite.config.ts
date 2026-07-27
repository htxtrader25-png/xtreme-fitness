import { fileURLToPath, URL } from 'node:url';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

// Content-Security-Policy injected into the PRODUCTION build only. Applying it
// in dev would break Vite HMR / react-refresh (which rely on inline scripts and
// eval). The app makes no network calls and loads only its own bundled assets,
// so a tight policy fits: scripts/styles/connections restricted to 'self'.
// `data:` is allowed for images/fonts because of the inline SVG favicon.
// `style-src 'unsafe-inline'` covers React/DayPilot inline styles (style
// attributes are not a meaningful injection vector here). Header-only
// directives (e.g. frame-ancestors) are intentionally omitted from the meta tag.
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');

function cspPlugin(): Plugin {
  return {
    name: 'inject-csp',
    apply: 'build',
    transformIndexHtml(html) {
      return html.replace(
        '</title>',
        `</title>\n    <meta http-equiv="Content-Security-Policy" content="${CSP}" />`,
      );
    },
  };
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), cspPlugin()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    host: true,
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    // Split only the large, self-contained DayPilot library into its own chunk
    // for caching. React and app code stay together in the entry chunk to
    // preserve correct module-init order (splitting react/react-dom out can make
    // react-dom evaluate before react and crash at startup).
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('@daypilot')) return 'daypilot';
          return undefined;
        },
      },
    },
  },
});
