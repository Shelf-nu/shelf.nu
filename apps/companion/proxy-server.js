/**
 * HTTP → HTTPS proxy for mobile development.
 *
 * React Native cannot talk to local dev servers with self-signed TLS certs,
 * so this tiny proxy accepts plain HTTP on port 3001 and forwards to the
 * Remix webapp on https://localhost:3000 (ignoring cert errors).
 *
 * Binds to 0.0.0.0 so the phone can reach it over the local network.
 */

const http = require("http");
const https = require("https");
const { URL } = require("url");

const PROXY_PORT = 3001;
const TARGET = "https://localhost:3000";

const server = http.createServer((clientReq, clientRes) => {
  // Build target URL
  const target = new URL(clientReq.url || "/", TARGET);

  const options = {
    hostname: target.hostname,
    port: target.port,
    path: target.pathname + target.search,
    method: clientReq.method,
    headers: { ...clientReq.headers, host: target.host },
    rejectUnauthorized: false, // allow self-signed certs
  };

  const proxyReq = https.request(options, (proxyRes) => {
    clientRes.writeHead(proxyRes.statusCode, proxyRes.headers);
    proxyRes.pipe(clientRes, { end: true });
  });

  proxyReq.on("error", (err) => {
    console.error("[proxy] upstream error:", err.message);
    if (!clientRes.headersSent) {
      clientRes.writeHead(502, { "Content-Type": "application/json" });
    }
    clientRes.end(
      JSON.stringify({ error: "Proxy upstream error", detail: err.message })
    );
  });

  clientReq.pipe(proxyReq, { end: true });
});

server.listen(PROXY_PORT, "0.0.0.0", () => {
  console.log(`[proxy] listening on http://0.0.0.0:${PROXY_PORT} → ${TARGET}`);
});
