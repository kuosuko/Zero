// 同源 proxy: mail.suko.tw 的後端 API 路徑 (/api, /agents, /monitoring, /sse, /mcp, /.well-known, /health)
// 透過 service binding 轉發到 zero-server worker；其餘路徑走靜態 SPA 資產。
// 目的: 前後端同源，消除跨來源 CORS / cookie / preflight 造成的 rate-limit 風暴。
const BACKEND_PREFIXES = [
  '/api/',
  '/agents/',
  '/monitoring/',
  '/sse',
  '/mcp',
  '/.well-known/',
  '/health',
];

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    if (BACKEND_PREFIXES.some((p) => path === p || path.startsWith(p))) {
      // 轉發到後端 (含 WebSocket upgrade、cookie、headers)。
      return env.BACKEND.fetch(request);
    }
    return env.ASSETS.fetch(request);
  },
};
