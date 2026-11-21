// 兼容入口：按题目要求支持 `node server.js` 启动。
// 实际实现位于 src/server.js（仅使用 Node.js 内置模块）。
import { start } from './src/server.js';

try {
  start();
} catch (err) {
  console.error(err.message);
  process.exit(1);
}
