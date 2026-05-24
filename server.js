/**
 * doubao-ws-proxy — Node.js WebSocket 代理
 * 部署到 Render.com (免费)
 */

const http = require('http');
const { WebSocket, WebSocketServer } = require('ws');

const PORT = process.env.PORT || 3000;
const DOUBAO_APP_ID     = process.env.DOUBAO_APP_ID;
const DOUBAO_ACCESS_KEY = process.env.DOUBAO_ACCESS_KEY;
const APP_KEY           = 'PlgvMymc7f3tQnJ6';

const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('doubao-ws-proxy ok');
});

const wss = new WebSocketServer({ server, path: '/proxy' });

wss.on('connection', (clientWs, req) => {
  console.log('[proxy] client connected');

  if (!DOUBAO_APP_ID || !DOUBAO_ACCESS_KEY) {
    console.error('[proxy] 缺少环境变量');
    clientWs.close(1011, 'server misconfigured');
    return;
  }

  const connectId = require('crypto').randomUUID();
  const volcUrl = new URL('wss://openspeech.bytedance.com/api/v3/realtime/dialogue');
  volcUrl.searchParams.set('X-Api-App-ID',      DOUBAO_APP_ID);
  volcUrl.searchParams.set('X-Api-Access-Key',  DOUBAO_ACCESS_KEY);
  volcUrl.searchParams.set('X-Api-Resource-Id', 'volc.speech.dialog');
  volcUrl.searchParams.set('X-Api-App-Key',     APP_KEY);
  volcUrl.searchParams.set('X-Api-Connect-Id',  connectId);

  const volcWs = new WebSocket(volcUrl.toString());

  volcWs.on('open', () => console.log('[proxy] 火山连接成功'));

  volcWs.on('message', (data) => {
    if (clientWs.readyState === WebSocket.OPEN) clientWs.send(data);
  });

  volcWs.on('close', (code, reason) => {
    console.log('[proxy] 火山断开 code=' + code);
    try { clientWs.close(code || 1000, reason?.toString() || ''); } catch (_) {}
  });

  volcWs.on('error', (err) => {
    console.error('[proxy] 火山错误:', err.message);
    try { clientWs.close(1011, err.message); } catch (_) {}
  });

  clientWs.on('message', (data) => {
    if (volcWs.readyState === WebSocket.OPEN) volcWs.send(data);
  });

  clientWs.on('close', () => {
    try { volcWs.close(); } catch (_) {}
  });

  clientWs.on('error', (err) => {
    console.error('[proxy] 客户端错误:', err.message);
    try { volcWs.close(); } catch (_) {}
  });
});

server.listen(PORT, () => {
  console.log('[proxy] 启动 port=' + PORT);
});
