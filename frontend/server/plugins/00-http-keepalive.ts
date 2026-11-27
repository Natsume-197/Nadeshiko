// Match kamal-proxy's upstream idle connection pool (Go http.Transport default 90s) so Node does not
// close keep-alive sockets after its 5s default while kamal-proxy is about to reuse them, which
// causes intermittent 502 Bad Gateway ("connection reset by peer") on non-idempotent POST requests
// such as /v1/search and /v1/search/stats (#657). Matches backend/main.ts.

export const SERVER_KEEP_ALIVE_TIMEOUT_MS = 120_000;
// Node.js requires headersTimeout > keepAliveTimeout to avoid premature header timeouts on reused sockets.
export const SERVER_HEADERS_TIMEOUT_MS = SERVER_KEEP_ALIVE_TIMEOUT_MS + 5_000;

interface KeepAliveServer {
  keepAliveTimeout: number;
  headersTimeout: number;
}

const configuredServers = new WeakSet<KeepAliveServer>();

export function configureServerKeepAlive(server: unknown): boolean {
  if (!server || typeof server !== 'object') return false;
  const candidate = server as Partial<KeepAliveServer>;
  if (typeof candidate.keepAliveTimeout !== 'number' || typeof candidate.headersTimeout !== 'number') {
    return false;
  }
  const httpServer = candidate as KeepAliveServer;
  if (configuredServers.has(httpServer)) return false;

  httpServer.keepAliveTimeout = SERVER_KEEP_ALIVE_TIMEOUT_MS;
  httpServer.headersTimeout = SERVER_HEADERS_TIMEOUT_MS;
  configuredServers.add(httpServer);
  return true;
}

export default defineNitroPlugin((nitroApp) => {
  nitroApp.hooks.hook('request', (event) => {
    const socket = event.node?.req?.socket as { server?: unknown } | undefined;
    configureServerKeepAlive(socket?.server);
  });
});
