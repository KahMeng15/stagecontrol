const http = require("http");

const originalCreateServer = http.createServer;
http.createServer = function(...args) {
  const server = originalCreateServer.apply(this, args);

  const internalApi = (process.env.INTERNAL_API_URL || "http://api:8000").replace(/\/$/, "");
  let apiHost = "api";
  let apiPort = 8000;
  try {
    const u = new URL(internalApi);
    apiHost = u.hostname;
    apiPort = parseInt(u.port, 10) || 8000;
  } catch (err) {}

  const mediamtxHls = (process.env.INTERNAL_MEDIAMTX_HLS_URL || "http://mediamtx:8888").replace(/\/$/, "");
  let mtxHost = "mediamtx";
  let mtxHlsPort = 8888;
  try {
    const u = new URL(mediamtxHls);
    mtxHost = u.hostname;
    mtxHlsPort = parseInt(u.port, 10) || 8888;
  } catch (err) {}

  const originalEmit = server.emit;
  server.emit = function(event, ...eventArgs) {
    // 1. Proxy /live requests to MediaMTX HLS
    if (event === "request") {
      const [req, res] = eventArgs;
      if (req.url && req.url.startsWith("/live")) {
        const proxyReq = http.request({
          hostname: mtxHost,
          port: mtxHlsPort,
          path: req.url,
          method: req.method,
          headers: { ...req.headers, host: `${mtxHost}:${mtxHlsPort}` }
        }, (proxyRes) => {
          res.writeHead(proxyRes.statusCode, proxyRes.headers);
          proxyRes.pipe(res);
        });
        proxyReq.on("error", (err) => {
          console.error("[Next.js Live-Proxy] MediaMTX error:", err.message);
          if (!res.headersSent) res.writeHead(502);
          res.end("Bad Gateway: MediaMTX");
        });
        req.pipe(proxyReq);
        return true; // Bypasses Next.js router
      }
    }

    // 2. Proxy WebSocket Upgrade requests directly to FastAPI and prevent Next.js from killing socket
    if (event === "upgrade") {
      const [req, clientSocket, head] = eventArgs;
      const url = req.url || "";
      if (url.startsWith("/api") || url.startsWith("api")) {
        const cleanPath = url.startsWith("/") ? url : `/${url}`;
        const headers = { ...req.headers, host: `${apiHost}:${apiPort}` };

        const proxyReq = http.request({
          hostname: apiHost,
          port: apiPort,
          path: cleanPath,
          method: req.method,
          headers,
        });

        proxyReq.on("upgrade", (proxyRes, proxySocket, proxyHead) => {
          let headerStr = "HTTP/1.1 101 Switching Protocols\r\n";
          for (let i = 0; i < proxyRes.rawHeaders.length; i += 2) {
            headerStr += `${proxyRes.rawHeaders[i]}: ${proxyRes.rawHeaders[i+1]}\r\n`;
          }
          headerStr += "\r\n";

          clientSocket.write(headerStr);
          if (proxyHead && proxyHead.length > 0) clientSocket.write(proxyHead);
          if (head && head.length > 0) proxySocket.write(head);

          proxySocket.pipe(clientSocket);
          clientSocket.pipe(proxySocket);

          proxySocket.on("error", () => clientSocket.destroy());
          clientSocket.on("error", () => proxySocket.destroy());
        });

        proxyReq.on("response", (proxyRes) => {
          let headerStr = `HTTP/1.1 ${proxyRes.statusCode} ${proxyRes.statusMessage || ""}\r\n`;
          for (let i = 0; i < proxyRes.rawHeaders.length; i += 2) {
            headerStr += `${proxyRes.rawHeaders[i]}: ${proxyRes.rawHeaders[i+1]}\r\n`;
          }
          headerStr += "\r\n";
          clientSocket.write(headerStr);
          proxyRes.pipe(clientSocket);
        });

        proxyReq.on("error", (err) => {
          console.error("[Next.js WS-Proxy] Connect error:", err.message);
          clientSocket.destroy();
        });

        clientSocket.on("error", () => proxyReq.destroy());
        clientSocket.on("close", () => proxyReq.destroy());

        proxyReq.end();
        return true; // Crucial: Prevents Next.js internal upgradeHandler from calling socket.end()!
      }
    }

    return originalEmit.apply(this, [event, ...eventArgs]);
  };

  return server;
};

// Start the standalone Next.js server
require("./server.js");
