import test from 'node:test';
import assert from 'node:assert/strict';
import { Store, ValidationError, NotFoundError } from '../src/store.js';
import { sampleScores, sampleCupBatches } from '../src/sample-data.js';
import { analyzeBatches, analyzeRatings } from '../src/analysis.js';

function newStore() {
  return new Store(sampleScores, sampleCupBatches);
}

test('正常更正：C03 从 B1 改到 B2，映射、修订日志与受影响记录均正确', () => {
  const store = newStore();
  const revision = store.correctCup('C03', 'B2', '匿名杯贴错批号');

  assert.equal(revision.id, 'REV001');
  assert.equal(revision.cupId, 'C03');
  assert.equal(revision.oldBatchId, 'B1');
  assert.equal(revision.newBatchId, 'B2');
  assert.deepEqual(revision.beforeMap, { cupId: 'C03', batchId: 'B1' });
  assert.deepEqual(revision.afterMap, { cupId: 'C03', batchId: 'B2' });

  // C03 上的全部打分（两轮共 6 条）都被列为受影响记录，且内容是快照
  assert.equal(revision.affectedRecordCount, 6);
  assert.deepEqual(revision.affectedRecordIds.sort(), ['R007', 'R008', 'R009', 'R021', 'R022', 'R028']);
  assert.deepEqual(revision.affectedEvaluatorIds, ['E1', 'E2', 'E3']);
  assert.deepEqual(revision.affectedRounds, [1, 2]);
  assert.equal(revision.reason, '匿名杯贴错批号');

  // 当前映射已更新；原始打分记录一条不少
  assert.equal(store.findCup('C03').batchId, 'B2');
  assert.equal(store.getScores().length, sampleScores.length);
  assert.equal(store.getRevisions().length, 1);
});

test('更正前后批次聚合可核对：B1 少一只杯、B2 多一只杯，杯级共识分不变', () => {
  const store = newStore();
  const before = analyzeBatches(store.getScores(), store.getCupBatches());
  const ratingsBefore = analyzeRatings(store.getScores(), store.getCupBatches());

  store.correctCup('C03', 'B2');

  const after = analyzeBatches(store.getScores(), store.getCupBatches());
  const ratingsAfter = analyzeRatings(store.getScores(), store.getCupBatches());

  const b1Before = before.batches.find((b) => b.batchId === 'B1');
  const b1After = after.batches.find((b) => b.batchId === 'B1');
  const b2Before = before.batches.find((b) => b.batchId === 'B2');
  const b2After = after.batches.find((b) => b.batchId === 'B2');
  assert.equal(b1Before.nCups, 3);
  assert.equal(b1After.nCups, 2);
  assert.equal(b2Before.nCups, 2);
  assert.equal(b2After.nCups, 3);

  // 杯本身的共识分不随批号变化（评分未改）
  const c03Before = b1Before.cups.find((c) => c.cupId === 'C03');
  const c03After = b2After.cups.find((c) => c.cupId === 'C03');
  assert.equal(c03Before.consensus, c03After.consensus);

  // 评级里 C03 的批号归属发生变化
  const rBefore = ratingsBefore.cups.find((c) => c.cupId === 'C03');
  const rAfter = ratingsAfter.cups.find((c) => c.cupId === 'C03');
  assert.equal(rBefore.batchId, 'B1');
  assert.equal(rAfter.batchId, 'B2');
  assert.equal(rBefore.consensusGrade, rAfter.consensusGrade);
});

test('多次更正：修订序号递增、日志完整、可逐条取回快照', () => {
  const store = newStore();
  const r1 = store.correctCup('C03', 'B2');
  const r2 = store.correctCup('C03', 'B1', '核查后改回');
  assert.equal(r1.id, 'REV001');
  assert.equal(r2.id, 'REV002');
  assert.equal(r2.oldBatchId, 'B2');
  assert.equal(r2.newBatchId, 'B1');
  assert.equal(store.findCup('C03').batchId, 'B1');
  const fetched = store.getRevision('REV001');
  assert.equal(fetched.newBatchId, 'B2');
  assert.equal(store.getRevision('NOPE'), null);
});

test('异常：更正不存在的杯抛 NotFoundError', () => {
  const store = newStore();
  assert.throws(() => store.correctCup('C99', 'B2'), (err) => {
    assert.ok(err instanceof NotFoundError);
    assert.equal(err.statusCode, 404);
    return true;
  });
});

test('异常：空 cupId / 空批号抛 ValidationError', () => {
  const store = newStore();
  assert.throws(() => store.correctCup('', 'B2'), (err) => err instanceof ValidationError);
  assert.throws(() => store.correctCup('C03', ''), (err) => err instanceof ValidationError);
  assert.throws(() => store.correctCup('   ', 'B2'), (err) => err instanceof ValidationError);
});

test('异常：更正为当前批号（无变化）被拒绝', () => {
  const store = newStore();
  assert.throws(() => store.correctCup('C03', 'B1'), /无需更正/);
  assert.equal(store.getRevisions().length, 0);
});

test('reset：恢复初始映射并清空修订日志，原始数据不变', () => {
  const store = newStore();
  store.correctCup('C03', 'B2');
  const snapshot = store.reset();
  assert.equal(store.findCup('C03').batchId, 'B1');
  assert.equal(store.getRevisions().length, 0);
  assert.equal(store.getScores().length, sampleScores.length);
  assert.equal(snapshot.revisionCount, 0);
  assert.equal(snapshot.cupBatches.find((c) => c.cupId === 'C03').batchId, 'B1');
});

test('隔离性：getter 与更正返回的是副本，外部修改不污染存储', () => {
  const store = newStore();
  const revision = store.correctCup('C03', 'B2');
  revision.affectedRecords[0].score = 1;
  const again = store.getRevision('REV001');
  assert.notEqual(again.affectedRecords[0].score, 1);

  const mapping = store.getCupBatches();
  mapping[0].batchId = 'HACK';
  assert.notEqual(store.getCupBatches()[0].batchId, 'HACK');
});
