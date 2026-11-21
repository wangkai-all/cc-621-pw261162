// 内存数据存储：杯→批映射、打分记录、修订日志。
// 更正一只样杯的批号时：
//   - 旧映射与受影响的打分记录完整快照到修订日志（可对照修订前后）；
//   - 不删除任何原始打分记录，只改杯→批映射，保证重复测量结构不被破坏；
//   - 支持 reset 回到初始样例。

export class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ValidationError';
    this.statusCode = 400;
  }
}

export class NotFoundError extends Error {
  constructor(message) {
    super(message);
    this.name = 'NotFoundError';
    this.statusCode = 404;
  }
}

export class Store {
  constructor(initialScores, initialCupBatches) {
    this.initialScores = structuredClone(initialScores);
    this.initialCupBatches = structuredClone(initialCupBatches);
    this.reset();
  }

  reset() {
    this.scores = structuredClone(this.initialScores);
    this.cupBatches = structuredClone(this.initialCupBatches);
    this.revisions = [];
    this.revisionSeq = 0;
    return this.snapshot();
  }

  getScores() {
    return structuredClone(this.scores);
  }

  getCupBatches() {
    return structuredClone(this.cupBatches);
  }

  getRevisions() {
    return structuredClone(this.revisions);
  }

  getRevision(id) {
    const rev = this.revisions.find((r) => r.id === id);
    return rev ? structuredClone(rev) : null;
  }

  findCup(cupId) {
    return this.cupBatches.find((m) => m.cupId === cupId) ?? null;
  }

  /**
   * 更正样杯批号。
   * @returns 修订条目（含修订前/后映射、受影响的全部打分记录快照）
   */
  correctCup(cupId, newBatchId, reason = '') {
    if (typeof cupId !== 'string' || !cupId.trim()) {
      throw new ValidationError('cupId 不能为空');
    }
    if (typeof newBatchId !== 'string' || !newBatchId.trim()) {
      throw new ValidationError('newBatchId 不能为空');
    }
    const current = this.findCup(cupId);
    if (!current) {
      throw new NotFoundError(`杯 ${cupId} 不存在，无法更正`);
    }
    const oldBatchId = current.batchId;
    if (oldBatchId === newBatchId) {
      throw new ValidationError(`杯 ${cupId} 当前批号已经是 ${newBatchId}，无需更正`);
    }

    // 受影响的评分：这只杯上的全部打分记录（含多轮重复测量），
    // 在修订前后都属于同一批物理记录，只是归属批号发生变化。
    const affectedRecords = this.scores
      .filter((r) => r.cupId === cupId)
      .map((r) => structuredClone(r));
    if (affectedRecords.length === 0) {
      throw new ValidationError(`杯 ${cupId} 没有任何打分记录，更正没有可核对的受影响评分`);
    }
    const affectedEvaluators = [...new Set(affectedRecords.map((r) => r.evaluatorId))].sort();
    const affectedRounds = [...new Set(affectedRecords.map((r) => r.round ?? 1))].sort();

    const beforeMap = structuredClone(current);
    this.revisionSeq += 1;
    const id = `REV${String(this.revisionSeq).padStart(3, '0')}`;

    current.batchId = newBatchId;
    const afterMap = structuredClone(current);

    const revision = {
      id,
      timestamp: new Date().toISOString(),
      cupId,
      oldBatchId,
      newBatchId,
      reason: String(reason ?? ''),
      beforeMap,
      afterMap,
      affectedRecordCount: affectedRecords.length,
      affectedEvaluatorIds: affectedEvaluators,
      affectedRounds,
      affectedRecords,
      affectedRecordIds: affectedRecords.map((r) => r.recordId)
    };
    this.revisions.push(revision);
    return structuredClone(revision);
  }

  snapshot() {
    return {
      cupBatches: this.getCupBatches(),
      scoreCount: this.scores.length,
      revisionCount: this.revisions.length
    };
  }
}
