// 盲评数据分析核心：全部为纯函数，不依赖任何第三方模块。
//
// 关键统计原则（对应题目要求）：
// 1. 同一只杯、同一位评员在多个盲评轮次的打分属于“重复测量”，
//    分析前先按 (cupId, evaluatorId) 折叠成一个观测（取轮次均值），
//    不把重复打分当作相互独立的样本。
// 2. 评员个人偏差：用成对分数（同一杯上评员分数相对杯共识的差）计算；
//    也提供按盲评轮次调整后的版本（扣除每轮轮次效应）。
// 3. 批内一致性：按杯→批号归组后计算杯内标准差/极差、ICC(A,1)、
//    评员重复性（同一评员多轮打分的自身波动）。
// 4. 样本不足（覆盖杯数少、共同杯为 0、完整配对不足等）一律显式标出，
//    不强行输出一个看似精确实则无意义的指标。

export const GRADE_BOUNDARIES = [
  { grade: '优', min: 90 },
  { grade: '良', min: 80 },
  { grade: '中', min: 70 },
  { grade: '差', min: 0 }
];

export function scoreToGrade(score) {
  if (typeof score !== 'number' || Number.isNaN(score)) return null;
  for (const { grade, min } of GRADE_BOUNDARIES) {
    if (score >= min) return grade;
  }
  return '差';
}

export function round2(x) {
  if (x === null || x === undefined || Number.isNaN(x)) return null;
  return Math.round(x * 100) / 100;
}

