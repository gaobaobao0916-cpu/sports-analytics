import test from 'node:test';
import assert from 'node:assert/strict';

import {
  BEIJING_TZ,
  beijingClock,
  beijingDate,
  classifyRecord,
  dedupeByPushId,
  matchesFilter,
  matchesQuery,
  rowViewModel,
  summarize,
  weekdayCN,
} from '../live-results-core.js';

let sequence = 0;

function makeRecord(overrides = {}) {
  sequence += 1;
  return {
    push_id: `push-${String(sequence).padStart(8, '0')}`,
    match_id: '7m:1000001',
    sport: 'football',
    league: 'TEST LEAGUE',
    home_team: 'Alpha',
    away_team: 'Beta',
    push_sent_at_utc: '2026-11-17T15:30:27.111189+00:00',
    push_sent_at_local: '2026-11-17T23:30:27.111189+08:00',
    push_minute_display: '62′',
    push_minute_value: 62,
    push_home_score: 1,
    push_away_score: 0,
    market_period: 'FT',
    market_type: 'OU',
    market_line: '1.75',
    market_odds_over: 1.94,
    market_odds_under: 1.88,
    alert_level: 'formal',
    record_class: 'prediction',
    signal_type: 'FT_FORMAL_OVER',
    model_score: 87,
    send_status: 'DELIVERED',
    match_status: 'FT',
    final_home_score: 2,
    final_away_score: 1,
    half_time_home_score: 1,
    half_time_away_score: 0,
    full_time_goals: 3,
    goals_after_push: 2,
    ...overrides,
  };
}

test('T01 62′ 1-0，终场 2-1 → 推送后新增 2 球，HIT', () => {
  const record = makeRecord({ push_minute_display: '62′', push_home_score: 1, push_away_score: 0 });
  assert.equal(classifyRecord(record), 'HIT');

  const view = rowViewModel(record);
  assert.equal(view.pushMoment, '62′ / 1-0');
  assert.equal(view.finalScore, '2-1');
  assert.equal(view.goalsAfterPush, '2 球');
  assert.equal(view.resultLabel, '命中');
});

test('T02 78′ 2-1，终场 2-1 → 推送后新增 0 球，MISS', () => {
  const record = makeRecord({
    push_minute_display: '78′',
    push_home_score: 2,
    push_away_score: 1,
    final_home_score: 2,
    final_away_score: 1,
    full_time_goals: 3,
    goals_after_push: 0,
  });
  assert.equal(classifyRecord(record), 'MISS');

  const view = rowViewModel(record);
  assert.equal(view.goalsAfterPush, '0 球');
  assert.equal(view.resultLabel, '未命中');
});

test('T03 20′ 0-0，终场 1-0 → 推送后新增 1 球，HIT', () => {
  const record = makeRecord({
    push_minute_display: '20′',
    push_minute_value: 20,
    push_home_score: 0,
    push_away_score: 0,
    final_home_score: 1,
    final_away_score: 0,
    full_time_goals: 1,
    goals_after_push: 1,
  });
  assert.equal(classifyRecord(record), 'HIT');
  assert.equal(rowViewModel(record).pushMoment, '20′ / 0-0');
  assert.equal(rowViewModel(record).goalsAfterPush, '1 球');
});

test('T04 没有终场比分 → PENDING', () => {
  const record = makeRecord({
    match_status: null,
    final_home_score: null,
    final_away_score: null,
    full_time_goals: null,
    goals_after_push: null,
  });
  assert.equal(classifyRecord(record), 'PENDING');
  assert.equal(rowViewModel(record).finalScore, '待完场');
  assert.equal(rowViewModel(record).resultLabel, '待完场');
});

test('T05 推送比分为 null → REVIEW，且绝不当作 0-0', () => {
  const record = makeRecord({
    push_home_score: null,
    push_away_score: null,
    final_home_score: 2,
    final_away_score: 1,
    goals_after_push: 2,
  });
  assert.equal(classifyRecord(record), 'REVIEW');

  const view = rowViewModel(record);
  assert.equal(view.pushMoment, '—');
  assert.notEqual(view.pushMoment, '62′ / 0-0');
  assert.equal(view.finalScore, '2-1');
  assert.equal(view.resultLabel, '待核验');
});

