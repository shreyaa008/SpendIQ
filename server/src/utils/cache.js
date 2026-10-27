// Tiny per-user TTL cache for expensive analytics. Invalidated by the event bus on any write by that user.
import { bus } from './events.js';

const store = new Map(); // key -> { expires, value }
const TTL_MS = 30_000;

export async function cached(userId, name, args, compute) {
  const key = `${userId}::${name}::${JSON.stringify(args ?? null)}`;
  const hit = store.get(key);
  if (hit && hit.expires > Date.now()) return hit.value;
  const value = await compute();
  store.set(key, { expires: Date.now() + TTL_MS, value });
  if (store.size > 2000) store.delete(store.keys().next().value);
  return value;
}

export function invalidateUser(userId) {
  const prefix = `${userId}::`;
  for (const k of store.keys()) if (k.startsWith(prefix)) store.delete(k);
}

export function clearAll() {
  store.clear();
}

bus.on('data:changed', ({ userId }) => invalidateUser(userId));