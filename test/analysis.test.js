import test from 'node:test';
import assert from 'node:assert/strict';
import {
  analyzePaired,
  analyzeRoundAdjusted,
  analyzeBatches,
  analyzeRatings,
  analyzeAll,
  collapseReplicates,
  scoreToGrade,
  iccAbsoluteAgreement,
  modeValue,
  stdPopulation
} from '../src/analysis.js';
import { sampleScores, sampleCupBatches } from '../src/sample-data.js';

// 构造一个“非平衡轮次”数据集：E2 缺席第 2 轮
function unbalancedScores() {
  return sampleScores.filter((r) => !(r.round === 2 && r.evaluatorId === 'E2'));
}

test('scoreToGrade：分数到评级的边界正确', () => {
  assert.equal(scoreToGrade(95), '优');
  assert.equal(scoreToGrade(90), '优');
  assert.equal(scoreToGrade(89), '良');
  assert.equal(scoreToGrade(70), '中');
  assert.equal(scoreToGrade(60), '差');
});

test('折叠重复测量：同杯同评员多轮打分合并为一个观测，不作为独立样本', () => {
  const collapsed = collapseReplicates(sampleScores);
  // 30 条原始记录，杯×评员唯一组合只有 15 个（5 杯 × 3 评员）
  assert.equal(sampleScores.length, 30);
  assert.equal(collapsed.entries.length, 15);
  const c01e1 = collapsed.entries.find((e) => e.cupId === 'C01' && e.evaluatorId === 'E1');
  assert.equal(c01e1.nRounds, 2);
  assert.equal(c01e1.meanScore, 91); // (92+90)/2
  // withinSd 是总体标准差：|92-91| 与 |90-91| => sd=1
  assert.equal(c01e1.withinSd, 1);
});

test('成对偏差：E1 系统性偏高、E2 系统性偏低，且覆盖不足被标记', () => {
  const result = analyzePaired(sampleScores);
  assert.equal(result.method, 'paired');
  assert.equal(result.sufficient, true);
  const e1 = result.evaluatorBiases.find((b) => b.evaluatorId === 'E1');
  const e2 = result.evaluatorBiases.find((b) => b.evaluatorId === 'E2');
  assert.ok(e1.meanBias > 0, 'E1 平均偏差应为正');
  assert.ok(e2.meanBias < 0, 'E2 平均偏差应为负');
  // 覆盖偏低场景：只给 E1 两只杯的数据
  const sparse = sampleScores.filter(
    (r) => r.evaluatorId !== 'E1' || ['C01', 'C02'].includes(r.cupId)
  );
  const sparseResult = analyzePaired(sparse);
  const e1Sparse = sparseResult.evaluatorBiases.find((b) => b.evaluatorId === 'E1');
  assert.equal(e1Sparse.cupsCovered, 2);
  assert.equal(e1Sparse.status, '覆盖偏低');
  assert.ok(e1Sparse.warnings.some((w) => w.includes('谨慎')));
});

test('成对差异：评员两两共同杯、平均差与无共同杯的不足提示', () => {
  const result = analyzePaired(sampleScores);
  const pair = result.pairwise.find((p) => p.evaluatorA === 'E1' && p.evaluatorB === 'E2');
  assert.equal(pair.sharedCups, 5);
  assert.ok(pair.meanDifference > 0);
  // 构造两位评员无共同杯
  const noOverlap = [
    { recordId: 'X1', cupId: 'C01', evaluatorId: 'X1', round: 1, score: 80, grade: '良' },
    { recordId: 'X2', cupId: 'C02', evaluatorId: 'X2', round: 1, score: 81, grade: '良' }
  ];
  const noOverlapResult = analyzePaired(noOverlap);
  const p = noOverlapResult.pairwise[0];
  assert.equal(p.sharedCups, 0);
  assert.equal(p.status, '数据不足');
  assert.match(p.note, /没有共同评过的杯/);
});

test('轮次调整：平衡设计下与成对法结果一致并显式说明', () => {
  const adjusted = analyzeRoundAdjusted(sampleScores);
  const paired = analyzePaired(sampleScores);
  assert.equal(adjusted.balanced, true);
  assert.match(adjusted.note, /平衡设计/);
  for (const b of adjusted.evaluatorBiases) {
    const counterpart = paired.evaluatorBiases.find((x) => x.evaluatorId === b.evaluatorId);
    // 全精度偏差必须严格相等（平衡设计下轮次效应在成对差中抵消）
    assert.ok(
      Math.abs(b.rawMeanBias - counterpart.rawMeanBias) < 1e-12,
      `评员 ${b.evaluatorId} 全精度偏差应严格一致`
    );
    // 展示值（两位小数）因独立取整最多相差 0.01
    assert.ok(Math.abs(b.meanBias - counterpart.meanBias) <= 0.01);
  }
  assert.ok(adjusted.roundEffects.length === 2);
});

