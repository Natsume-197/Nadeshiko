import { describe, expect, test, vi } from 'vitest';

vi.stubGlobal('defineNitroPlugin', (fn: unknown) => fn);

const {
  default: keepAlivePlugin,
  configureServerKeepAlive,
  SERVER_KEEP_ALIVE_TIMEOUT_MS,
  SERVER_HEADERS_TIMEOUT_MS,
} = await import('./00-http-keepalive');

describe('00-http-keepalive Nitro plugin', () => {
  test('raises keepAliveTimeout above kamal-proxy 90s idle pool and keeps headersTimeout higher', () => {
    const server = { keepAliveTimeout: 5_000, headersTimeout: 60_000 };

    expect(configureServerKeepAlive(server)).toBe(true);
    expect(server.keepAliveTimeout).toBe(SERVER_KEEP_ALIVE_TIMEOUT_MS);
    expect(server.headersTimeout).toBe(SERVER_HEADERS_TIMEOUT_MS);
    expect(server.keepAliveTimeout).toBeGreaterThan(90_000);
    expect(server.headersTimeout).toBeGreaterThan(server.keepAliveTimeout);
  });

  test('is idempotent per http.Server instance', () => {
    const server = { keepAliveTimeout: 5_000, headersTimeout: 60_000 };

    expect(configureServerKeepAlive(server)).toBe(true);
    expect(configureServerKeepAlive(server)).toBe(false);
  });

  test('ignores missing or non-server objects safely', () => {
    expect(configureServerKeepAlive(undefined)).toBe(false);
    expect(configureServerKeepAlive(null)).toBe(false);
    expect(configureServerKeepAlive({})).toBe(false);
  });

  test('configures the server on the first Nitro request hook', () => {
    let requestHandler: ((event: unknown) => void) | undefined;
    const nitroApp = {
      hooks: {
        hook: vi.fn((name: string, cb: (event: unknown) => void) => {
          if (name === 'request') requestHandler = cb;
        }),
      },
    };

    (keepAlivePlugin as unknown as (app: typeof nitroApp) => void)(nitroApp);
    expect(requestHandler).toBeTypeOf('function');

    const server = { keepAliveTimeout: 5_000, headersTimeout: 60_000 };
    requestHandler!({ node: { req: { socket: { server } } } });

    expect(server.keepAliveTimeout).toBe(SERVER_KEEP_ALIVE_TIMEOUT_MS);
    expect(server.headersTimeout).toBe(SERVER_HEADERS_TIMEOUT_MS);
  });
});
