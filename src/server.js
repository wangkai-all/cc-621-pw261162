// 仅使用 Node.js 内置模块的 HTTP 服务。
// 启动：node src/server.js（或 node server.js 的兼容入口见项目根）
// 端口：环境变量 PORT，默认 3000；仅绑定 127.0.0.1，不对外暴露。

import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { analyzeAll } from './analysis.js';
import { Store, ValidationError, NotFoundError } from './store.js';
import { sampleScores, sampleCupBatches } from './sample-data.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const MAX_BODY_BYTES = 64 * 1024;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8'
};

export function createServer(store = new Store(sampleScores, sampleCupBatches)) {
  async function serveStatic(req, res) {
    const url = new URL(req.url, 'http://127.0.0.1');
    let pathname = decodeURIComponent(url.pathname);
    if (pathname === '/') pathname = '/index.html';
    // 防路径穿越：规范化后必须仍在 PUBLIC_DIR 内
    const filePath = path.normalize(path.join(PUBLIC_DIR, pathname));
    if (!filePath.startsWith(PUBLIC_DIR + path.sep) && filePath !== PUBLIC_DIR) {
      res.writeHead(403).end('Forbidden');
      return;
    }
    try {
      const body = await readFile(filePath);
      res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] ?? 'application/octet-stream' });
      res.end(body);
    } catch {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Not Found');
    }
  }

  function sendJson(res, statusCode, payload) {
    res.writeHead(statusCode, { 'Content-Type': MIME['.json'] });
    res.end(JSON.stringify(payload));
  }

  function readJsonBody(req) {
    return new Promise((resolve, reject) => {
      let size = 0;
      const chunks = [];
      req.on('data', (chunk) => {
        size += chunk.length;
        if (size > MAX_BODY_BYTES) {
          reject(new ValidationError('请求体超过 64KB 限制'));
          req.destroy();
          return;
        }
        chunks.push(chunk);
      });
      req.on('end', () => {
        if (chunks.length === 0) return resolve({});
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
        } catch {
          reject(new ValidationError('请求体不是合法 JSON'));
        }
      });
      req.on('error', reject);
    });
  }

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    const { pathname } = url;

    try {
      if (req.method === 'GET' && (pathname === '/' || pathname.startsWith('/index.html') || pathname === '/app.js' || pathname === '/styles.css')) {
        return await serveStatic(req, res);
      }

      if (req.method === 'GET' && pathname === '/api/state') {
        return sendJson(res, 200, {
          snapshot: store.snapshot(),
          cupBatches: store.getCupBatches(),
          revisions: store.getRevisions()
        });
      }

      if (req.method === 'GET' && pathname === '/api/analysis') {
        const method = url.searchParams.get('method') === 'round-adjusted' ? 'round-adjusted' : 'paired';
        return sendJson(res, 200, analyzeAll(store.getScores(), store.getCupBatches(), { method }));
      }

      if (req.method === 'GET' && pathname === '/api/revisions') {
        return sendJson(res, 200, { revisions: store.getRevisions() });
      }

      const revisionMatch = pathname.match(/^\/api\/revisions\/([^/]+)$/);
      if (req.method === 'GET' && revisionMatch) {
        const revision = store.getRevision(decodeURIComponent(revisionMatch[1]));
        if (!revision) throw new NotFoundError(`修订 ${revisionMatch[1]} 不存在`);
        return sendJson(res, 200, revision);
      }

      if (req.method === 'POST' && pathname === '/api/corrections') {
        const body = await readJsonBody(req);
        const revision = store.correctCup(body.cupId, body.newBatchId, body.reason);
        // 修订后立即给出新映射下的完整分析，方便同一次操作内前后核对
        const method = body.method === 'round-adjusted' ? 'round-adjusted' : 'paired';
        return sendJson(res, 201, {
          revision,
          analysisAfter: analyzeAll(store.getScores(), store.getCupBatches(), { method })
        });
      }

      if (req.method === 'POST' && pathname === '/api/reset') {
        const snapshot = store.reset();
        return sendJson(res, 200, { reset: true, snapshot });
      }

      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Not Found');
    } catch (err) {
      if (err instanceof ValidationError) return sendJson(res, 400, { error: err.name, message: err.message });
      if (err instanceof NotFoundError) return sendJson(res, 404, { error: err.name, message: err.message });
      return sendJson(res, 500, { error: 'InternalError', message: err.message });
    }
  });

  return server;
}

// 直接运行本文件时自动启动；被测试或被入口 shim import 时不自动监听。
export function start(port = Number.parseInt(process.env.PORT ?? '3000', 10)) {
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`PORT 环境变量非法：${process.env.PORT}`);
  }
  const server = createServer();
  server.listen(port, '127.0.0.1', () => {
    console.log(`茶叶盲评一致性服务已启动: http://127.0.0.1:${port}（仅本机访问）`);
  });
  return server;
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (invokedPath === fileURLToPath(import.meta.url)) {
  try {
    start();
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}
