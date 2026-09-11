import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';

// A real unavailable origin exercises WebKit's service worker without its
// automation protocol's setOffline navigation error. No network is mocked in the app.
export async function serveProduction() {
  let available = true;
  let release = 0;
  let failRelease = false;
  const root = resolve('dist');
  const types: Record<string, string> = {
    '.html': 'text/html',
    '.js': 'text/javascript',
    '.css': 'text/css',
    '.json': 'application/json',
    '.webmanifest': 'application/manifest+json',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
  };
  const server = createServer(async (request, response) => {
    if (!available) {
      request.socket.destroy();
      return;
    }
    try {
      const pathname = decodeURIComponent(new URL(request.url!, 'http://localhost').pathname);
      if (pathname === '/__release_probe') {
        response.writeHead(failRelease ? 503 : 200, { 'Cache-Control': 'no-store' }).end('release asset');
        return;
      }
      const path = resolve(root, `.${pathname === '/' ? '/index.html' : pathname}`);
      if (!path.startsWith(root + sep)) {
        response.writeHead(403).end();
        return;
      }
      let content = await readFile(path);
      if (pathname === '/sw.js' && release)
        content = Buffer.from(
          `${content.toString()}\nself.addEventListener('install', e => e.waitUntil(fetch('/__release_probe?version=${release}').then(r => { if (!r.ok) throw new Error('Release asset unavailable'); })));`,
        );
      response
        .writeHead(200, {
          'Content-Type': types[extname(path)] ?? 'application/octet-stream',
          'Cache-Control': 'no-store',
        })
        .end(content);
    } catch {
      response.writeHead(404).end('Not found');
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No test port');
  return {
    url: `http://127.0.0.1:${address.port}/`,
    offline() {
      available = false;
    },
    online() {
      available = true;
    },
    release(version: number, fail = false) {
      release = version;
      failRelease = fail;
    },
    async close() {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    },
  };
}
