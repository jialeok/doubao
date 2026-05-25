const http = require('http');
const { WebSocket, WebSocketServer } = require('ws');

const PORT = process.env.PORT || 3000;
const DOUBAO_API_KEY = process.env.DOUBAO_API_KEY;

const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('doubao-ws-proxy ok');
});

const wss = new WebSocketServer({ server, path: '/proxy' });

wss.on('connection', (clientWs, req) => {
  console.log('[proxy] client connected');

  if (!DOUBAO_API_KEY) {
    console.error('[proxy] 缺少环境变量 DOUBAO_API_KEY');
    clientWs.close(1011, 'server misconfigured');
    return;
  }

  const connectId = require('crypto').randomUUID();

  // 新版 API Key 鉴权方式
  const volcWs = new WebSocket(
    'wss://openspeech.bytedance.com/api/v3/realtime/dialogue',
    {
      headers: {
        'Authorization':    'Bearer ' + DOUBAO_API_KEY,
        'X-Api-Connect-Id': connectId,
      }
    }
  );

  volcWs.on('open', () => console.log('[proxy] 火山连接成功 connectId=' + connectId));

  volcWs.on('message', (data) => {
    if (clientWs.readyState === WebSocket.OPEN) clientWs.send(data);
  });

  volcWs.on('close', (code, reason) => {
    console.log('[proxy] 火山断开 code=' + code + ' reason=' + reason);
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
