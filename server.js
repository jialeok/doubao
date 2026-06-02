const http = require('http');
const { WebSocket, WebSocketServer } = require('ws');

const PORT = process.env.PORT || 3000;
const DOUBAO_APP_ID     = process.env.DOUBAO_APP_ID;
const DOUBAO_ACCESS_KEY = process.env.DOUBAO_API_KEY;
const APP_KEY           = process.env.DOUBAO_APP_KEY;

const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('doubao-ws-proxy ok');
});

// 禁用 perMessageDeflate，避免压缩干扰火山二进制协议
const wss = new WebSocketServer({ server, path: '/proxy', perMessageDeflate: false });

// 把 ws data 统一转成 Buffer（防止 Buffer[] 数组情况）
function toBuffer(data) {
  if (Buffer.isBuffer(data)) return data;
  if (data instanceof ArrayBuffer) return Buffer.from(data);
  if (Array.isArray(data)) return Buffer.concat(data.map(toBuffer));
  return Buffer.from(data);
}

wss.on('connection', (clientWs, req) => {
  console.log('[proxy] client connected');

  if (!DOUBAO_APP_ID || !DOUBAO_ACCESS_KEY || !APP_KEY) {
    console.error('[proxy] 缺少环境变量');
    clientWs.close(1011, 'server misconfigured');
    return;
  }

  const connectId = require('crypto').randomUUID();

  // 缓冲：火山还没 open 时，客户端发来的帧先存起来
  let volcReady = false;
  const pendingFrames = [];

  const volcWs = new WebSocket(
    'wss://openspeech.bytedance.com/api/v3/realtime/dialogue',
    {
      perMessageDeflate: false,   // ← 关键：禁用压缩，火山二进制协议不支持
      headers: {
        'X-Api-App-ID':      DOUBAO_APP_ID,
        'X-Api-Access-Key':  DOUBAO_ACCESS_KEY,
        'X-Api-Resource-Id': 'volc.speech.dialog',
        'X-Api-App-Key':     APP_KEY,
        'X-Api-Connect-Id':  connectId,
      }
    }
  );

  volcWs.on('open', () => {
    console.log('[proxy] 火山连接成功 connectId=' + connectId);
    volcReady = true;
    // 把缓冲的帧全部发给火山
    pendingFrames.forEach(({ data }) => {
      const buf = toBuffer(data);
      volcWs.send(buf, { binary: true });
      console.log('[proxy] 发送缓冲帧 len=' + buf.length);
    });
    pendingFrames.length = 0;
  });

  // 火山 → 客户端（原样转发 Buffer）
  volcWs.on('message', (data, isBinary) => {
    if (clientWs.readyState === WebSocket.OPEN) {
      const buf = toBuffer(data);
      clientWs.send(buf, { binary: true });
      console.log('[proxy] 火山→客户端 len=' + buf.length);
    }
  });

  volcWs.on('close', (code, reason) => {
    console.log('[proxy] 火山断开 code=' + code + ' reason=' + reason);
    try { clientWs.close(code || 1000, reason?.toString() || ''); } catch (_) {}
  });

  volcWs.on('error', (err) => {
    console.error('[proxy] 火山错误:', err.message);
    try { clientWs.close(1011, err.message); } catch (_) {}
  });

  // 客户端 → 火山（统一转 Buffer 再发）
  clientWs.on('message', (data, isBinary) => {
    const buf = toBuffer(data);
    console.log('[proxy] 客户端→火山 len=' + buf.length + ' 前16字节:[' + Array.from(buf.slice(0,16)).join(' ') + ']');
    if (volcReady && volcWs.readyState === WebSocket.OPEN) {
      volcWs.send(buf, { binary: true });
    } else {
      pendingFrames.push({ data: buf });
      console.log('[proxy] 缓冲帧 len=' + buf.length);
    }
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