export function mean(values) {
  if (!values.length) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

// 总体标准差（除以 N）；样本不足 2 个时返回 null。
export function stdPopulation(values) {
  if (values.length < 2) return null;
  const m = mean(values);
  const variance = values.reduce((acc, v) => acc + (v - m) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

function validateScores(scores) {
  if (!Array.isArray(scores)) {
    throw new TypeError('scores 必须是打分记录数组');
  }
  scores.forEach((r, i) => {
    if (r === null || typeof r !== 'object') {
      throw new TypeError(`第 ${i} 条打分记录不是对象`);
    }
    if (typeof r.cupId !== 'string' || !r.cupId) {
      throw new TypeError(`第 ${i} 条记录缺少有效的 cupId`);
    }
    if (typeof r.evaluatorId !== 'string' || !r.evaluatorId) {
      throw new TypeError(`第 ${i} 条记录缺少有效的 evaluatorId`);
    }
    if (typeof r.score !== 'number' || Number.isNaN(r.score) || r.score < 0 || r.score > 100) {
      throw new TypeError(`记录 ${r.recordId ?? i} 的 score 必须是 0~100 的数字`);
    }
    if (r.round !== undefined && (!Number.isInteger(r.round) || r.round < 1)) {
      throw new TypeError(`记录 ${r.recordId ?? i} 的 round 必须是 >=1 的整数`);
    }
  });
}

function gradeOf(record) {
  return typeof record.grade === 'string' && record.grade ? record.grade : scoreToGrade(record.score);
}

/**
 * 折叠重复测量：key = 杯 + 评员。
 * 返回 { entries: [...], byKey: Map, cupIds, evaluatorIds }
 */
export function collapseReplicates(scores) {
  validateScores(scores);
  const byKey = new Map();
  for (const r of scores) {
    const key = `${r.cupId}||${r.evaluatorId}`;
    if (!byKey.has(key)) {
      byKey.set(key, {
        cupId: r.cupId,
        evaluatorId: r.evaluatorId,
        scores: [],
        grades: [],
        rounds: [],
        recordIds: []
      });
    }
    const entry = byKey.get(key);
    entry.scores.push(r.score);
    entry.grades.push(gradeOf(r));
    entry.rounds.push(r.round ?? 1);
    entry.recordIds.push(r.recordId ?? null);
  }
  // 内部统计一律使用 rawMean（全精度）；meanScore 仅为对外展示的两位小数视图，
  // 保证“成对法”和“轮次调整法”在平衡设计下经过同一套全精度运算，结果严格一致。
  const entries = [...byKey.values()].map((e) => {
    const raw = mean(e.scores);
    return {
      cupId: e.cupId,
      evaluatorId: e.evaluatorId,
      nRounds: e.scores.length,
      meanScore: round2(raw),
      rawMean: raw,
      withinSd: round2(stdPopulation(e.scores)), // 同一评员对同一杯的重复性
      rounds: [...e.rounds].sort((a, b) => a - b),
      grades: e.grades,
      modalGrade: modeValue(e.grades).mode,
      recordIds: e.recordIds
    };
  });
  return {
    entries,
    byKey,
    cupIds: [...new Set(entries.map((e) => e.cupId))].sort(),
    evaluatorIds: [...new Set(entries.map((e) => e.evaluatorId))].sort()
  };
}

/** 众数；出现并列时 mode 为 null，ties 列出并列值。 */
export function modeValue(values) {
  const counts = new Map();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  let max = 0;
  for (const c of counts.values()) max = Math.max(max, c);
  const winners = [...counts.entries()].filter(([, c]) => c === max).map(([v]) => v);
  return {
    mode: winners.length === 1 ? winners[0] : null,
    count: max,
    ties: winners.length > 1 ? winners : [],
    counts: Object.fromEntries(counts)
  };
}

function entriesByCup(entries) {
  const map = new Map();
  for (const e of entries) {
    if (!map.has(e.cupId)) map.set(e.cupId, []);
    map.get(e.cupId).push(e);
  }
  return map;
}

/** 每只杯的共识分（杯上各评员折叠后分数的均值）与评员偏差。 */
function cupConsensus(cupEntries) {
  const rawScores = cupEntries.map((e) => e.rawMean ?? e.meanScore);
  const consensusRaw = mean(rawScores);
  return {
    consensus: round2(consensusRaw),
    evaluatorDeltas: cupEntries.map((e) => ({
      evaluatorId: e.evaluatorId,
      meanScore: e.meanScore,
      delta: round2((e.rawMean ?? e.meanScore) - consensusRaw),
      nRounds: e.nRounds
    }))
  };
}

function buildBiasStats(entries, cupCount, label = '成对分数') {
  const byEvaluator = new Map();
  for (const e of entries) {
    if (!byEvaluator.has(e.evaluatorId)) byEvaluator.set(e.evaluatorId, []);
    byEvaluator.get(e.evaluatorId).push(e);
  }
  const evaluatorIds = [...byEvaluator.keys()].sort();
  const biases = evaluatorIds.map((evaluatorId) => {
    const own = byEvaluator.get(evaluatorId);
    const deltas = [];
    const absDeltas = [];
    for (const e of own) {
      const cupEntries = entries.filter((x) => x.cupId === e.cupId);
      const consensusRaw = mean(cupEntries.map((x) => x.rawMean ?? x.meanScore));
      const d = (e.rawMean ?? e.meanScore) - consensusRaw;
      deltas.push(d);
      absDeltas.push(Math.abs(d));
    }
    const cupsCovered = own.length;
    const coverage = cupCount === 0 ? null : round2(cupsCovered / cupCount);
    const minCovered = Math.ceil(cupCount / 2);
    let status = 'ok';
    const warnings = [];
    if (cupsCovered === 0) {
      status = '数据不足';
      warnings.push('该评员没有任何打分记录');
    } else if (cupsCovered < minCovered) {
      status = '覆盖偏低';
      warnings.push(`仅覆盖 ${cupsCovered}/${cupCount} 只杯，不足半数，偏差结论需谨慎`);
    }
    if (cupsCovered < 3 && cupsCovered > 0) {
      warnings.push('成对样本少于 3 只杯，个体偏差参考价值有限');
    }
    return {
      evaluatorId,
      method: label,
      cupsCovered,
      cupsTotal: cupCount,
      coverage,
      meanBias: round2(mean(deltas)),
      rawMeanBias: mean(deltas), // 全精度值：用于平衡设计下两种方法的严格等价校验
      meanAbsBias: round2(mean(absDeltas)),
      maxAbsBias: round2(Math.max(...absDeltas)),
      totalRounds: own.reduce((acc, e) => acc + e.nRounds, 0),
      status,
      warnings
    };  });
  return biases;
}

function buildPairwise(entries) {
  const evaluatorIds = [...new Set(entries.map((e) => e.evaluatorId))].sort();
  const pairs = [];
  for (let i = 0; i < evaluatorIds.length; i += 1) {
    for (let j = i + 1; j < evaluatorIds.length; j += 1) {
      const a = evaluatorIds[i];
      const b = evaluatorIds[j];
      const sharedCupIds = [];
      const diffs = [];
      const absDiffs = [];
      for (const cupId of new Set(entries.map((e) => e.cupId))) {
        const ea = entries.find((e) => e.cupId === cupId && e.evaluatorId === a);
        const eb = entries.find((e) => e.cupId === cupId && e.evaluatorId === b);
        if (ea && eb) {
          sharedCupIds.push(cupId);
          const d = (ea.rawMean ?? ea.meanScore) - (eb.rawMean ?? eb.meanScore);
          diffs.push(d);
          absDiffs.push(Math.abs(d));
        }
      }
      if (sharedCupIds.length === 0) {
        pairs.push({
          evaluatorA: a,
          evaluatorB: b,
          sharedCups: 0,
          status: '数据不足',
          note: '两位评员没有共同评过的杯，无法比较'
        });
      } else {
        pairs.push({
          evaluatorA: a,
          evaluatorB: b,
          sharedCups: sharedCupIds.length,
          sharedCupIds,
          meanDifference: round2(mean(diffs)), // A 相对 B 的平均差
          meanAbsDifference: round2(mean(absDiffs)),
          maxAbsDifference: round2(Math.max(...absDiffs)),
          status: sharedCupIds.length < 3 ? '覆盖偏低' : 'ok',
          note:
            sharedCupIds.length < 3
              ? '共同杯少于 3 只，成对差异参考价值有限'
              : null
        });
      }
    }
  }
  return pairs;
}

/**
 * 方式一：成对分数分析。
 * 偏差 = 评员在某杯上的折叠分 − 该杯共识分，再对杯取平均。
 */
export function analyzePaired(scores) {
  validateScores(scores);
  const collapsed = collapseReplicates(scores);
  if (collapsed.entries.length === 0) {
    return {
      method: 'paired',
      sufficient: false,
      reason: '没有任何打分记录，无法计算评员偏差',
      evaluatorBiases: [],
      pairwise: [],
      cupConsensus: []
    };
  }
  const byCup = entriesByCup(collapsed.entries);
  const cupConsensusList = [...byCup.entries()]
    .map(([cupId, cupEntries]) => ({
      cupId,
      nEvaluators: cupEntries.length,
      ...cupConsensus(cupEntries)
    }))
    .sort((a, b) => a.cupId.localeCompare(b.cupId));

  return {
    method: 'paired',
    sufficient: true,
    collapsedObservations: collapsed.entries.length,
    rawRecords: scores.length,
    evaluatorBiases: buildBiasStats(collapsed.entries, collapsed.cupIds.length, '成对分数'),
    pairwise: buildPairwise(collapsed.entries),
    cupConsensus: cupConsensusList
  };
}

/**
 * 方式二：按盲评轮次调整。
 * adjusted = score + (总均值 − 该轮均值)，先扣轮次效应，再折叠、再算偏差。
 * 若每位评员在每一轮都参与（平衡设计），轮次效应在成对差中自动抵消，
 * 调整结果与成对法一致，返回结果中会显式说明这一点。
 */
export function analyzeRoundAdjusted(scores) {
  validateScores(scores);
  if (scores.length === 0) {
    return {
      method: 'round-adjusted',
      sufficient: false,
      reason: '没有任何打分记录，无法进行轮次调整',
      roundEffects: [],
      evaluatorBiases: [],
      balanced: null
    };
  }
  const rounds = [...new Set(scores.map((r) => r.round ?? 1))].sort((a, b) => a - b);
  const evaluatorIds = [...new Set(scores.map((r) => r.evaluatorId))].sort();
  const grandMean = mean(scores.map((r) => r.score));
  const roundEffects = rounds.map((round) => {
    const rs = scores.filter((r) => (r.round ?? 1) === round);
    return {
      round,
      nRecords: rs.length,
      roundMean: round2(mean(rs.map((r) => r.score))),
      effect: round2(mean(rs.map((r) => r.score)) - grandMean)
    };
  });
  const roundMeanOf = new Map(roundEffects.map((x) => [x.round, mean(scores.filter((r) => (r.round ?? 1) === x.round).map((r) => r.score))]));
  const evaluatorRounds = new Map(evaluatorIds.map((id) => [id, new Set()]));
  // 调整过程保留全精度，仅在最终输出时四舍五入，保证平衡设计下与成对法严格一致
  const adjustedRecords = scores.map((r) => {
    const round = r.round ?? 1;
    evaluatorRounds.get(r.evaluatorId)?.add(round);
    return { ...r, score: r.score + (grandMean - roundMeanOf.get(round)) };
  });
  const participation = evaluatorIds.map((id) => ({
    evaluatorId: id,
    rounds: [...evaluatorRounds.get(id)].sort((a, b) => a - b)
  }));
  // 真正的平衡设计要求每个“杯×评员”组合在每一轮都有打分；
  // 仅出席过每一轮但在某些杯上缺轮，轮次效应仍不会在成对差中完全抵消。
  const collapsedRaw = collapseReplicates(scores);
  const balanced = collapsedRaw.entries.every((e) =>
    rounds.every((round) => e.rounds.includes(round))
  );

  const collapsed = collapseReplicates(adjustedRecords);
  const result = {
    method: 'round-adjusted',
    sufficient: true,
    balanced,
    rounds,
    roundEffects,
    participation,
    collapsedObservations: collapsed.entries.length,
    evaluatorBiases: buildBiasStats(collapsed.entries, collapsed.cupIds.length, '轮次调整'),
    cupConsensus: [...entriesByCup(collapsed.entries).entries()]
      .map(([cupId, cupEntries]) => ({
        cupId,
        nEvaluators: cupEntries.length,
        ...cupConsensus(cupEntries)
      }))
      .sort((a, b) => a.cupId.localeCompare(b.cupId)),
    note: balanced
      ? '各评员在每一轮均有打分（平衡设计），轮次效应在成对差中抵消，调整后偏差与成对法一致'
      : '存在评员缺席某些轮次（非平衡设计），已按轮次均值扣除轮次效应后再比较'
  };
  return result;
}

/**
 * ICC(A,1)：双向随机、绝对一致、单评员信度。
 * 只用“完整配对”的杯（该批所有评员都打过分的杯）。
 * 完整杯 <2 或评员 <2 时返回 null 并说明原因。
 */
export function iccAbsoluteAgreement(matrix, raterCount = matrix[0]?.length ?? 0) {
  const n = matrix.length;
  const k = raterCount;
  if (k < 2) return { icc: null, reason: '评员少于 2 人，无法计算 ICC' };
  if (n < 2) return { icc: null, reason: '完整配对的杯少于 2 只，无法计算 ICC' };
  const all = matrix.flat();
  const grand = mean(all);
  const subjectMeans = matrix.map((row) => mean(row));
  const raterMeans = Array.from({ length: k }, (_, j) => mean(matrix.map((row) => row[j])));
  const ssr = k * subjectMeans.reduce((acc, m) => acc + (m - grand) ** 2, 0);
  const ssc = n * raterMeans.reduce((acc, m) => acc + (m - grand) ** 2, 0);
  let sse = 0;
  for (let i = 0; i < n; i += 1) {
    for (let j = 0; j < k; j += 1) {
      sse += (matrix[i][j] - subjectMeans[i] - raterMeans[j] + grand) ** 2;
    }
  }
  const msr = ssr / (n - 1);
  const msc = ssc / (k - 1);
  const mse = sse / ((n - 1) * (k - 1));
  const icc = (msr - mse) / (msr + (k - 1) * mse + (k * (msc - mse)) / n);
  return {
    icc: round2(icc),
    completeCups: n,
    raters: k,
    msr: round2(msr),
    msc: round2(msc),
    mse: round2(mse)
  };
}

function validateCupBatches(cupBatches) {
  if (!Array.isArray(cupBatches)) throw new TypeError('cupBatches 必须是数组');
  const seen = new Set();
  cupBatches.forEach((m, i) => {
    if (m === null || typeof m !== 'object' || !m.cupId || !m.batchId) {
      throw new TypeError(`第 ${i} 条杯批映射缺少 cupId 或 batchId`);
    }
    if (seen.has(m.cupId)) throw new TypeError(`杯 ${m.cupId} 存在重复的批号映射`);
    seen.add(m.cupId);
  });
}

/**
 * 批内一致性：按“杯→批号”归组。
 * 杯级：共识分、杯内 SD/极差、评级一致情况；
 * 批级：平均杯内 SD、ICC(A,1)、评员重复性（多轮自身波动）。
 */
export function analyzeBatches(scores, cupBatches) {
  validateScores(scores);
  validateCupBatches(cupBatches);
  const collapsed = collapseReplicates(scores);
  const batchOf = new Map(cupBatches.map((m) => [m.cupId, m.batchId]));
  const unassignedCups = collapsed.cupIds.filter((c) => !batchOf.has(c));
  const byCup = entriesByCup(collapsed.entries);

  const batches = new Map();
  for (const [cupId, cupEntries] of byCup) {
    const batchId = batchOf.get(cupId);
    if (!batchId) continue;
    if (!batches.has(batchId)) batches.set(batchId, []);
    batches.get(batchId).push([cupId, cupEntries]);
  }

  const batchResults = [...batches.entries()].map(([batchId, cups]) => {
    const cupStats = cups.map(([cupId, cupEntries]) => {
      const rawScores = cupEntries.map((e) => e.rawMean ?? e.meanScore);
      const gradeModes = cupEntries.map((e) => e.modalGrade).filter((g) => g !== null);
      const gradeMode = modeValue(gradeModes);
      const nEvaluators = cupEntries.length;
      const nAgree = gradeMode.mode === null ? null : gradeModes.filter((g) => g === gradeMode.mode).length;
      return {
        cupId,
        nEvaluators,
        nRawRecords: cupEntries.reduce((acc, e) => acc + e.nRounds, 0),
        consensus: round2(mean(rawScores)),
        withinCupSd: round2(stdPopulation(rawScores)),
        range: round2(Math.max(...rawScores) - Math.min(...rawScores)),
        minScore: round2(Math.min(...rawScores)),
        maxScore: round2(Math.max(...rawScores)),
        evaluatorDeltas: cupConsensus(cupEntries).evaluatorDeltas,
        modalGrade: gradeMode.mode,
        gradeTies: gradeMode.ties,
        gradeCounts: gradeMode.counts,
        gradeAgreementRate: nAgree === null ? null : round2(nAgree / nEvaluators),
        sufficient: nEvaluators >= 2,
        note: nEvaluators < 2 ? '该杯只有 1 位评员打分，无法判断杯内一致性' : null
      };
    }).sort((a, b) => a.cupId.localeCompare(b.cupId));

    const evaluatorIds = [...new Set(cups.flatMap(([, ce]) => ce.map((e) => e.evaluatorId)))].sort();
    // ICC：只取该批所有评员均打分的完整杯；评员数按该批总人数计，
    // 避免“缺席评员被悄悄排除”导致分母错误
    const completeMatrix = cups
      .map(([, ce]) => {
        const row = evaluatorIds.map((ev) => ce.find((e) => e.evaluatorId === ev)?.meanScore ?? null);
        return row.every((v) => v !== null) ? row : null;
      })
      .filter(Boolean);
    const icc = iccAbsoluteAgreement(completeMatrix, evaluatorIds.length);

    // 评员重复性：同一评员对同一杯多轮打分的 withinSd，再对杯取平均
    const repeatability = evaluatorIds.map((ev) => {
      const own = cups.flatMap(([, ce]) => ce).filter((e) => e.evaluatorId === ev);
      const repeatable = own.filter((e) => e.nRounds >= 2);
      const sds = repeatable.map((e) => e.withinSd);
      return {
        evaluatorId: ev,
        cupsScored: own.length,
        repeatableCups: repeatable.length,
        meanWithinEvaluatorSd: sds.length ? round2(mean(sds)) : null,
        status: sds.length === 0 ? '数据不足' : 'ok',
        note: sds.length === 0 ? '该评员在本批没有任何多轮重复打分，无法评估重复性' : null
      };
    });
    const validSds = repeatability.map((r) => r.meanWithinEvaluatorSd).filter((v) => v !== null);
    const cupSds = cupStats.map((c) => c.withinCupSd).filter((v) => v !== null);

    const warnings = [];
    if (cups.length < 2) warnings.push(`批次 ${batchId} 只有 ${cups.length} 只杯，批级汇总指标样本不足`);
    if (icc.icc === null) warnings.push(`批次 ${batchId}：${icc.reason}`);

    return {
      batchId,
      nCups: cups.length,
      nEvaluators: evaluatorIds.length,
      evaluatorIds,
      meanConsensus: round2(mean(cupStats.map((c) => c.consensus))),
      meanWithinCupSd: cupSds.length ? round2(mean(cupSds)) : null,
      meanCupRange: round2(mean(cupStats.map((c) => c.range))),
      icc,
      repeatability,
      overallRepeatability: validSds.length ? round2(mean(validSds)) : null,
      cups: cupStats,
      warnings
    };
  }).sort((a, b) => a.batchId.localeCompare(b.batchId));

  return {
    method: 'batch-consistency',
    sufficient: batchResults.length > 0,
    unassignedCups,
    batches: batchResults,
    note: unassignedCups.length
      ? `以下杯在杯批映射中缺失，已排除在批次分析外：${unassignedCups.join('、')}`
      : null
  };
}

/**
 * 评级一致性：以“评员对一只杯的折叠后众数评级”为该评员的评级。
 * 杯级共识评级出现并列时记为分歧（consensusGrade = null）。
 */
export function analyzeRatings(scores, cupBatches) {
  validateScores(scores);
  validateCupBatches(cupBatches);
  const collapsed = collapseReplicates(scores);
  const batchOf = new Map(cupBatches.map((m) => [m.cupId, m.batchId]));
  const byCup = entriesByCup(collapsed.entries);

  const cupResults = [...byCup.entries()].map(([cupId, cupEntries]) => {
    const evalGrades = cupEntries.map((e) => ({
      evaluatorId: e.evaluatorId,
      modalGrade: e.modalGrade,
      gradeTies: modeValue(e.grades).ties,
      nRounds: e.nRounds
    }));
    const usable = evalGrades.filter((x) => x.modalGrade !== null).map((x) => x.modalGrade);
    const mode = modeValue(usable);
    const nEvaluators = evalGrades.length;
    const nAgree = mode.mode === null ? 0 : mode.count;
    return {
      cupId,
      batchId: batchOf.get(cupId) ?? null,
      nEvaluators,
      evaluatorGrades: evalGrades,
      consensusGrade: mode.mode,
      gradeTies: mode.ties,
      gradeCounts: mode.counts,
      nAgree,
      agreementRate: nEvaluators ? round2(nAgree / nEvaluators) : null,
      sufficient: nEvaluators >= 2,
      note: nEvaluators < 2 ? '仅 1 位评员，无法判断评级一致性' : null
    };
  }).sort((a, b) => a.cupId.localeCompare(b.cupId));

  // 评员间成对评级一致率
  const evaluatorIds = collapsed.evaluatorIds;
  const pairwiseGradeAgreement = [];
  for (let i = 0; i < evaluatorIds.length; i += 1) {
    for (let j = i + 1; j < evaluatorIds.length; j += 1) {
      const a = evaluatorIds[i];
      const b = evaluatorIds[j];
      let shared = 0;
      let agree = 0;
      for (const cupId of collapsed.cupIds) {
        const ga = collapsed.entries.find((e) => e.cupId === cupId && e.evaluatorId === a)?.modalGrade;
        const gb = collapsed.entries.find((e) => e.cupId === cupId && e.evaluatorId === b)?.modalGrade;
        if (ga && gb) {
          shared += 1;
          if (ga === gb) agree += 1;
        }
      }
      pairwiseGradeAgreement.push(
        shared === 0
          ? { evaluatorA: a, evaluatorB: b, sharedCups: 0, agreementRate: null, status: '数据不足', note: '无共同杯' }
          : {
              evaluatorA: a,
              evaluatorB: b,
              sharedCups: shared,
              agreementRate: round2(agree / shared),
              status: shared < 3 ? '覆盖偏低' : 'ok'
            }
      );
    }
  }

  // 按批汇总
  const batchSummaries = [];
  const batchIds = [...new Set(cupResults.map((c) => c.batchId).filter(Boolean))].sort();
  for (const batchId of batchIds) {
    const cups = cupResults.filter((c) => c.batchId === batchId);
    const rates = cups.map((c) => c.agreementRate).filter((v) => v !== null);
    const unanimous = cups.filter((c) => c.agreementRate === 1).length;
    const split = cups.filter((c) => c.consensusGrade === null).length;
    batchSummaries.push({
      batchId,
      nCups: cups.length,
      meanAgreementRate: rates.length ? round2(mean(rates)) : null,
      unanimousCups: unanimous,
      splitCups: split,
      sufficient: cups.length > 0,
      note: cups.length === 0 ? '批次下没有可分析的杯' : null
    });
  }

  const allRates = cupResults.map((c) => c.agreementRate).filter((v) => v !== null);
  return {
    method: 'rating-agreement',
    sufficient: cupResults.length > 0,
    overallAgreementRate: allRates.length ? round2(mean(allRates)) : null,
    unanimousCups: cupResults.filter((c) => c.agreementRate === 1).length,
    splitCups: cupResults.filter((c) => c.consensusGrade === null).length,
    totalCups: cupResults.length,
    pairwiseGradeAgreement,
    batchSummaries,
    cups: cupResults
  };
}

/** 一次产出全部分析；method 选择偏差分析展示哪一种。 */
export function analyzeAll(scores, cupBatches, options = {}) {
  const method = options.method === 'round-adjusted' ? 'round-adjusted' : 'paired';
  const paired = analyzePaired(scores);
  const roundAdjusted = analyzeRoundAdjusted(scores);
  const batches = analyzeBatches(scores, cupBatches);
  const ratings = analyzeRatings(scores, cupBatches);
  const dataWarnings = [];
  if (batches.unassignedCups.length) dataWarnings.push(batches.note);
  const duplicateCount = scores.length - collapseReplicates(scores).entries.length;
  if (duplicateCount > 0) {
    dataWarnings.push(`存在 ${duplicateCount} 条同杯同评员的多轮重复打分，已按 (杯,评员) 折叠为重复测量，不作为独立样本`);
  }
  return {
    generatedAt: new Date().toISOString(),
    method,
    rawRecords: scores.length,
    collapsedObservations: collapseReplicates(scores).entries.length,
    cupsTotal: collapseReplicates(scores).cupIds.length,
    evaluatorsTotal: collapseReplicates(scores).evaluatorIds.length,
    bias: method === 'round-adjusted' ? roundAdjusted : paired,
    paired,
    roundAdjusted,
    batches,
    ratings,
    dataWarnings
  };
}
