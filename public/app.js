// 纯原生 JS：三个操作按钮对应三个 API 调用。
// 所有业务结果渲染在带 data-evidence-result 属性的区域内，
// 便于核对同一次操作前后的内容变化。

const $ = (sel) => document.querySelector(sel);

const els = {
  badge: $('#revision-badge'),
  btnReset: $('#btn-reset'),
  method: $('#bias-method'),
  btnAnalyze: $('#btn-analyze'),
  cupSelect: $('#correction-cup'),
  batchSelect: $('#correction-batch'),
  reason: $('#correction-reason'),
  btnCorrect: $('#btn-correct'),
  btnRatings: $('#btn-ratings'),
  errorBox: $('#error-box'),
  biasPanel: $('#bias-panel'),
  biasTag: $('#bias-method-tag'),
  biasResult: $('#bias-result'),
  batchPanel: $('#batch-panel'),
  batchResult: $('#batch-result'),
  ratingPanel: $('#rating-panel'),
  ratingResult: $('#rating-result'),
  correctionPanel: $('#correction-panel'),
  correctionResult: $('#correction-result')
};

let lastAnalysis = null; // 最近一次完整分析（更正前/后都可对照）

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[ch]));
}

function showError(message) {
  els.errorBox.textContent = message;
  els.errorBox.hidden = false;
}
function clearError() {
  els.errorBox.hidden = true;
  els.errorBox.textContent = '';
}

async function api(path, options = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...options
  });
  const payload = await res.json();
  if (!res.ok) throw new Error(payload.message || `请求失败（${res.status}）`);
  return payload;
}

function statusPill(status) {
  const map = { ok: 'ok', 覆盖偏低: 'warn', 数据不足: 'bad' };
  const label = { ok: '正常', 覆盖偏低: '覆盖偏低', 数据不足: '数据不足' };
  return `<span class="pill ${map[status] ?? 'neutral'}">${esc(label[status] ?? status)}</span>`;
}

function warningsList(items) {
  if (!items || items.length === 0) return '';
  return `<ul class="warn-list">${items.map((w) => `<li>${esc(w)}</li>`).join('')}</ul>`;
}

function setBusy(button, busy, text) {
  if (!button) return;
  if (busy) {
    button.dataset.originalText = button.textContent;
    button.textContent = text;
    button.disabled = true;
  } else {
    button.textContent = button.dataset.originalText || button.textContent;
    button.disabled = false;
  }
}

