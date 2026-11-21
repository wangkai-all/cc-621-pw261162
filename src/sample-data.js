// 本地样例数据：茶叶盲评打分记录
// 数据模型说明：
//   scores  —— 每一条是一次盲评打分；同一只杯由同一位评员在不同盲评轮次
//              重复打分是“重复测量”，分析时必须先按 (杯, 评员) 折叠，
//              绝不能当作相互独立的样本。
//   cupBatches —— 匿名样杯当前对应的批号（可能因事后核查而被更正）。
// 不接任何外部服务，全部数据内置在本文件中。

export const sampleCupBatches = [
  { cupId: 'C01', batchId: 'B1' },
  { cupId: 'C02', batchId: 'B1' },
  { cupId: 'C03', batchId: 'B1' }, // 设计上这只杯事后会被更正到 B2
  { cupId: 'C04', batchId: 'B2' },
  { cupId: 'C05', batchId: 'B2' }
];

// score: 百分制；grade: 评级（优 >=90，良 >=80，中 >=70，其余差）
// round: 盲评轮次，用于“按盲评轮次调整”的分析方式
export const sampleScores = [
  // ---- 第 1 轮 ----
  { recordId: 'R001', cupId: 'C01', evaluatorId: 'E1', round: 1, score: 92, grade: '优' },
  { recordId: 'R002', cupId: 'C01', evaluatorId: 'E2', round: 1, score: 85, grade: '良' },
  { recordId: 'R003', cupId: 'C01', evaluatorId: 'E3', round: 1, score: 88, grade: '良' },
  { recordId: 'R004', cupId: 'C02', evaluatorId: 'E1', round: 1, score: 78, grade: '中' },
  { recordId: 'R005', cupId: 'C02', evaluatorId: 'E2', round: 1, score: 70, grade: '中' },
  { recordId: 'R006', cupId: 'C02', evaluatorId: 'E3', round: 1, score: 75, grade: '中' },
  { recordId: 'R007', cupId: 'C03', evaluatorId: 'E1', round: 1, score: 95, grade: '优' },
  { recordId: 'R008', cupId: 'C03', evaluatorId: 'E2', round: 1, score: 87, grade: '良' },
  { recordId: 'R009', cupId: 'C03', evaluatorId: 'E3', round: 1, score: 90, grade: '优' },
  { recordId: 'R010', cupId: 'C04', evaluatorId: 'E1', round: 1, score: 82, grade: '良' },
  { recordId: 'R011', cupId: 'C04', evaluatorId: 'E2', round: 1, score: 76, grade: '中' },
  { recordId: 'R012', cupId: 'C04', evaluatorId: 'E3', round: 1, score: 79, grade: '中' },
  { recordId: 'R013', cupId: 'C05', evaluatorId: 'E1', round: 1, score: 88, grade: '良' },
  { recordId: 'R014', cupId: 'C05', evaluatorId: 'E2', round: 1, score: 80, grade: '良' },
  { recordId: 'R015', cupId: 'C05', evaluatorId: 'E3', round: 1, score: 84, grade: '良' },

  // ---- 第 2 轮：同批茶再次盲评（重复测量，不是新样本）；每个杯×评员组合两轮齐全 ----
  { recordId: 'R016', cupId: 'C01', evaluatorId: 'E1', round: 2, score: 90, grade: '优' },
  { recordId: 'R017', cupId: 'C01', evaluatorId: 'E2', round: 2, score: 83, grade: '良' },
  { recordId: 'R018', cupId: 'C01', evaluatorId: 'E3', round: 2, score: 87, grade: '良' },
  { recordId: 'R019', cupId: 'C02', evaluatorId: 'E1', round: 2, score: 76, grade: '中' },
  { recordId: 'R020', cupId: 'C02', evaluatorId: 'E2', round: 2, score: 72, grade: '中' },
  { recordId: 'R021', cupId: 'C03', evaluatorId: 'E1', round: 2, score: 93, grade: '优' },
  { recordId: 'R022', cupId: 'C03', evaluatorId: 'E2', round: 2, score: 85, grade: '良' },
  { recordId: 'R023', cupId: 'C04', evaluatorId: 'E1', round: 2, score: 80, grade: '良' },
  { recordId: 'R024', cupId: 'C04', evaluatorId: 'E3', round: 2, score: 77, grade: '中' },
  { recordId: 'R025', cupId: 'C05', evaluatorId: 'E2', round: 2, score: 82, grade: '良' },
  { recordId: 'R026', cupId: 'C05', evaluatorId: 'E3', round: 2, score: 85, grade: '良' },
  { recordId: 'R027', cupId: 'C02', evaluatorId: 'E3', round: 2, score: 74, grade: '中' },
  { recordId: 'R028', cupId: 'C03', evaluatorId: 'E3', round: 2, score: 90, grade: '优' },
  { recordId: 'R029', cupId: 'C04', evaluatorId: 'E2', round: 2, score: 74, grade: '中' },
  { recordId: 'R030', cupId: 'C05', evaluatorId: 'E1', round: 2, score: 86, grade: '良' }
];