test('T06 已完场但终场比分为 null → REVIEW，HIT/MISS 也降级', () => {
  const record = makeRecord({
    match_status: 'FT',
    final_home_score: null,
    final_away_score: null,
    full_time_goals: null,
    goals_after_push: null,
  });
  assert.equal(classifyRecord(record), 'REVIEW');
  assert.equal(rowViewModel(record).finalScore, '待核验');

  const staleHit = makeRecord({
    match_status: 'FT',
    final_home_score: null,
    final_away_score: null,
    goal_result_status: 'HIT',
  });
  const staleMiss = makeRecord({
    match_status: 'FT',
    final_home_score: null,
    final_away_score: null,
    goal_result_status: 'MISS',
  });
  assert.equal(classifyRecord(staleHit), 'REVIEW');
  assert.equal(classifyRecord(staleMiss), 'REVIEW');
});

test('T07 终场总进球小于推送时 → REVIEW，不截断为 0', () => {
  const record = makeRecord({
    push_minute_display: '70′',
    push_home_score: 2,
    push_away_score: 1,
    final_home_score: 1,
    final_away_score: 0,
    full_time_goals: 1,
    goals_after_push: null,
  });
  assert.equal(classifyRecord(record), 'REVIEW');
  assert.notEqual(rowViewModel(record).goalsAfterPush, '0 球');

  const explicitNegative = makeRecord({ goals_after_push: -2 });
  assert.equal(classifyRecord(explicitNegative), 'REVIEW');
  assert.equal(rowViewModel(explicitNegative).goalsAfterPush, '-2 球');
});

test('T08 取消 / 腰斩 → ABNORMAL', () => {
  const abandoned = makeRecord({
    match_status: 'ABANDONED',
    final_home_score: null,
    final_away_score: null,
    full_time_goals: null,
    goals_after_push: null,
  });
  const postponed = makeRecord({
    match_status: 'POSTPONED',
    final_home_score: null,
    final_away_score: null,
    full_time_goals: null,
    goals_after_push: null,
  });

  assert.equal(classifyRecord(abandoned), 'ABNORMAL');
  assert.equal(classifyRecord(postponed), 'ABNORMAL');
  assert.equal(rowViewModel(abandoned).resultLabel, '比赛异常');
  assert.equal(rowViewModel(abandoned).finalScore, '—');
});

test('T09 同一场比赛两条不同 push_id 分别判定', () => {
  const hitRecord = makeRecord({
    push_id: 'same-match-hit',
    match_id: '7m:5199999',
    push_home_score: 0,
    push_away_score: 0,
    final_home_score: 1,
    final_away_score: 0,
    goals_after_push: 1,
  });
  const missRecord = makeRecord({
    push_id: 'same-match-miss',
    match_id: '7m:5199999',
    push_home_score: 2,
    push_away_score: 1,
    final_home_score: 2,
    final_away_score: 1,
    goals_after_push: 0,
  });

  assert.equal(hitRecord.match_id, missRecord.match_id);
  assert.equal(classifyRecord(hitRecord), 'HIT');
  assert.equal(classifyRecord(missRecord), 'MISS');

  const summary = summarize([hitRecord, missRecord]);
  assert.equal(summary.push_total, 2);
  assert.equal(summary.hit, 1);
  assert.equal(summary.miss, 1);
});

test('T10 同一 push_id 重跑导出不产生重复（按 push_id 去重）', () => {
  const first = makeRecord({ push_id: 'duplicate-push-id' });
  const duplicate = makeRecord({ push_id: 'duplicate-push-id', home_team: 'Changed' });
  const other = makeRecord({ push_id: 'another-push-id' });

  const unique = dedupeByPushId([first, duplicate, other]);
  assert.equal(unique.length, 2);
  assert.equal(unique[0], first);
  assert.equal(unique[1], other);

  const summary = summarize([first, duplicate]);
  assert.equal(summary.push_total, 1);
  assert.equal(summary.hit, 1);
});

test('T11 UTC 23:30 归档日期为北京时间次日 07:30', () => {
  const iso = '2026-11-17T23:30:00.000Z';
  assert.equal(BEIJING_TZ, 'Asia/Shanghai');
  assert.equal(beijingDate(iso), '2026-11-18');
  assert.equal(beijingClock(iso), '07:30:00');
  assert.equal(weekdayCN('2026-11-18'), '周三');

  const view = rowViewModel(
    makeRecord({
      push_sent_at_utc: iso,
      push_sent_at_local: '2026-11-18T07:30:00.000+08:00',
    })
  );
  assert.equal(view.pushDate, '2026-11-18');
  assert.equal(view.pushClock, '07:30:00');
  assert.equal(view.pushTime, '2026-11-18 07:30:00');
});