// ---------- 渲染：评员偏差 ----------
function renderBias(analysis) {
  const bias = analysis.bias;
  const roundInfo = analysis.method === 'round-adjusted'
    ? `<div class="card"><h3>轮次效应</h3>${renderRoundEffects(analysis.roundAdjusted)}</div>`
    : '';
  const biasRows = bias.evaluatorBiases.map((b) => `
    <tr>
      <td class="mono">${esc(b.evaluatorId)}</td>
      <td>${b.cupsCovered}/${b.cupsTotal}</td>
      <td>${b.coverage === null ? '—' : b.coverage}</td>
      <td><strong>${b.meanBias ?? '—'}</strong></td>
      <td>${b.meanAbsBias ?? '—'}</td>
      <td>${b.maxAbsBias ?? '—'}</td>
      <td>${b.totalRounds}</td>
      <td>${statusPill(b.status)}</td>
    </tr>`).join('');
  const pairRows = bias.pairwise.map((p) => `
    <tr>
      <td class="mono">${esc(p.evaluatorA)} vs ${esc(p.evaluatorB)}</td>
      <td>${p.sharedCups ?? 0}</td>
      <td>${p.meanDifference ?? '—'}</td>
      <td>${p.meanAbsDifference ?? '—'}</td>
      <td>${p.maxAbsDifference ?? '—'}</td>
      <td>${p.status ? statusPill(p.status) : ''}</td>
    </tr>`).join('');
  const cupRows = bias.cupConsensus.map((c) => `
    <tr>
      <td class="mono">${esc(c.cupId)}</td>
      <td>${c.nEvaluators}</td>
      <td>${c.consensus}</td>
      <td>${c.evaluatorDeltas.map((d) => `${esc(d.evaluatorId)}:${d.delta >= 0 ? '+' : ''}${d.delta}`).join('，')}</td>
    </tr>`).join('');

  els.biasTag.textContent = analysis.method === 'round-adjusted' ? '按盲评轮次调整' : '成对分数';
  els.biasResult.innerHTML = `
    <div class="stat-row">
      <span class="stat"><span class="k">原始打分记录</span><span class="v">${analysis.rawRecords}</span></span>
      <span class="stat"><span class="k">折叠后观测（杯×评员）</span><span class="v">${analysis.collapsedObservations}</span></span>
      <span class="stat"><span class="k">样杯数</span><span class="v">${analysis.cupsTotal}</span></span>
      <span class="stat"><span class="k">评员数</span><span class="v">${analysis.evaluatorsTotal}</span></span>
    </div>
    ${warningsList(analysis.dataWarnings)}
    ${analysis.method === 'round-adjusted' ? `<p class="small muted">${esc(analysis.roundAdjusted.note)}</p>` : ''}
    ${roundInfo}
    <h3 class="small">评员个人偏差（相对同杯共识，正=系统性偏高）</h3>
    <table>
      <thead><tr><th>评员</th><th>覆盖杯</th><th>覆盖率</th><th>平均偏差</th><th>平均绝对偏差</th><th>最大绝对偏差</th><th>参与轮次记录</th><th>状态</th></tr></thead>
      <tbody>${biasRows}</tbody>
    </table>
    ${warningsList(bias.evaluatorBiases.flatMap((b) => b.warnings ?? []))}
    <h3 class="small">评员两两成对差异</h3>
    <table>
      <thead><tr><th>评员对</th><th>共同杯</th><th>平均差(A−B)</th><th>平均绝对差</th><th>最大绝对差</th><th>状态</th></tr></thead>
      <tbody>${pairRows}</tbody>
    </table>
    <h3 class="small">各杯共识分与评员差值</h3>
    <table>
      <thead><tr><th>杯号</th><th>评员数</th><th>共识分</th><th>各评员偏差</th></tr></thead>
      <tbody>${cupRows}</tbody>
    </table>`;
}

function renderRoundEffects(roundAdjusted) {
  if (!roundAdjusted.sufficient) return `<p>${esc(roundAdjusted.reason)}</p>`;
  const rows = roundAdjusted.roundEffects.map((r) => `
    <tr><td>第 ${r.round} 轮</td><td>${r.nRecords}</td><td>${r.roundMean}</td><td>${r.effect >= 0 ? '+' : ''}${r.effect}</td></tr>`).join('');
  return `<table><thead><tr><th>轮次</th><th>记录数</th><th>轮次均值</th><th>轮次效应（相对总均值）</th></tr></thead><tbody>${rows}</tbody></table>`;
}

// ---------- 渲染：批内一致性 ----------
function renderBatches(analysis) {
  const result = analysis.batches;
  if (!result.sufficient) {
    els.batchResult.innerHTML = `<div class="empty-note">${esc(result.reason || '当前数据不足以进行批次分析')}</div>`;
    return;
  }
  els.batchResult.innerHTML = `
    ${result.note ? `<ul class="warn-list"><li>${esc(result.note)}</li></ul>` : ''}
    ${result.batches.map((b) => `
      <div class="card">
        <h3>批次 <span class="mono">${esc(b.batchId)}</span>（${b.nCups} 只杯 · ${b.nEvaluators} 位评员）</h3>
        <div class="stat-row">
          <span class="stat"><span class="k">平均共识分</span><span class="v">${b.meanConsensus ?? '—'}</span></span>
          <span class="stat"><span class="k">平均杯内标准差</span><span class="v">${b.meanWithinCupSd ?? '—'}</span></span>
          <span class="stat"><span class="k">平均杯内极差</span><span class="v">${b.meanCupRange ?? '—'}</span></span>
          <span class="stat"><span class="k">ICC(A,1) 绝对一致</span><span class="v">${b.icc.icc ?? '—'}</span></span>
          <span class="stat"><span class="k">评员平均重复性SD</span><span class="v">${b.overallRepeatability ?? '—'}</span></span>
        </div>
        ${b.icc.icc === null ? `<ul class="warn-list"><li>${esc(b.icc.reason)}</li></ul>` : ''}
        ${warningsList(b.warnings)}
        <h3 class="small">杯级一致性</h3>
        <table>
          <thead><tr><th>杯号</th><th>评员数</th><th>共识分</th><th>杯内SD</th><th>极差</th><th>分数区间</th><th>众数评级</th><th>评级一致率</th><th>状态</th></tr></thead>
          <tbody>${b.cups.map((c) => `
            <tr>
              <td class="mono">${esc(c.cupId)}</td>
              <td>${c.nEvaluators}</td>
              <td>${c.consensus}</td>
              <td>${c.withinCupSd ?? '—'}</td>
              <td>${c.range}</td>
              <td>${c.minScore} ~ ${c.maxScore}</td>
              <td>${c.modalGrade ? esc(c.modalGrade) : (c.gradeTies.length ? `分歧(${c.gradeTies.map(esc).join('/')})` : '—')}</td>
              <td>${c.gradeAgreementRate ?? '—'}</td>
              <td>${statusPill(c.sufficient ? 'ok' : '数据不足')}</td>
            </tr>`).join('')}</tbody>
        </table>
        <h3 class="small">评员重复性（同一评员多轮打分的自身波动）</h3>
        <table>
          <thead><tr><th>评员</th><th>打分杯数</th><th>可评估重复杯</th><th>自身SD均值</th><th>状态</th></tr></thead>
          <tbody>${b.repeatability.map((r) => `
            <tr>
              <td class="mono">${esc(r.evaluatorId)}</td>
              <td>${r.cupsScored}</td>
              <td>${r.repeatableCups}</td>
              <td>${r.meanWithinEvaluatorSd ?? '—'}</td>
              <td>${statusPill(r.status)}</td>
            </tr>`).join('')}</tbody>
        </table>
      </div>`).join('')}`;
}

