// Talk to the arena. Every action is POST /api/rpc/<name> with JSON.
export async function rpc(name, args = {}) {
  let res;
  try {
    res = await fetch(`/api/rpc/${name}`, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(args) });
  } catch {
    throw new Error('Cannot reach the arena. Check your connection and try again.');
  }
  let data = null;
  try { data = await res.json(); } catch { /* empty body */ }
  if (!res.ok) {
    const err = new Error((data && data.error) || 'Something went wrong');
    err.status = res.status;
    throw err;
  }
  return data || {};
}
