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

  // 缓冲：火山还没 open 时，客户端发来的帧先存起来
  let volcReady = false;
  const pendingFrames = [];

  const volcWs = new WebSocket(
    'wss://openspeech.bytedance.com/api/v3/realtime/dialogue',
    {
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
    pendingFrames.forEach(({ data, isBinary }) => {
      volcWs.send(data, { binary: isBinary });
      console.log('[proxy] 发送缓冲帧 binary=' + isBinary + ' len=' + (data.length || data.byteLength));
    });
    pendingFrames.length = 0;
  });

  // 火山 → 客户端
  volcWs.on('message', (data, isBinary) => {
    if (clientWs.readyState === WebSocket.OPEN) {
      clientWs.send(data, { binary: isBinary });
      console.log('[proxy] 火山→客户端 binary=' + isBinary + ' len=' + (data.length || data.byteLength));
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

  // 客户端 → 火山
  clientWs.on('message', (data, isBinary) => {
    if (volcReady && volcWs.readyState === WebSocket.OPEN) {
      volcWs.send(data, { binary: isBinary });
      console.log('[proxy] 客户端→火山 binary=' + isBinary + ' len=' + (data.length || data.byteLength));
    } else {
      // 火山还没 ready，先缓冲
      pendingFrames.push({ data, isBinary });
      console.log('[proxy] 缓冲帧 len=' + (data.length || data.byteLength));
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