// ---------- 渲染：评级一致性 ----------
function renderRatings(analysis) {
  const r = analysis.ratings;
  if (!r.sufficient) {
    els.ratingResult.innerHTML = `<div class="empty-note">没有可分析的评级数据</div>`;
    return;
  }
  const batchRows = r.batchSummaries.map((b) => `
    <tr>
      <td class="mono">${esc(b.batchId)}</td>
      <td>${b.nCups}</td>
      <td>${b.meanAgreementRate ?? '—'}</td>
      <td>${b.unanimousCups}</td>
      <td>${b.splitCups}</td>
      <td>${statusPill(b.sufficient ? 'ok' : '数据不足')}</td>
    </tr>`).join('');
  const pairRows = r.pairwiseGradeAgreement.map((p) => `
    <tr>
      <td class="mono">${esc(p.evaluatorA)} vs ${esc(p.evaluatorB)}</td>
      <td>${p.sharedCups}</td>
      <td>${p.agreementRate ?? '—'}</td>
      <td>${p.status ? statusPill(p.status) : ''}</td>
    </tr>`).join('');
  const cupRows = r.cups.map((c) => `
    <tr>
      <td class="mono">${esc(c.cupId)}</td>
      <td>${c.batchId ? esc(c.batchId) : '<span class="muted">未分配</span>'}</td>
      <td>${c.nEvaluators}</td>
      <td>${c.evaluatorGrades.map((g) => `${esc(g.evaluatorId)}:${g.modalGrade ? esc(g.modalGrade) : '并列'}`).join('，')}</td>
      <td>${c.consensusGrade ? esc(c.consensusGrade) : (c.gradeTies.length ? `分歧(${c.gradeTies.map(esc).join('/')})` : '—')}</td>
      <td>${c.agreementRate ?? '—'}</td>
      <td>${statusPill(c.sufficient ? 'ok' : '数据不足')}</td>
    </tr>`).join('');

  els.ratingResult.innerHTML = `
    <div class="stat-row">
      <span class="stat"><span class="k">总杯数</span><span class="v">${r.totalCups}</span></span>
      <span class="stat"><span class="k">整体评级一致率</span><span class="v">${r.overallAgreementRate ?? '—'}</span></span>
      <span class="stat"><span class="k">全票一致杯</span><span class="v">${r.unanimousCups}</span></span>
      <span class="stat"><span class="k">分歧杯（并列无共识）</span><span class="v">${r.splitCups}</span></span>
    </div>
    <h3 class="small">按批汇总</h3>
    <table>
      <thead><tr><th>批次</th><th>杯数</th><th>平均一致率</th><th>全票一致</th><th>分歧杯</th><th>状态</th></tr></thead>
      <tbody>${batchRows}</tbody>
    </table>
    <h3 class="small">评员两两评级一致率</h3>
    <table>
      <thead><tr><th>评员对</th><th>共同杯</th><th>评级一致率</th><th>状态</th></tr></thead>
      <tbody>${pairRows}</tbody>
    </table>
    <h3 class="small">逐杯评级明细</h3>
    <table>
      <thead><tr><th>杯号</th><th>批号</th><th>评员数</th><th>各评员评级</th><th>共识评级</th><th>一致率</th><th>状态</th></tr></thead>
      <tbody>${cupRows}</tbody>
    </table>`;
}