test('轮次调整：非平衡设计（E2 缺席第 2 轮）会被识别且结果与成对法不同', () => {
  const data = unbalancedScores();
  const adjusted = analyzeRoundAdjusted(data);
  const paired = analyzePaired(data);
  assert.equal(adjusted.balanced, false);
  assert.match(adjusted.note, /非平衡设计/);
  const e2Adjusted = adjusted.evaluatorBiases.find((b) => b.evaluatorId === 'E2');
  const e2Paired = paired.evaluatorBiases.find((b) => b.evaluatorId === 'E2');
  assert.notEqual(e2Adjusted.meanBias, e2Paired.meanBias);
});

test('批内一致性：杯级 SD、批次汇总与 ICC 正常计算', () => {
  const result = analyzeBatches(sampleScores, sampleCupBatches);
  assert.equal(result.sufficient, true);
  assert.deepEqual(result.unassignedCups, []);
  const b1 = result.batches.find((b) => b.batchId === 'B1');
  const b2 = result.batches.find((b) => b.batchId === 'B2');
  assert.equal(b1.nCups, 3);
  assert.equal(b2.nCups, 2);
  const c01 = b1.cups.find((c) => c.cupId === 'C01');
  // C01 折叠分 91/84/87.5 => 总体标准差
  const expectedSd = stdPopulation([91, 84, 87.5]);
  assert.equal(c01.withinCupSd, Math.round(expectedSd * 100) / 100);
  assert.equal(c01.range, 7);
  assert.ok(b1.icc.icc !== null);
  assert.equal(b1.icc.raters, 3);
  assert.ok(b1.meanWithinCupSd !== null);
});

test('批内一致性：完整配对不足时 ICC 返回 null 并给出原因', () => {
  // E3 只评一只杯 => 三只评员都打分的完整杯只有 1 只；C02 仅 1 位评员
  const scores = [
    { recordId: 'A1', cupId: 'C01', evaluatorId: 'E1', round: 1, score: 90, grade: '优' },
    { recordId: 'A2', cupId: 'C01', evaluatorId: 'E2', round: 1, score: 85, grade: '良' },
    { recordId: 'A3', cupId: 'C01', evaluatorId: 'E3', round: 1, score: 88, grade: '良' },
    { recordId: 'A4', cupId: 'C02', evaluatorId: 'E1', round: 1, score: 78, grade: '中' }
  ];
  const mapping = [
    { cupId: 'C01', batchId: 'B1' },
    { cupId: 'C02', batchId: 'B1' }
  ];
  const result = analyzeBatches(scores, mapping);
  const b1 = result.batches[0];
  assert.equal(b1.icc.icc, null);
  assert.match(b1.icc.reason, /完整配对的杯少于 2/);
  // 单评员的杯标记不足
  const c02 = b1.cups.find((c) => c.cupId === 'C02');
  assert.equal(c02.sufficient, false);
  assert.match(c02.note, /只有 1 位评员/);
});

test('评员重复性：多轮打分的自身波动可计算，无重复时标记数据不足', () => {
  const result = analyzeBatches(sampleScores, sampleCupBatches);
  const b1 = result.batches.find((b) => b.batchId === 'B1');
  const e1 = b1.repeatability.find((r) => r.evaluatorId === 'E1');
  assert.ok(e1.meanWithinEvaluatorSd !== null);
  // 单轮数据：没人有重复测量
  const singleRound = sampleScores.filter((r) => r.round === 1);
  const single = analyzeBatches(singleRound, sampleCupBatches);
  for (const b of single.batches) {
    for (const r of b.repeatability) {
      assert.equal(r.status, '数据不足');
      assert.equal(r.meanWithinEvaluatorSd, null);
    }
  }
});

