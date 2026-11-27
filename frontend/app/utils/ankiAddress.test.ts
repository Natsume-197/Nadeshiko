import { describe, expect, it } from 'vitest';
import { ANKI_ADDRESS_KINDS, classifyAnkiAddress, isHttpAnkiAddress, isSafariBrowser } from './ankiAddress';

describe('classifyAnkiAddress', () => {
  it('classifies the default address as v4 loopback', () => {
    expect(classifyAnkiAddress('http://127.0.0.1:8765')).toBe('loopback_v4');
  });

  it('treats the whole 127.0.0.0/8 range as loopback', () => {
    // A reader running a second Anki does use these, and they are as local as
    // the canonical one.
    expect(classifyAnkiAddress('http://127.0.0.2:8765')).toBe('loopback_v4');
    expect(classifyAnkiAddress('http://127.1.2.3:8765')).toBe('loopback_v4');
  });

  it('separates the name from the number', () => {
    // Equivalent in practice, but a different CSP origin, so a failure on one
    // and not the other is a real distinction.
    expect(classifyAnkiAddress('http://localhost:8765')).toBe('localhost');
    expect(classifyAnkiAddress('http://anki.localhost:8765')).toBe('localhost');
  });

  it('recognises IPv6 loopback in its various spellings', () => {
    expect(classifyAnkiAddress('http://[::1]:8765')).toBe('loopback_v6');
    expect(classifyAnkiAddress('http://[0:0:0:0:0:0:0:1]:8765')).toBe('loopback_v6');
    expect(classifyAnkiAddress('http://[::0001]:8765')).toBe('loopback_v6');
  });

  it('does not mistake other IPv6 addresses for loopback', () => {
    expect(classifyAnkiAddress('http://[::2]:8765')).toBe('remote');
    expect(classifyAnkiAddress('http://[fe80::1]:8765')).toBe('remote');
    expect(classifyAnkiAddress('http://[2001:db8::1]:8765')).toBe('remote');
  });

  it('classifies LAN and named hosts as remote', () => {
    // The population the whole distinction exists to size: refused by
    // `connect-src` before the request reaches the network.
    expect(classifyAnkiAddress('http://192.168.1.10:8765')).toBe('remote');
    expect(classifyAnkiAddress('http://10.0.0.5:8765')).toBe('remote');
    expect(classifyAnkiAddress('http://my-desktop.lan:8765')).toBe('remote');
    expect(classifyAnkiAddress('http://host.docker.internal:8765')).toBe('remote');
  });

  it('is case-insensitive about the hostname', () => {
    expect(classifyAnkiAddress('http://LOCALHOST:8765')).toBe('localhost');
  });

  it('ignores the port and the path', () => {
    expect(classifyAnkiAddress('http://127.0.0.1')).toBe('loopback_v4');
    expect(classifyAnkiAddress('http://127.0.0.1:1234/anki')).toBe('loopback_v4');
  });

  it('reports unparseable input rather than throwing', () => {
    // A reader who typed a bare host or a typo. Fails for a reason no
    // server-side change fixes, so it has to be visible as its own shape.
    for (const value of ['', '127.0.0.1:8765', 'not a url', '://']) {
      expect(classifyAnkiAddress(value)).toBe('unparseable');
    }
  });

  it('only ever returns a declared kind', () => {
    const samples = [
      'http://127.0.0.1:8765',
      'http://localhost:8765',
      'http://[::1]:8765',
      'http://192.168.0.2:8765',
      'garbage',
    ];
    for (const sample of samples) {
      expect(ANKI_ADDRESS_KINDS).toContain(classifyAnkiAddress(sample));
    }
  });

  it('never returns anything derived from the address itself', () => {
    // The guarantee that keeps a private hostname or LAN layout out of
    // analytics: the output is a fixed label, never a transform of the input.
    const secret = 'http://davids-private-desktop.internal:8765';
    expect(classifyAnkiAddress(secret)).toBe('remote');
    expect(JSON.stringify(ANKI_ADDRESS_KINDS)).not.toContain('davids');
  });

  it('classifies HTTPS loopback proxy addresses the same as HTTP loopback', () => {
    expect(classifyAnkiAddress('https://127.0.0.1:8766')).toBe('loopback_v4');
    expect(classifyAnkiAddress('https://localhost:8766')).toBe('localhost');
    expect(classifyAnkiAddress('https://[::1]:8766')).toBe('loopback_v6');
  });
});

describe('isSafariBrowser', () => {
  it('matches Safari on macOS and iOS', () => {
    expect(
      isSafariBrowser(
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/27.2 Safari/605.1.15',
      ),
    ).toBe(true);
    expect(
      isSafariBrowser(
        'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
      ),
    ).toBe(true);
  });

  it('excludes browsers that include a Safari token in their user agent', () => {
    const nonSafari = [
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 Edg/140.0.0.0',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:132.0) Gecko/20100101 Firefox/132.0',
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/140.0.0.0 Mobile/15E148 Safari/604.1',
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/132.0 Mobile/15E148 Safari/605.1.15',
      'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36',
    ];
    for (const ua of nonSafari) {
      expect(isSafariBrowser(ua)).toBe(false);
    }
  });
});

describe('isHttpAnkiAddress', () => {
  it('returns true for plain HTTP URLs and false for HTTPS or invalid input', () => {
    expect(isHttpAnkiAddress('http://127.0.0.1:8765')).toBe(true);
    expect(isHttpAnkiAddress('  http://localhost:8765  ')).toBe(true);
    expect(isHttpAnkiAddress('https://localhost:8766')).toBe(false);
    expect(isHttpAnkiAddress('https://127.0.0.1:8766')).toBe(false);
    expect(isHttpAnkiAddress('not-a-url')).toBe(false);
  });
});