// ---------- 渲染：更正前后对照 ----------
function renderCorrection(revision, analysisBefore, analysisAfter) {
  const recRows = (records) => records.map((r) => `
    <tr>
      <td class="mono">${esc(r.recordId)}</td>
      <td class="mono">${esc(r.evaluatorId)}</td>
      <td>第 ${r.round ?? 1} 轮</td>
      <td>${r.score}</td>
      <td>${esc(r.grade ?? '')}</td>
    </tr>`).join('');

  const batchOf = (analysis, cupId) => {
    const hit = analysis.batches.batches
      .flatMap((b) => b.cups.map((c) => ({ batchId: b.batchId, cupId: c.cupId })))
      .find((x) => x.cupId === cupId);
    return hit ? hit.batchId : '（未分配）';
  };
  const ratingBefore = analysisBefore.ratings.cups.find((c) => c.cupId === revision.cupId);
  const ratingAfter = analysisAfter.ratings.cups.find((c) => c.cupId === revision.cupId);
  const batchBefore = analysisBefore.batches.batches.find((b) => b.batchId === revision.oldBatchId);
  const batchAfter = analysisAfter.batches.batches.find((b) => b.batchId === revision.newBatchId);

  els.correctionResult.innerHTML = `
    <div class="grid-2">
      <div class="card before">
        <h3>修订前：杯 <span class="mono">${esc(revision.cupId)}</span> 属于批次 <span class="mono">${esc(revision.oldBatchId)}</span></h3>
        <p class="small muted">受影响评分共 ${revision.affectedRecordCount} 条（评员 ${revision.affectedEvaluatorIds.map(esc).join('、')}；轮次 ${revision.affectedRounds.join('、')}），全部保留未删除。</p>
        <table>
          <thead><tr><th>记录</th><th>评员</th><th>轮次</th><th>分数</th><th>评级</th></tr></thead>
          <tbody>${recRows(revision.affectedRecords)}</tbody>
        </table>
        <p class="small">修订前该杯所在批 <span class="mono">${esc(revision.oldBatchId)}</span>：${batchBefore ? `${batchBefore.nCups} 只杯，平均杯内SD ${batchBefore.meanWithinCupSd ?? '—'}，ICC ${batchBefore.icc.icc ?? '—'}` : '无该批数据'}</p>
        <p class="small">修订前该杯共识评级：${ratingBefore ? (ratingBefore.consensusGrade ? esc(ratingBefore.consensusGrade) : `分歧(${ratingBefore.gradeTies.map(esc).join('/')})`) : '—'}，一致率 ${ratingBefore?.agreementRate ?? '—'}</p>
      </div>
      <div class="card after">
        <h3>修订后：杯 <span class="mono">${esc(revision.cupId)}</span> 改属批次 <span class="mono">${esc(revision.newBatchId)}</span></h3>
        <p class="small muted">同 ${revision.affectedRecordCount} 条评分记录，现按新批号重新归组计算。</p>
        <table>
          <thead><tr><th>记录</th><th>评员</th><th>轮次</th><th>分数</th><th>评级</th></tr></thead>
          <tbody>${recRows(revision.affectedRecords)}</tbody>
        </table>
        <p class="small">修订后该杯所在批 <span class="mono">${esc(revision.newBatchId)}</span>：${batchAfter ? `${batchAfter.nCups} 只杯，平均杯内SD ${batchAfter.meanWithinCupSd ?? '—'}，ICC ${batchAfter.icc.icc ?? '—'}` : '无该批数据'}</p>
        <p class="small">修订后该杯共识评级：${ratingAfter ? (ratingAfter.consensusGrade ? esc(ratingAfter.consensusGrade) : `分歧(${ratingAfter.gradeTies.map(esc).join('/')})`) : '—'}，一致率 ${ratingAfter?.agreementRate ?? '—'}</p>
      </div>
    </div>
    <p class="small muted">修订编号 <span class="mono">${esc(revision.id)}</span> · 时间 ${esc(revision.timestamp)} · 原因：${esc(revision.reason || '（未填写）')} · 实际归组批号：${esc(batchOf(analysisBefore, revision.cupId))} → <span class="mono">${esc(batchOf(analysisAfter, revision.cupId))}</span></p>
    <p class="small">说明：杯级共识分与评员偏差不随批号更正改变（原始评分未变），变化的只是批次级聚合与评级的批次归属。</p>`;
}

