// Fail the build if the source uses an emoji newer than Emoji 11 (2018).
// Older phones and Windows versions draw newer ones as empty boxes, which on
// a game board means an unlabelled, unreadable piece.
//
//   node scripts/check-emoji.mjs          check src/, scripts/, index.html
//   node scripts/check-emoji.mjs --list   also print every emoji found
import fs from 'node:fs';
import path from 'node:path';

// Code points introduced in Emoji 12.0 and later.
const NEW = [
  [0x1fa70, 0x1faff], // Symbols and Pictographs Extended-A: all Emoji 12+
  [0x1f90c, 0x1f90f], [0x1f93f, 0x1f93f], [0x1f971, 0x1f972], [0x1f977, 0x1f979], [0x1f97b, 0x1f97b],
  [0x1f9a3, 0x1f9af], [0x1f9ba, 0x1f9bf], [0x1f9c3, 0x1f9cf],
  [0x1f6d5, 0x1f6d7], [0x1f6dc, 0x1f6df], [0x1f6fa, 0x1f6fc], [0x1f7e0, 0x1f7eb], [0x1f7f0, 0x1f7f0],
];
const isNew = (cp) => NEW.some(([a, b]) => cp >= a && cp <= b);
const EXT = new Set(['.js', '.jsx', '.mjs', '.css', '.html', '.md', '.json']);
const ROOTS = ['src', 'scripts', 'index.html', 'public'];

function* walk(p) {
  const st = fs.statSync(p);
  if (st.isFile()) { if (EXT.has(path.extname(p))) yield p; return; }
  for (const name of fs.readdirSync(p)) { if (name === 'node_modules' || name.startsWith('.')) continue; yield* walk(path.join(p, name)); }
}

const problems = [];
const seen = new Map();
for (const root of ROOTS) {
  if (!fs.existsSync(root)) continue;
  for (const file of walk(root)) {
    const lines = fs.readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, i) => {
      // literal characters and \u{...} escapes both count
      const cps = [...line].map((ch) => ch.codePointAt(0)).filter((cp) => cp >= 0x1f000);
      for (const m of line.matchAll(/\\u\{([0-9a-fA-F]{4,6})\}/g)) cps.push(parseInt(m[1], 16));
      for (const cp of cps) {
        seen.set(cp, (seen.get(cp) || 0) + 1);
        if (isNew(cp)) problems.push(`${file}:${i + 1}  U+${cp.toString(16).toUpperCase()} ${String.fromCodePoint(cp)}`);
      }
    });
  }
}
if (process.argv.includes('--list')) console.log([...seen.keys()].sort((a, b) => a - b).map((cp) => `U+${cp.toString(16).toUpperCase()} ${String.fromCodePoint(cp)}`).join('\n'));
if (problems.length) {
  console.error(`Emoji newer than Emoji 11 found (${problems.length}). Replace them: older devices show empty boxes.\n` + problems.join('\n'));
  process.exit(1);
}
console.log(`Emoji check passed (${seen.size} distinct emoji, all Emoji 11 or older).`);
