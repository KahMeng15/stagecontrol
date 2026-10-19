const http = require('http');

const originalCreateServer = http.createServer;
http.createServer = function(...args) {
  const server = originalCreateServer.apply(this, args);

  // Prepend WebSocket upgrade handler to proxy /api WebSocket connections directly to FastAPI
  server.prependListener('upgrade', (req, clientSocket, head) => {
    if (req.url && (req.url.startsWith('/api') || req.url.startsWith('api'))) {
      const internalApi = (process.env.INTERNAL_API_URL || 'http://api:8000').replace(/\/$/, '');
      let targetHost = 'api';
      let targetPort = 8000;
      try {
        const u = new URL(internalApi);
        targetHost = u.hostname;
        targetPort = parseInt(u.port, 10) || 8000;
      } catch (err) {
        // Fallback default
      }

      const cleanPath = req.url.startsWith('/') ? req.url : `/${req.url}`;
      const headers = { ...req.headers, host: `${targetHost}:${targetPort}` };

      const proxyReq = http.request({
        hostname: targetHost,
        port: targetPort,
        path: cleanPath,
        method: req.method,
        headers,
      });

      proxyReq.on('upgrade', (proxyRes, proxySocket, proxyHead) => {
        const responseHeaders = [
          'HTTP/1.1 101 Switching Protocols',
          ...Object.entries(proxyRes.headers).map(([k, v]) => `${k}: ${v}`),
          '',
          ''
        ].join('\r\n');

        clientSocket.write(responseHeaders);
        if (proxyHead && proxyHead.length > 0) clientSocket.write(proxyHead);
        if (head && head.length > 0) proxySocket.write(head);

        proxySocket.pipe(clientSocket);
        clientSocket.pipe(proxySocket);

        proxySocket.on('error', () => clientSocket.destroy());
        clientSocket.on('error', () => proxySocket.destroy());
      });

      proxyReq.on('error', (err) => {
        console.error('[Next.js WS-Proxy] Failed to connect to FastAPI:', err.message);
        clientSocket.destroy();
      });

      proxyReq.end();
    }
  });

  return server;
};

// Start the standalone Next.js server
require('./server.js');
