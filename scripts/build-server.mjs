// Bundle the server into one CommonJS file. Dependencies stay external (they
// are installed on the host); our own source, the game rules included, is
// bundled so Node does not have to resolve extensionless ESM imports.
import { build } from 'esbuild';

await build({
  entryPoints: ['src/server/index.js'],
  outfile: 'build/server.cjs',
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  packages: 'external',
  sourcemap: true,
  logLevel: 'info',
  loader: { '.js': 'js' },
});
