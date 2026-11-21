import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from '../src/server.js';
import { Store } from '../src/store.js';
import { sampleScores, sampleCupBatches } from '../src/sample-data.js';

// 端到端：真实起 HTTP 服务（随机端口），走 fetch 验证完整业务链路。
function startServer() {
  const server = createServer(new Store(sampleScores, sampleCupBatches));
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({ server, base: `http://127.0.0.1:${port}` });
    });
  });
}

test('静态页面与脚本可访问，页面含 data-evidence-result 业务结果区', async () => {
  const { server, base } = await startServer();
  try {
    const html = await (await fetch(`${base}/`)).text();
    assert.match(html, /茶叶盲评一致性分析/);
    assert.match(html, /data-evidence-result="bias"/);
    assert.match(html, /data-evidence-result="batch-consistency"/);
    assert.match(html, /data-evidence-result="rating-agreement"/);
    assert.match(html, /data-evidence-result="correction"/);
    assert.match(html, /data-evidence-result="revision-badge"/);
    const js = await fetch(`${base}/app.js`);
    assert.equal(js.status, 200);
    const css = await fetch(`${base}/styles.css`);
    assert.equal(css.status, 200);
  } finally {
    server.close();
  }
});

test('GET /api/analysis 返回完整分析且重复测量已折叠', async () => {
  const { server, base } = await startServer();
  try {
    const res = await fetch(`${base}/api/analysis?method=paired`);
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.rawRecords, 30);
    assert.equal(data.collapsedObservations, 15);
    assert.equal(data.batches.batches.find((b) => b.batchId === 'B1').nCups, 3);
    assert.ok(data.dataWarnings.some((w) => w.includes('不作为独立样本')));

    const adjusted = await (await fetch(`${base}/api/analysis?method=round-adjusted`)).json();
    assert.equal(adjusted.method, 'round-adjusted');
    assert.equal(adjusted.roundAdjusted.balanced, true);
  } finally {
    server.close();
  }
});

test('完整业务链路：分析 → 更正样杯（前后结果可核对）→ 评级一致性 → 重置', async () => {
  const { server, base } = await startServer();
  try {
    // ① 分析原盲评数据
    const before = await (await fetch(`${base}/api/analysis`)).json();
    const b1Before = before.batches.batches.find((b) => b.batchId === 'B1');
    const b2Before = before.batches.batches.find((b) => b.batchId === 'B2');
    assert.equal(b1Before.nCups, 3);
    assert.equal(b2Before.nCups, 2);

    // ② 更正一只样杯
    const corrRes = await fetch(`${base}/api/corrections`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cupId: 'C03', newBatchId: 'B2', reason: '贴错批号' })
    });
    assert.equal(corrRes.status, 201);
    const correction = await corrRes.json();
    assert.equal(correction.revision.oldBatchId, 'B1');
    assert.equal(correction.revision.newBatchId, 'B2');
    assert.equal(correction.revision.affectedRecordCount, 6);
    // 响应内直接带修订后分析，保证同一次操作可核对
    assert.equal(correction.analysisAfter.batches.batches.find((b) => b.batchId === 'B1').nCups, 2);
    assert.equal(correction.analysisAfter.batches.batches.find((b) => b.batchId === 'B2').nCups, 3);

    // 状态与修订日志
    const state = await (await fetch(`${base}/api/state`)).json();
    assert.equal(state.snapshot.revisionCount, 1);
    assert.equal(state.cupBatches.find((c) => c.cupId === 'C03').batchId, 'B2');
    const revisionDetail = await (await fetch(`${base}/api/revisions/REV001`)).json();
    assert.equal(revisionDetail.id, 'REV001');

    // ③ 查看评级一致性（修订后）
    const ratingsRes = await fetch(`${base}/api/analysis`);
    const after = await ratingsRes.json();
    const c03 = after.ratings.cups.find((c) => c.cupId === 'C03');
    assert.equal(c03.batchId, 'B2');
    assert.ok(after.ratings.overallAgreementRate !== null);

    // 重置回到初始样例
    const resetRes = await fetch(`${base}/api/reset`, { method: 'POST' });
    assert.equal(resetRes.status, 200);
    const resetState = await (await fetch(`${base}/api/state`)).json();
    assert.equal(resetState.snapshot.revisionCount, 0);
    assert.equal(resetState.cupBatches.find((c) => c.cupId === 'C03').batchId, 'B1');
  } finally {
    server.close();
  }
});

test('异常 API：不存在的杯 404、同批号更正 400、非法 JSON 400、未知路由 404', async () => {
  const { server, base } = await startServer();
  try {
    const notFound = await fetch(`${base}/api/corrections`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cupId: 'C99', newBatchId: 'B2' })
    });
    assert.equal(notFound.status, 404);
    assert.match((await notFound.json()).message, /不存在/);

    const noChange = await fetch(`${base}/api/corrections`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cupId: 'C01', newBatchId: 'B1' })
    });
    assert.equal(noChange.status, 400);
    assert.match((await noChange.json()).message, /无需更正/);

    const missingField = await fetch(`${base}/api/corrections`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cupId: 'C01' })
    });
    assert.equal(missingField.status, 400);

    const badJson = await fetch(`${base}/api/corrections`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{not-json'
    });
    assert.equal(badJson.status, 400);

    const unknownRoute = await fetch(`${base}/api/nope`);
    assert.equal(unknownRoute.status, 404);
  } finally {
    server.close();
  }
});

test('路径穿越防护：/../ 无法读取 public 之外的文件', async () => {
  const { server, base } = await startServer();
  try {
    const res = await fetch(`${base}/..%2fsrc%2fserver.js`);
    assert.notEqual(res.status, 200);
    const res2 = await fetch(`${base}/%2e%2e/src/sample-data.js`);
    assert.notEqual(res2.status, 200);
  } finally {
    server.close();
  }
});