test('T13 缺失字段显示 —，且不伪造成 0', () => {
  const emptyView = rowViewModel({});
  assert.equal(emptyView.pushTime, '—');
  assert.equal(emptyView.level, '—');
  assert.equal(emptyView.type, '—');
  assert.equal(emptyView.match, '—');
  assert.equal(emptyView.league, '—');
  assert.equal(emptyView.pushMoment, '—');
  assert.equal(emptyView.marketLine, '—');
  assert.equal(emptyView.halfTimeScore, '—');
  assert.equal(emptyView.modelScore, '—');
  assert.equal(emptyView.recordClass, '—');
  assert.equal(emptyView.fullTimeGoals, '—');
  assert.equal(emptyView.goalsAfterPush, '—');
  assert.equal(emptyView.finalScore, '待完场');

  const missing = rowViewModel(
    makeRecord({
      model_score: null,
      market_line: null,
      half_time_home_score: null,
      half_time_away_score: null,
      full_time_goals: null,
      goals_after_push: null,
    })
  );
  assert.equal(missing.modelScore, '—');
  assert.equal(missing.marketLine, '—');
  assert.equal(missing.halfTimeScore, '—');
  assert.equal(missing.fullTimeGoals, '—');
  assert.equal(missing.goalsAfterPush, '—');
  assert.notEqual(missing.modelScore, '0.0');

  const realZeros = rowViewModel(
    makeRecord({
      push_minute_display: '20′',
      push_home_score: 0,
      push_away_score: 0,
      model_score: 0,
    })
  );
  assert.equal(realZeros.pushMoment, '20′ / 0-0');
  assert.equal(realZeros.modelScore, '0.0');
});

test('T14 过滤后的 summarize 与过滤集合一致', () => {
  const hit = makeRecord({ push_id: 'filter-hit' });
  const miss = makeRecord({
    push_id: 'filter-miss',
    alert_level: 'soft',
    record_class: 'observation',
    push_home_score: 2,
    push_away_score: 1,
    final_home_score: 2,
    final_away_score: 1,
    goals_after_push: 0,
  });
  const pending = makeRecord({
    push_id: 'filter-pending',
    alert_level: 'soft',
    final_home_score: null,
    final_away_score: null,
    match_status: null,
    full_time_goals: null,
    goals_after_push: null,
  });
  const review = makeRecord({
    push_id: 'filter-review',
    match_status: 'FT',
    final_home_score: null,
    final_away_score: null,
    full_time_goals: null,
    goals_after_push: null,
  });
  const abnormal = makeRecord({
    push_id: 'filter-abnormal',
    match_status: 'ABANDONED',
    final_home_score: null,
    final_away_score: null,
    full_time_goals: null,
    goals_after_push: null,
  });

  const records = [hit, miss, pending, review, abnormal];
  const all = summarize(records);
  assert.equal(all.push_total, 5);
  assert.equal(all.hit, 1);
  assert.equal(all.miss, 1);
  assert.equal(all.pending, 1);
  assert.equal(all.review, 1);
  assert.equal(all.abnormal, 1);
  assert.equal(all.settled, 2);
  assert.equal(all.hit_rate, 0.5);

  const formalRecords = records.filter((record) => matchesFilter(record, 'formal'));
  const formalSummary = summarize(formalRecords);
  assert.equal(formalSummary.push_total, all.formal);
  assert.equal(formalSummary.push_total, 3);

  const softRecords = records.filter((record) => matchesFilter(record, 'soft'));
  assert.equal(summarize(softRecords).push_total, all.soft);
  assert.equal(summarize(softRecords).push_total, 2);

  const predictionRecords = records.filter((record) => matchesFilter(record, 'prediction'));
  assert.equal(summarize(predictionRecords).push_total, 4);

  const unsettledRecords = records.filter((record) => matchesFilter(record, 'unsettled'));
  assert.equal(summarize(unsettledRecords).push_total, all.pending + all.review);
  assert.equal(summarize(unsettledRecords).push_total, 2);

  const hitRecords = records.filter((record) => matchesFilter(record, 'hit'));
  assert.deepEqual(summarize(hitRecords), summarize([hit]));
  assert.equal(summarize(hitRecords).push_total, 1);
});

test('搜索按比赛、联赛、北京日期匹配', () => {
  const record = makeRecord();
  assert.equal(matchesQuery(record, ''), true);
  assert.equal(matchesQuery(record, 'alpha'), true);
  assert.equal(matchesQuery(record, 'Alpha vs Beta'), true);
  assert.equal(matchesQuery(record, 'test league'), true);
  assert.equal(matchesQuery(record, '2026-11-17'), true);
  assert.equal(matchesQuery(record, '2026-11-18'), false);
  assert.equal(matchesQuery(record, '不存在的联赛'), false);
});
