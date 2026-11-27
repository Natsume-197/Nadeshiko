import { beforeEach, describe, expect, test, vi } from 'vitest';

type FakeEvent = {
  url: URL;
  cookies: Record<string, string>;
  responseHeaders: Record<string, string>;
};

let redirects: Array<{ location: string; status: number }> = [];

vi.stubGlobal('defineEventHandler', (fn: unknown) => fn);
vi.stubGlobal('getRequestURL', (event: FakeEvent) => event.url);
vi.stubGlobal('getCookie', (event: FakeEvent, name: string) => event.cookies[name]);
vi.stubGlobal('setHeader', (event: FakeEvent, name: string, value: string) => {
  event.responseHeaders[name.toLowerCase()] = value;
});
vi.stubGlobal('sendRedirect', (_event: FakeEvent, location: string, status: number) => {
  redirects.push({ location, status });
});

const handler = (await import('./00-locale-router')).default as (event: FakeEvent) => unknown;

function visit(path: string) {
  const event: FakeEvent = {
    url: new URL(`https://nadeshiko.co${path}`),
    cookies: {},
    responseHeaders: {},
  };
  handler(event);
  return redirects[0] ?? null;
}

describe('locale router', () => {
  beforeEach(() => {
    redirects = [];
  });

  test('does not redirect the canonical compact Chinese slug', () => {
    expect(visit('/zh/search/学校')).toBeNull();
  });

  test('does not reinterpret an unsupported locale tag as an English path', () => {
    expect(visit('/zh-CN/about')).toBeNull();
  });

  test('redirects the root path and known unprefixed app routes to the default locale', () => {
    expect(visit('/')).toEqual({ location: '/en', status: 301 });
    redirects = [];
    expect(visit('/search/学校')).toEqual({ location: '/en/search/%E5%AD%A6%E6%A0%A1', status: 301 });
    redirects = [];
    expect(visit('/about')).toEqual({ location: '/en/about', status: 301 });
    redirects = [];
    expect(visit('/auth/callback?code=123')).toEqual({ location: '/en/auth/callback?code=123', status: 301 });
  });

  test('does not redirect unknown legacy root paths so they 404 directly', () => {
    expect(visit('/dreamseat-newcastle-unit-test')).toBeNull();
    expect(visit('/house-of-hampton-sofa')).toBeNull();
    expect(visit('/wp-content/uploads/file')).toBeNull();
  });
});
