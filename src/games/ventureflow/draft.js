// Reading the engine's state out of an Immer draft.
//
// Inside a boardgame.io move G is an Immer draft. VentureFlow's reducer is
// written immutably against plain objects and must be given plain data.
// Immer's current() does that for free: on an untouched draft it hands back
// the frozen original, so nothing is copied.
//
// The catch: current() only understands drafts made by the SAME copy of Immer.
//   * Server bundle: this file and boardgame.io both `require('immer')`. One copy.
//   * Browser (the workbench): the bundler gives both the same module. One copy.
//   * Test runner: boardgame.io is loaded as CommonJS and this file as an ES
//     module, which are two different builds of Immer with mismatched
//     internals; the ES module's current() throws on boardgame.io's draft.
//     There we ask Node for the CommonJS copy, the one boardgame.io itself uses.
//   * If neither works the state is copied through JSON: slow, always correct.
// Which reader works is found once, by trying, on the first move.
import { current, isDraft } from 'immer';

let reader = null;
let mode = null;

function commonJsCurrent() {
  try {
    const mod = typeof process !== 'undefined' && typeof process.getBuiltinModule === 'function' ? process.getBuiltinModule('node:module') : null;
    if (!mod) return null;
    const cjs = mod.createRequire(`${process.cwd()}/`)('immer');
    return typeof cjs.current === 'function' ? cjs.current : null;
  } catch {
    return null;
  }
}

const copy = (x) => JSON.parse(JSON.stringify(x));

/** Plain data for a value that may be an Immer draft. */
export function plain(x) {
  if (!isDraft(x)) return x;
  if (reader) return reader(x);
  for (const [name, get] of [['immer', () => current], ['immer-cjs', commonJsCurrent], ['copy', () => copy]]) {
    const fn = get();
    if (!fn) continue;
    try {
      const value = fn(x);
      if (!value || typeof value !== 'object' || isDraft(value)) continue;
      reader = fn; mode = name;
      return value;
    } catch { /* not this copy of Immer: try the next */ }
  }
  throw new Error('ventureflow: could not read the game state out of its draft');
}

/** For the tests: how plain() reads a draft in this process ('immer', 'immer-cjs', 'copy', or null before the first move). */
export const readMode = () => mode;
