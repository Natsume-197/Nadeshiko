import { describe, test, expect, vi } from 'vitest';
import { computed } from 'vue';

const user = { isLoggedIn: false, preferences: {} as { mediaCardDefault?: string } };
vi.stubGlobal('userStore', () => user);
vi.stubGlobal('computed', computed);

import { DEFAULT_MEDIA_CARD_DEFAULT, useMediaCardDefault } from './useMediaCardDefault';

function as(isLoggedIn: boolean, mediaCardDefault?: string) {
  user.isLoggedIn = isLoggedIn;
  user.preferences = mediaCardDefault === undefined ? {} : { mediaCardDefault };
  return useMediaCardDefault();
}

describe('useMediaCardDefault', () => {
  test('the card starts closed by default', () => {
    expect(DEFAULT_MEDIA_CARD_DEFAULT).toBe('CLOSED');
    expect(as(false).startsOpen.value).toBe(false);
    expect(as(true).startsOpen.value).toBe(false);
  });

  test('a reader who chose open keeps it open', () => {
    expect(as(true, 'OPEN').startsOpen.value).toBe(true);
  });

  test('a reader who chose closed keeps it closed', () => {
    expect(as(true, 'CLOSED').startsOpen.value).toBe(false);
  });

  test('anything else falls back to the default', () => {
    expect(as(true, 'SIDEWAYS').preference.value).toBe(DEFAULT_MEDIA_CARD_DEFAULT);
  });
});
