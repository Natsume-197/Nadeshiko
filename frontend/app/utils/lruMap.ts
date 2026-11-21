/**
 * A `Map` used as a bounded least-recently-used cache. A `Map` iterates in insertion order, so re-inserting an entry
 * moves it to the back and leaves the least recently used at the front, where `lruRemember` evicts from.
 */

/** Look up an entry and mark it as freshly used; `undefined` when it is not there. */
export function lruRecall<T>(store: Map<string, T>, key: string): T | undefined {
  const answer = store.get(key);
  if (answer === undefined) return undefined;
  store.delete(key);
  store.set(key, answer);
  return answer;
}

/** Store an entry as the most recently used, evicting the least recently used once the store holds more than `limit`. */
export function lruRemember<T>(store: Map<string, T>, key: string, answer: T, limit: number): T {
  store.delete(key);
  store.set(key, answer);
  if (store.size > limit) {
    const oldest = store.keys().next().value;
    if (oldest !== undefined) store.delete(oldest);
  }
  return answer;
}
