// Development: the Node server on :8000 (rebuilt and restarted when server or
// game code changes) plus Vite on :5173 for the web app with hot reload.
// Open http://localhost:5173/enter  (or /workbench.html?game=<id> for one board).
import { spawn } from 'node:child_process';
import { context } from 'esbuild';

let server = null;
const start = () => {
  if (server) server.kill();
  server = spawn(process.execPath, ['build/server.cjs'], { stdio: 'inherit', env: { ...process.env, PORT: process.env.PORT || '8000', DIST_DIR: 'dist' } });
};
const ctx = await context({
  entryPoints: ['src/server/index.js'], outfile: 'build/server.cjs', bundle: true, platform: 'node', target: 'node20', format: 'cjs', packages: 'external', sourcemap: true, logLevel: 'warning',
  plugins: [{ name: 'restart', setup(b) { b.onEnd((r) => { if (r.errors.length === 0) start(); }); } }],
});
await ctx.watch();
const vite = spawn(process.execPath, ['node_modules/vite/bin/vite.js'], { stdio: 'inherit' });
const stop = () => { if (server) server.kill(); vite.kill(); ctx.dispose(); process.exit(0); };
process.on('SIGINT', stop); process.on('SIGTERM', stop);
