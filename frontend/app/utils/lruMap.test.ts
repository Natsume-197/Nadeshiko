import { describe, expect, test } from 'vitest';
import { lruRecall, lruRemember } from './lruMap';

describe('lruMap', () => {
  test('evicts the least recently used entry once over the limit', () => {
    const store = new Map<string, number>();
    lruRemember(store, 'a', 1, 2);
    lruRemember(store, 'b', 2, 2);
    expect(lruRecall(store, 'a')).toBe(1);
    lruRemember(store, 'c', 3, 2);

    expect([...store.keys()]).toEqual(['a', 'c']);
  });

  test('re-remembering a key refreshes it without growing the store', () => {
    const store = new Map<string, number>();
    lruRemember(store, 'a', 1, 2);
    lruRemember(store, 'b', 2, 2);
    lruRemember(store, 'a', 3, 2);

    expect([...store.entries()]).toEqual([
      ['b', 2],
      ['a', 3],
    ]);
    expect(lruRecall(store, 'missing')).toBeUndefined();
  });
});
