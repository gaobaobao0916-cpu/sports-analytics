// 纯函数核心：只做数据判定与展示字段映射，不依赖 DOM / window / fetch。
// 浏览器（script.js）与 node --test（tests/*.mjs）共用同一份逻辑。

export const BEIJING_TZ = 'Asia/Shanghai';

const RESULT_STATUSES = new Set(['HIT', 'MISS', 'PENDING', 'REVIEW', 'ABNORMAL']);
const FINISHED_MATCH_STATUSES = new Set([
  'FT',
  'FINISHED',
  'FULL_TIME',
  'FULL-TIME',
  'AET',
  'PEN',
  'ENDED',
  'COMPLETE',
]);
const ABNORMAL_MATCH_STATUSES = new Set([
  'ABANDONED',
  'POSTPONED',
  'CANCELLED',
  'CANCELED',
  'SUSPENDED',
]);

const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
const MISSING = '—';

const BEIJING_FORMATTER = new Intl.DateTimeFormat('en-US', {
  timeZone: BEIJING_TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function isText(value) {
  return typeof value === 'string' && value.trim() !== '';
}

function beijingParts(iso) {
  if (!isText(iso)) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  const parts = {};
  for (const part of BEIJING_FORMATTER.formatToParts(date)) {
    if (part.type !== 'literal') parts[part.type] = part.value;
  }
  return parts.year && parts.month && parts.day ? parts : null;
}

function recordBeijingParts(record) {
  const local = record && isText(record.push_sent_at_local) ? beijingParts(record.push_sent_at_local) : null;
  if (local) return local;
  return record && isText(record.push_sent_at_utc) ? beijingParts(record.push_sent_at_utc) : null;
}

export function beijingDate(iso) {
  const parts = beijingParts(iso);
  return parts ? `${parts.year}-${parts.month}-${parts.day}` : '';
}

export function beijingClock(iso) {
  const parts = beijingParts(iso);
  return parts ? `${parts.hour}:${parts.minute}:${parts.second}` : '';
}

export function beijingDateTime(iso) {
  const date = beijingDate(iso);
  const clock = beijingClock(iso);
  return date && clock ? `${date} ${clock}` : '';
}

export function weekdayCN(dateStr) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateStr || '').trim());
  if (!match) return '';
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    Number.isNaN(date.getTime()) ||
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return '';
  }
  return WEEKDAYS[date.getUTCDay()];
}

function hasFinalScore(record) {
  return (
    record &&
    isFiniteNumber(record.final_home_score) &&
    isFiniteNumber(record.final_away_score)
  );
}

function matchStatus(record) {
  return isText(record && record.match_status) ? record.match_status.trim().toUpperCase() : '';
}

/**
 * 判定一条推送的进球结果。
 * 已给出的 goal_result_status 优先，但 HIT/MISS 必须有终场比分兜底，否则降级 REVIEW。
 * 其余情况根据终场比分、推送比分与 goals_after_push 推导，绝不把 null 当作 0。
 */
export function classifyRecord(record) {
  if (!record || typeof record !== 'object') return 'REVIEW';

  const status = record.goal_result_status;
  const finalReady = hasFinalScore(record);

  if (RESULT_STATUSES.has(status)) {
    if ((status === 'HIT' || status === 'MISS') && !finalReady) return 'REVIEW';
    return status;
  }

  const matchState = matchStatus(record);
  if (ABNORMAL_MATCH_STATUSES.has(matchState)) return 'ABNORMAL';

  if (!finalReady) {
    return FINISHED_MATCH_STATUSES.has(matchState) ? 'REVIEW' : 'PENDING';
  }

  if (!isFiniteNumber(record.push_home_score) || !isFiniteNumber(record.push_away_score)) {
    return 'REVIEW';
  }

  if (isFiniteNumber(record.goals_after_push)) {
    if (record.goals_after_push < 0) return 'REVIEW';
    return record.goals_after_push > 0 ? 'HIT' : 'MISS';
  }

  const pushTotal = record.push_home_score + record.push_away_score;
  const finalTotal = record.final_home_score + record.final_away_score;
  const goalsAfterPush = finalTotal - pushTotal;
  if (goalsAfterPush < 0) return 'REVIEW';
  return goalsAfterPush > 0 ? 'HIT' : 'MISS';
}

function displayLevel(record) {
  if (record && record.alert_level === 'formal') return { level: '强提醒', levelKey: 'formal' };
  if (record && record.alert_level === 'soft') return { level: '软提醒', levelKey: 'soft' };
  return { level: MISSING, levelKey: 'unknown' };
}

function displayMarketType(record) {
  const type = isText(record && record.market_type) ? record.market_type.trim() : '';
  if (!type) return MISSING;
  const period = isText(record && record.market_period) ? record.market_period.trim() : '';
  return period ? `${period} ${type}` : type;
}

function displayMatch(record) {
  const home = isText(record && record.home_team) ? record.home_team.trim() : '';
  const away = isText(record && record.away_team) ? record.away_team.trim() : '';
  return home && away ? `${home} vs ${away}` : MISSING;
}

function displayLeague(record) {
  return isText(record && record.league) ? record.league.trim() : MISSING;
}

function displayMinute(record) {
  if (isText(record && record.push_minute_display)) return record.push_minute_display.trim();
  if (isFiniteNumber(record && record.push_minute_value)) return `${record.push_minute_value}′`;
  return '';
}

function displayScore(home, away) {
  return isFiniteNumber(home) && isFiniteNumber(away) ? `${home}-${away}` : '';
}

