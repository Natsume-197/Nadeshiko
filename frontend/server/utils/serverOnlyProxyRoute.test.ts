import { describe, expect, it } from 'vitest';
import { isServerOnlyProxyRoute } from './serverOnlyProxyRoute';

describe('isServerOnlyProxyRoute', () => {
  const identify = '/v1/dictionary/identify';

  it.each([
    ['GET', identify],
    ['get', `${identify}/`],
    ['HEAD', `${identify}//`],
    ['HEAD', '/v1/dictionary/IDENTIFY/'],
  ])('refuses the Express-equivalent %s %s spelling', (method, path) => {
    expect(isServerOnlyProxyRoute(method, path)).toBe(true);
  });

  it('does not turn a prefix or another method into a denylisted route', () => {
    expect(isServerOnlyProxyRoute('GET', `${identify}/extra`)).toBe(false);
    expect(isServerOnlyProxyRoute('POST', identify)).toBe(false);
  });
});
