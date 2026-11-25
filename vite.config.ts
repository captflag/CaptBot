import path from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { loadEnv, type Plugin } from 'vite';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

/**
 * Serves the Vercel functions in api/ from the Vite dev server, so `npm run dev` runs the whole
 * app: sign-in, the free tier and server storage, with server secrets read from .env.local.
 */
function devApi(): Plugin {
  return {
    name: 'captbot-dev-api',
    apply: 'serve',
    configureServer(server) {
      // On Windows a folder can be briefly locked while a file in it is saved, and the watcher's
      // scan then fails with EBUSY. Unhandled, that error ends the dev server; the next change
      // is picked up normally, so a warning is enough.
      server.watcher.on('error', (err) => server.config.logger.warn(`File watcher: ${err instanceof Error ? err.message : String(err)}`));
      const env = loadEnv(server.config.mode, server.config.root, '');
      for (const [key, value] of Object.entries(env)) {
        if (!key.startsWith('VITE_') && process.env[key] === undefined) process.env[key] = value;
      }
      server.middlewares.use(async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
        const url = req.url ?? '';
        const route = /^\/api\/([a-z]+)(?:[?#]|$)/.exec(url)?.[1];
        if (!route) return next();
        let handler: { fetch(request: Request): Promise<Response> };
        try {
          handler = (await server.ssrLoadModule(`/api/${route}.ts`)).default;
        } catch {
          res.statusCode = 404;
          res.setHeader('content-type', 'application/json');
          res.end(JSON.stringify({ error: `No API route /api/${route}.` }));
          return;
        }
        try {
          const chunks: Buffer[] = [];
          for await (const chunk of req) chunks.push(chunk as Buffer);
          const headers = new Headers();
          for (const [key, value] of Object.entries(req.headers)) {
            if (typeof value === 'string') headers.set(key, value);
            else if (Array.isArray(value)) headers.set(key, value.join(', '));
          }
          const aborted = new AbortController();
          res.on('close', () => !res.writableEnded && aborted.abort());
          const hasBody = req.method !== 'GET' && req.method !== 'HEAD' && chunks.length > 0;
          const response = await handler.fetch(
            new Request(`http://${req.headers.host ?? 'localhost'}${url}`, {
              method: req.method,
              headers,
              body: hasBody ? Buffer.concat(chunks) : undefined,
              signal: aborted.signal,
            }),
          );
          res.statusCode = response.status;
          response.headers.forEach((value, key) => res.setHeader(key, value));
          // Stream the body through, so the chat's server-sent events arrive as they're produced.
          if (response.body) for await (const part of response.body as unknown as AsyncIterable<Uint8Array>) res.write(part);
          res.end();
        } catch (err) {
          server.config.logger.error(`[api/${route}] ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`);
          if (!res.headersSent) {
            res.statusCode = 500;
            res.setHeader('content-type', 'application/json');
          }
          res.end(JSON.stringify({ error: 'Something went wrong on the server.' }));
        }
      });
    },
  };
}

// No API keys are injected at build time. Keys are entered by the user in
// Settings and stay in their browser, so a public deploy never leaks one.
export default defineConfig({
  plugins: [react(), tailwindcss(), devApi()],
  resolve: {
    alias: { '@': path.resolve(import.meta.dirname, 'src') },
  },
  server: { port: 3000 },
  // Provider SDKs, parsers and charts are already split out; the app shell is ~210 kB gzipped.
  build: { chunkSizeWarningLimit: 900 },
  worker: { format: 'es' },
  optimizeDeps: {
    // transformers.js ships its own wasm/onnx loaders; pre-bundling breaks them.
    exclude: ['@huggingface/transformers'],
    // Pre-bundle these up front, in the same pass as React. Lazily imported deps would otherwise
    // reload the page (interrupting indexing) the first time they load, and a dep discovered
    // mid-session (seen with a React hooks package) can get its own inlined copy of React -> "Invalid hook call".
    include: [
      'pdfjs-dist',
      'mammoth',
      'turndown',
      '@mozilla/readability',
      'recharts',
      '@google/genai',
      '@anthropic-ai/sdk',
      '@modelcontextprotocol/sdk/client/index.js',
      '@modelcontextprotocol/sdk/client/sse.js',
      '@modelcontextprotocol/sdk/client/streamableHttp.js',
    ],
  },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}', 'api/**/*.test.ts'],
    setupFiles: ['src/test/setup.ts'],
  },
});