function displayMarketLine(record) {
  if (isText(record && record.market_line)) return record.market_line.trim();
  if (isFiniteNumber(record && record.market_line)) return String(record.market_line);
  return MISSING;
}

function displayGoals(value) {
  return isFiniteNumber(value) ? `${value} 球` : MISSING;
}

function displayRecordClass(record) {
  if (record && record.record_class === 'prediction') return '正式预测';
  if (record && record.record_class === 'observation') return '观察记录';
  return MISSING;
}

export function rowViewModel(record) {
  const source = record && typeof record === 'object' ? record : {};
  const status = classifyRecord(source);
  const timeParts = recordBeijingParts(source);
  const pushDate = timeParts ? `${timeParts.year}-${timeParts.month}-${timeParts.day}` : '';
  const pushClock = timeParts ? `${timeParts.hour}:${timeParts.minute}:${timeParts.second}` : '';
  const pushTime = pushDate && pushClock ? `${pushDate} ${pushClock}` : MISSING;

  const minute = displayMinute(source);
  const pushScore = displayScore(source.push_home_score, source.push_away_score);
  const level = displayLevel(source);
  const finalReady = hasFinalScore(source);

  let finalScore = MISSING;
  if (finalReady) finalScore = `${source.final_home_score}-${source.final_away_score}`;
  else if (status === 'PENDING') finalScore = '待完场';
  else if (status === 'REVIEW') finalScore = '待核验';

  const halfTimeScore = displayScore(source.half_time_home_score, source.half_time_away_score);
  const modelScore = isFiniteNumber(source.model_score) ? source.model_score.toFixed(1) : MISSING;

  return {
    pushTime,
    pushDate,
    pushClock,
    level: level.level,
    levelKey: level.levelKey,
    type: displayMarketType(source),
    match: displayMatch(source),
    homeTeam: isText(source.home_team) ? source.home_team.trim() : MISSING,
    awayTeam: isText(source.away_team) ? source.away_team.trim() : MISSING,
    league: displayLeague(source),
    pushMinute: minute || MISSING,
    pushScore: pushScore || MISSING,
    pushMoment: minute && pushScore ? `${minute} / ${pushScore}` : MISSING,
    marketLine: displayMarketLine(source),
    finalScore,
    finalIsScore: finalReady,
    halfTimeScore: halfTimeScore || MISSING,
    modelScore,
    recordClass: displayRecordClass(source),
    fullTimeGoals: displayGoals(source.full_time_goals),
    goalsAfterPush: displayGoals(source.goals_after_push),
    status,
    result: status,
    resultLabel:
      status === 'HIT'
        ? '命中'
        : status === 'MISS'
          ? '未命中'
          : status === 'PENDING'
            ? '待完场'
            : status === 'REVIEW'
              ? '待核验'
              : '比赛异常',
  };
}

/** 按 push_id 去重，保留首次出现的记录；没有 push_id 的记录原样保留。 */
export function dedupeByPushId(records) {
  const list = Array.isArray(records) ? records : [];
  const seen = new Set();
  const unique = [];
  for (const record of list) {
    const pushId =
      record && typeof record.push_id === 'string' && record.push_id ? record.push_id : null;
    if (pushId) {
      if (seen.has(pushId)) continue;
      seen.add(pushId);
    }
    unique.push(record);
  }
  return unique;
}

export function summarize(records) {
  const list = dedupeByPushId(records);
  let formal = 0;
  let soft = 0;
  let hit = 0;
  let miss = 0;
  let pending = 0;
  let review = 0;
  let abnormal = 0;

  for (const record of list) {
    if (record && record.alert_level === 'formal') formal += 1;
    if (record && record.alert_level === 'soft') soft += 1;
    const status = classifyRecord(record);
    if (status === 'HIT') hit += 1;
    else if (status === 'MISS') miss += 1;
    else if (status === 'PENDING') pending += 1;
    else if (status === 'REVIEW') review += 1;
    else if (status === 'ABNORMAL') abnormal += 1;
  }

  const denominator = hit + miss;
  return {
    push_total: list.length,
    formal,
    soft,
    settled: denominator,
    hit,
    miss,
    pending,
    review,
    abnormal,
    hit_rate: denominator ? Math.round((hit / denominator) * 10000) / 10000 : null,
    hit_rate_denominator: denominator,
  };
}

export function matchesFilter(record, filter) {
  switch (filter) {
    case 'formal':
      return Boolean(record && record.alert_level === 'formal');
    case 'soft':
      return Boolean(record && record.alert_level === 'soft');
    case 'prediction':
      return Boolean(record && record.record_class === 'prediction');
    case 'observation':
      return Boolean(record && record.record_class === 'observation');
    case 'hit':
      return classifyRecord(record) === 'HIT';
    case 'miss':
      return classifyRecord(record) === 'MISS';
    case 'unsettled': {
      const status = classifyRecord(record);
      return status === 'PENDING' || status === 'REVIEW';
    }
    case 'all':
    default:
      return true;
  }
}

export function matchesQuery(record, query) {
  const text = String(query == null ? '' : query).trim().toLowerCase();
  if (!text) return true;
  if (!record || typeof record !== 'object') return false;

  const parts = recordBeijingParts(record);
  const date = parts ? `${parts.year}-${parts.month}-${parts.day}` : '';
  const home = isText(record.home_team) ? record.home_team.trim() : '';
  const away = isText(record.away_team) ? record.away_team.trim() : '';
  const haystack = [
    home,
    away,
    home && away ? `${home} vs ${away}` : '',
    isText(record.league) ? record.league.trim() : '',
    date,
  ]
    .join(' ')
    .toLowerCase();

  return text.split(/\s+/).every((token) => haystack.includes(token));
}