// ---------- 主流程 ----------
function applyAnalysis(analysis) {
  lastAnalysis = analysis;
  renderBias(analysis);
  renderBatches(analysis);
  renderRatings(analysis);
  els.biasPanel.hidden = false;
  els.batchPanel.hidden = false;
  els.ratingPanel.hidden = false;
}

async function refreshState() {
  const state = await api('/api/state');
  els.badge.textContent = `更正次数：${state.revisionCount}`;
  const cups = state.cupBatches;
  const batches = [...new Set(cups.map((c) => c.batchId))].sort();
  els.cupSelect.innerHTML = cups.map((c) =>
    `<option value="${esc(c.cupId)}">${esc(c.cupId)}（当前批号 ${esc(c.batchId)}）</option>`).join('');
  els.batchSelect.innerHTML = batches.map((b) => `<option value="${esc(b)}">${esc(b)}</option>`).join('')
    + `<option value="B3">B3（新批号）</option>`;
}

async function doAnalyze() {
  clearError();
  setBusy(els.btnAnalyze, true, '分析中…');
  try {
    const analysis = await api(`/api/analysis?method=${encodeURIComponent(els.method.value)}`);
    applyAnalysis(analysis);
  } catch (err) {
    showError(err.message);
  } finally {
    setBusy(els.btnAnalyze, false);
  }
}

async function doCorrect() {
  clearError();
  const cupId = els.cupSelect.value;
  const newBatchId = els.batchSelect.value;
  if (!cupId || !newBatchId) {
    showError('请选择要更正的样杯和目标批号');
    return;
  }
  setBusy(els.btnCorrect, true, '更正中…');
  try {
    // 先抓取更正前分析用于对照（若尚未分析则先取一次）
    const analysisBefore = lastAnalysis
      ? structuredClone(lastAnalysis)
      : await api(`/api/analysis?method=${encodeURIComponent(els.method.value)}`);
    const payload = await api('/api/corrections', {
      method: 'POST',
      body: JSON.stringify({
        cupId,
        newBatchId,
        reason: els.reason.value.trim(),
        method: els.method.value
      })
    });
    renderCorrection(payload.revision, analysisBefore, payload.analysisAfter);
    applyAnalysis(payload.analysisAfter);
    els.correctionPanel.hidden = false;
    els.correctionPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
    await refreshState();
  } catch (err) {
    showError(err.message);
  } finally {
    setBusy(els.btnCorrect, false);
  }
}

async function doRatings() {
  clearError();
  setBusy(els.btnRatings, true, '加载中…');
  try {
    const analysis = await api(`/api/analysis?method=${encodeURIComponent(els.method.value)}`);
    applyAnalysis(analysis);
    els.ratingPanel.hidden = false;
    els.ratingPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (err) {
    showError(err.message);
  } finally {
    setBusy(els.btnRatings, false);
  }
}

async function doReset() {
  clearError();
  setBusy(els.btnReset, true, '重置中…');
  try {
    await api('/api/reset', { method: 'POST' });
    await refreshState();
    const analysis = await api(`/api/analysis?method=${encodeURIComponent(els.method.value)}`);
    applyAnalysis(analysis);
    els.correctionPanel.hidden = true;
    els.reason.value = '';
  } catch (err) {
    showError(err.message);
  } finally {
    setBusy(els.btnReset, false);
  }
}

els.btnAnalyze.addEventListener('click', doAnalyze);
els.btnCorrect.addEventListener('click', doCorrect);
els.btnRatings.addEventListener('click', doRatings);
els.btnReset.addEventListener('click', doReset);

refreshState().catch((err) => showError(err.message));