test('评级一致性：一致率、分歧杯、按批汇总与成对评级一致率', () => {
  const result = analyzeRatings(sampleScores, sampleCupBatches);
  assert.equal(result.sufficient, true);
  const c01 = result.cups.find((c) => c.cupId === 'C01');
  // C01: E1 优, E2 良, E3 良 => 共识 良，一致率 2/3
  assert.equal(c01.consensusGrade, '良');
  assert.equal(c01.agreementRate, 0.67);
  const pair = result.pairwiseGradeAgreement.find(
    (p) => p.evaluatorA === 'E2' && p.evaluatorB === 'E3'
  );
  assert.equal(pair.sharedCups, 5);
  assert.ok(pair.agreementRate >= 0 && pair.agreementRate <= 1);
  const b1 = result.batchSummaries.find((b) => b.batchId === 'B1');
  assert.equal(b1.nCups, 3);
  assert.ok(result.overallAgreementRate !== null);
});

test('评级一致性：同评员两轮评级并列时该评员评级为 null，分歧可被识别', () => {
  const scores = [
    { recordId: 'T1', cupId: 'C01', evaluatorId: 'E1', round: 1, score: 80, grade: '良' },
    { recordId: 'T2', cupId: 'C01', evaluatorId: 'E1', round: 2, score: 70, grade: '中' },
    { recordId: 'T3', cupId: 'C01', evaluatorId: 'E2', round: 1, score: 75, grade: '中' }
  ];
  const result = analyzeRatings(scores, [{ cupId: 'C01', batchId: 'B1' }]);
  const c01 = result.cups[0];
  const e1 = c01.evaluatorGrades.find((g) => g.evaluatorId === 'E1');
  assert.equal(e1.modalGrade, null);
  assert.deepEqual(e1.gradeTies.sort(), ['中', '良']);
});

test('analyzeAll：汇总输出并对重复测量给出显式说明', () => {
  const all = analyzeAll(sampleScores, sampleCupBatches);
  assert.equal(all.rawRecords, 30);
  assert.equal(all.collapsedObservations, 15);
  assert.ok(all.dataWarnings.some((w) => w.includes('折叠为重复测量')));
  assert.ok(all.bias);
  assert.ok(all.paired);
  assert.ok(all.roundAdjusted);
  assert.ok(all.batches);
  assert.ok(all.ratings);
});

test('异常：空数据集返回 sufficient=false 而不是抛错', () => {
  const paired = analyzePaired([]);
  assert.equal(paired.sufficient, false);
  assert.match(paired.reason, /没有任何打分记录/);
  const adjusted = analyzeRoundAdjusted([]);
  assert.equal(adjusted.sufficient, false);
  const ratings = analyzeRatings([], []);
  assert.equal(ratings.sufficient, false);
});

test('异常：非法 score、缺字段、重复杯映射均抛出明确错误', () => {
  assert.throws(() => analyzePaired([{ cupId: 'C01', evaluatorId: 'E1', score: 120 }]), /0~100/);
  assert.throws(() => analyzePaired([{ cupId: '', evaluatorId: 'E1', score: 80 }]), /cupId/);
  assert.throws(() => analyzePaired([{ cupId: 'C01', score: 80 }]), /evaluatorId/);
  assert.throws(() => analyzePaired('not-an-array'), /必须是打分记录数组/);
  assert.throws(
    () => analyzeBatches(sampleScores, [
      { cupId: 'C01', batchId: 'B1' },
      { cupId: 'C01', batchId: 'B2' }
    ]),
    /重复的批号映射/
  );
  assert.throws(
    () => analyzeBatches(sampleScores, [{ cupId: 'C01' }]),
    /缺少 cupId 或 batchId/
  );
});

test('未分配批号的杯被排除并在结果中提示', () => {
  const mapping = sampleCupBatches.filter((m) => m.cupId !== 'C05');
  const result = analyzeBatches(sampleScores, mapping);
  assert.deepEqual(result.unassignedCups, ['C05']);
  assert.match(result.note, /C05/);
  assert.equal(result.batches.find((b) => b.batchId === 'B2').nCups, 1);
});

test('ICC 辅助函数：评员不足或杯不足时返回原因', () => {
  assert.equal(iccAbsoluteAgreement([[80, 90]]).icc, null);
  assert.equal(iccAbsoluteAgreement([[80, 90, 85]]).icc, null);
  const ok = iccAbsoluteAgreement([[80, 82], [90, 88], [70, 72]]);
  assert.ok(ok.icc !== null && ok.icc <= 1 && ok.icc >= -1);
});

test('modeValue：唯一众数与并列众数', () => {
  assert.equal(modeValue(['优', '良', '良']).mode, '良');
  const tied = modeValue(['优', '良']);
  assert.equal(tied.mode, null);
  assert.deepEqual(tied.ties.sort(), ['优', '良']);
});
