// The games catalog, fetched once and shared.
import { useEffect, useState } from 'react';
import { rpc } from './api.js';

let cache = null;
let pending = null;
export function fetchGames() {
  if (cache) return Promise.resolve(cache);
  if (!pending) pending = rpc('games').then((r) => { cache = r; return r; }).finally(() => { pending = null; });
  return pending;
}
export function useGames() {
  const [games, setGames] = useState(cache);
  useEffect(() => { if (!cache) fetchGames().then(setGames).catch(() => {}); }, []);
  return games;
}
