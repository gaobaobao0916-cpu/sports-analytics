import {
  beijingClock,
  beijingDate,
  dedupeByPushId,
  matchesFilter,
  matchesQuery,
  rowViewModel,
  summarize,
  weekdayCN,
} from './live-results-core.js';

const INDEX_PATH = 'data/live-results/index.json';
const LAST_SUCCESS_KEY = 'liveResultsLastSuccessAt';

const TABLE_COLUMNS = [
  { label: '进球结果', className: 'col-result' },
  { label: '推送时间', className: 'col-time' },
  { label: '级别' },
  { label: '类型', className: 'col-type' },
  { label: '比赛', className: 'col-match' },
  { label: '联赛', className: 'col-league' },
  { label: '推送时分 / 比分', className: 'col-minute num' },
  { label: '推送盘口', className: 'col-line num' },
  { label: '终场比分', className: 'col-score num' },
  { label: '半场比分', className: 'col-score num' },
  { label: '模型分', className: 'col-model num' },
  { label: '内容性质', className: 'col-class' },
  { label: '全场总进球', className: 'col-goals num' },
  { label: '推送后新增进球', className: 'col-goals num' },
];

const HTML_ESCAPES = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

function escapeHtml(value) {
  return String(value == null ? '' : value).replace(/[&<>"']/g, (char) => HTML_ESCAPES[char]);
}

function readStoredLastSuccess() {
  try {
    return localStorage.getItem(LAST_SUCCESS_KEY) || '';
  } catch (error) {
    return '';
  }
}

const elements = {
  lastUpdated: document.getElementById('lastUpdated'),
  errorBanner: document.getElementById('errorBanner'),
  lastSuccessAt: document.getElementById('lastSuccessAt'),
  loadedNote: document.getElementById('loadedNote'),
  statPushTotal: document.getElementById('statPushTotal'),
  statFormal: document.getElementById('statFormal'),
  statSoft: document.getElementById('statSoft'),
  statHit: document.getElementById('statHit'),
  statHitRate: document.getElementById('statHitRate'),
  statPending: document.getElementById('statPending'),
  archiveList: document.getElementById('archiveList'),
  emptyState: document.getElementById('emptyState'),
  emptyStateText: document.getElementById('emptyStateText'),
  searchInput: document.getElementById('searchInput'),
  filterButtons: Array.from(document.querySelectorAll('.filter-btn')),
};

const state = {
  index: null,
  days: [],
  loaded: new Map(),
  loading: new Map(),
  dayErrors: new Map(),
  dayElements: new Map(),
  expandedDate: null,
  filter: 'all',
  query: '',
  indexError: false,
  bulkLoading: false,
  lastSuccessAt: readStoredLastSuccess(),
};

let searchTimer = null;

function formatBeijingMinute(iso) {
  const date = beijingDate(iso);
  const clock = beijingClock(iso);
  return date && clock ? `${date} ${clock.slice(0, 5)}` : '—';
}

function isValidDateString(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function timestamp(value) {
  const time = Date.parse(value || '');
  return Number.isNaN(time) ? 0 : time;
}

function isFilterActive() {
  return state.filter !== 'all' || state.query.trim() !== '';
}

function recordMatches(record) {
  return matchesFilter(record, state.filter) && matchesQuery(record, state.query);
}

function getLoadedRecords() {
  const all = [];
  for (const day of state.days) {
    const records = state.loaded.get(day.date);
    if (records) all.push(...records);
  }
  return dedupeByPushId(all);
}

function markSuccess() {
  const now = new Date().toISOString();
  state.lastSuccessAt = now;
  try {
    localStorage.setItem(LAST_SUCCESS_KEY, now);
  } catch (error) {
    // localStorage 不可用时仅保留内存态，不影响页面。
  }
}

function updateLastUpdated(iso) {
  const text = iso ? formatBeijingMinute(iso) : '—';
  elements.lastUpdated.textContent = text;
  if (iso && text !== '—') {
    elements.lastUpdated.setAttribute('datetime', iso);
  } else {
    elements.lastUpdated.removeAttribute('datetime');
  }
}

async function fetchJSON(path) {
  const response = await fetch(path, {
    cache: 'no-store',
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

function renderError() {
  const lastSuccess = state.lastSuccessAt || readStoredLastSuccess();
  elements.lastSuccessAt.textContent = `上次成功加载：${lastSuccess ? formatBeijingMinute(lastSuccess) : '—'}`;
  elements.errorBanner.hidden = !(state.indexError || state.dayErrors.size > 0);
}

function summarizeIndexDays(days) {
  const summary = {
    push_total: 0,
    formal: 0,
    soft: 0,
    settled: 0,
    hit: 0,
    miss: 0,
    pending: 0,
    review: 0,
    abnormal: 0,
  };
  for (const day of days) {
    for (const key of Object.keys(summary)) {
      summary[key] += Number(day[key]) || 0;
    }
  }
  const denominator = summary.hit + summary.miss;
  return {
    ...summary,
    hit_rate: denominator ? Math.round((summary.hit / denominator) * 10000) / 10000 : null,
    hit_rate_denominator: denominator,
  };
}

function renderStats() {
  if (!state.index || state.indexError) {
    setStatText('—', '—', '—', '—', '—', '—');
    elements.loadedNote.textContent = '';
    return;
  }

  if (state.days.length === 0) {
    setStatText('0', '0', '0', '0', '—', '0');
    elements.loadedNote.textContent = '暂无归档数据';
    return;
  }

  const filterActive = isFilterActive();
  if (filterActive && state.loaded.size === 0) {
    setStatText('—', '—', '—', '—', '—', '—');
    elements.loadedNote.textContent = '正在加载归档数据…';
    return;
  }

  const useIndexTotals = !filterActive && state.loaded.size < state.days.length;
  const loadedRecords = useIndexTotals ? [] : getLoadedRecords();
  const filteredRecords = useIndexTotals ? [] : loadedRecords.filter(recordMatches);
  const summary = useIndexTotals ? summarizeIndexDays(state.days) : summarize(filteredRecords);

  setStatText(
    String(summary.push_total),
    String(summary.formal),
    String(summary.soft),
    String(summary.hit),
    summary.hit_rate_denominator ? `${(summary.hit_rate * 100).toFixed(1)}%` : '—',
    String(summary.pending)
  );

  const totalPush = state.days.reduce((sum, day) => sum + (Number(day.push_total) || 0), 0);

  if (useIndexTotals) {
    let note = `共 ${state.days.length} 天 · ${summary.push_total} 条记录`;
    note += state.loaded.size === 0 ? ' · 正在加载最新日期明细…' : ` · 已加载 ${state.loaded.size} 天明细`;
    elements.loadedNote.textContent = note;
    return;
  }

  let note = `已加载 ${state.loaded.size} / ${state.days.length} 天 · ${loadedRecords.length} / ${totalPush} 条记录`;
  if (filterActive) note += ` · 当前匹配 ${filteredRecords.length} 条`;
  if (state.bulkLoading) note += ' · 正在加载其余日期…';
  elements.loadedNote.textContent = note;
}

function setStatText(pushTotal, formal, soft, hit, hitRate, pending) {
  elements.statPushTotal.textContent = pushTotal;
  elements.statFormal.textContent = formal;
  elements.statSoft.textContent = soft;
  elements.statHit.textContent = hit;
  elements.statHitRate.textContent = hitRate;
  elements.statPending.textContent = pending;
}

function buildArchive() {
  elements.archiveList.innerHTML = '';
  state.dayElements.clear();

  for (const day of state.days) {
    const card = document.createElement('section');
    card.className = 'day-card';
    card.dataset.date = day.date;

    const bodyId = `day-body-${day.date}`;
    const pushTotal = Number(day.push_total) || 0;
    const formal = Number(day.formal) || 0;
    const soft = Number(day.soft) || 0;
    const settled = Number(day.settled) || 0;
    const weekday = weekdayCN(day.date) || '—';

    card.innerHTML = `
      <button type="button" class="day-head" aria-expanded="false" aria-controls="${bodyId}">
        <span class="day-date-block">
          <span class="day-date">${escapeHtml(day.date)}</span>
          <span class="day-weekday">${escapeHtml(weekday)}</span>
        </span>
        <span class="day-metrics">
          <span class="day-metric"><b>${pushTotal}</b> 推送</span>
          <span class="day-metric"><i class="dot dot-formal" aria-hidden="true"></i>强提醒 <b>${formal}</b></span>
          <span class="day-metric"><i class="dot dot-soft" aria-hidden="true"></i>软提醒 <b>${soft}</b></span>
          <span class="day-metric">已完场 <b>${settled}</b>/${pushTotal}</span>
        </span>
        <span class="chevron" aria-hidden="true"></span>
      </button>
      <div class="day-body" id="${bodyId}" hidden></div>
    `;

    const head = card.querySelector('.day-head');
    const body = card.querySelector('.day-body');
    head.addEventListener('click', () => toggleDay(day.date));

    elements.archiveList.appendChild(card);
    state.dayElements.set(day.date, { card, head, body });
  }
}

function showEmpty(show, text) {
  elements.emptyState.hidden = !show;
  if (show) elements.emptyStateText.textContent = text;
}

function renderArchive() {
  if (!state.index || state.indexError) {
    elements.archiveList.innerHTML = '';
    state.dayElements.clear();
    showEmpty(false, '');
    return;
  }

  if (state.days.length === 0) {
    elements.archiveList.innerHTML = '';
    state.dayElements.clear();
    showEmpty(true, '暂无归档数据');
    return;
  }

  const filterActive = isFilterActive();
  let visibleCount = 0;

  for (const day of state.days) {
    const entry = state.dayElements.get(day.date);
    if (!entry) continue;

    const records = state.loaded.get(day.date);
    const loading = state.loading.has(day.date);
    const failed = state.dayErrors.has(day.date);

    let visible = true;
    if (records) {
      if (records.length === 0 && !filterActive) visible = false;
      if (filterActive && !records.some(recordMatches)) visible = false;
    }

    entry.card.hidden = !visible;
    if (visible) visibleCount += 1;

    const expanded = visible && state.expandedDate === day.date;
    entry.head.setAttribute('aria-expanded', expanded ? 'true' : 'false');
    entry.body.hidden = !expanded;

    if (!expanded) {
      entry.body.innerHTML = '';
      continue;
    }

    if (loading) {
      entry.body.innerHTML = '<div class="day-loading">正在加载当日记录…</div>';
      continue;
    }

    if (failed) {
      entry.body.innerHTML = `
        <div class="day-error">
          <span>该日数据加载失败，请稍后重试</span>
          <button type="button" class="retry-btn" data-retry-date="${escapeHtml(day.date)}">重新加载</button>
        </div>
      `;
      continue;
    }

    if (!records) {
      entry.body.innerHTML = '<div class="day-loading">等待加载…</div>';
      continue;
    }

    const rows = records.filter(recordMatches);
    if (rows.length === 0) {
      entry.body.innerHTML = '<div class="day-empty">当前筛选条件下没有记录</div>';
      continue;
    }

    entry.body.innerHTML = tableHTML(day, rows);
  }

  if (visibleCount === 0) {
    showEmpty(true, filterActive ? '当前筛选条件下没有记录' : '暂无归档数据');
  } else {
    showEmpty(false, '');
  }
}

function tableHTML(day, records) {
  const head = TABLE_COLUMNS.map((column) => {
    const className = column.className ? ` class="${column.className}"` : '';
    return `<th scope="col"${className}>${escapeHtml(column.label)}</th>`;
  }).join('');
  const body = records.map(rowHTML).join('');

  return `
    <div class="table-wrap">
      <table class="records-table">
        <caption class="sr-only">${escapeHtml(day.date)} 推送记录</caption>
        <thead><tr>${head}</tr></thead>
        <tbody>${body}</tbody>
      </table>
    </div>
  `;
}

function rowHTML(record) {
  const vm = rowViewModel(record);
  const finalClass = vm.finalIsScore ? 'col-score num score-text' : 'col-score num pending-text';

  return `
    <tr>
      <td class="result-cell">${resultCellHTML(vm)}</td>
      <td class="col-time">${escapeHtml(vm.pushTime)}</td>
      <td><span class="level-badge level-${escapeHtml(vm.levelKey)}">${escapeHtml(vm.level)}</span></td>
      <td><span class="market-type">${escapeHtml(vm.type)}</span></td>
      <td class="col-match">${escapeHtml(vm.match)}</td>
      <td class="col-league">${escapeHtml(vm.league)}</td>
      <td class="col-minute num">${escapeHtml(vm.pushMoment)}</td>
      <td class="col-line num">${escapeHtml(vm.marketLine)}</td>
      <td class="${finalClass}">${escapeHtml(vm.finalScore)}</td>
      <td class="col-score num">${escapeHtml(vm.halfTimeScore)}</td>
      <td class="col-model num">${escapeHtml(vm.modelScore)}</td>
      <td class="col-class">${escapeHtml(vm.recordClass)}</td>
      <td class="col-goals num">${escapeHtml(vm.fullTimeGoals)}</td>
      <td class="col-goals num">${escapeHtml(vm.goalsAfterPush)}</td>
    </tr>
  `;
}

function resultCellHTML(vm) {
  if (vm.status === 'HIT' || vm.status === 'MISS') {
    const stampClass = vm.status === 'HIT' ? 'stamp-hit' : 'stamp-miss';
    return `<span class="stamp-wrap"><span class="stamp ${stampClass}" role="img" aria-label="${escapeHtml(vm.resultLabel)}">${escapeHtml(vm.resultLabel)}</span></span>`;
  }
  return `<span class="status-tag">${escapeHtml(vm.resultLabel)}</span>`;
}

function render() {
  renderStats();
  renderArchive();
  renderError();
}

function toggleDay(date) {
  if (state.expandedDate === date) {
    state.expandedDate = null;
    renderArchive();
    return;
  }

  state.expandedDate = date;
  renderArchive();

  if (!state.loaded.has(date) && !state.loading.has(date)) {
    loadDay(date).catch(() => {});
  }
}

function loadDay(date) {
  if (state.loaded.has(date)) return Promise.resolve(state.loaded.get(date));
  if (state.loading.has(date)) return state.loading.get(date);

  const day = state.days.find((item) => item.date === date);
  if (!day) return Promise.reject(new Error(`unknown day: ${date}`));

  const promise = fetchJSON(`data/live-results/${day.file}`)
    .then((payload) => {
      if (!payload || !Array.isArray(payload.records)) {
        throw new Error('invalid day payload');
      }
      const records = dedupeByPushId(payload.records)
        .slice()
        .sort((a, b) => timestamp(b.push_sent_at_utc) - timestamp(a.push_sent_at_utc));

      state.loaded.set(date, records);
      state.loading.delete(date);
      state.dayErrors.delete(date);
      markSuccess();
      render();
      return records;
    })
    .catch((error) => {
      state.loading.delete(date);
      state.dayErrors.set(date, error);
      render();
      throw error;
    });

  state.loading.set(date, promise);
  render();
  return promise;
}

async function ensureAllLoaded() {
  if (!state.index || state.indexError || state.days.length === 0) return;
  if (state.days.every((day) => state.loaded.has(day.date))) return;
  if (state.bulkLoading) return;

  state.bulkLoading = true;
  render();

  await Promise.all(state.days.map((day) => loadDay(day.date).catch(() => null)));

  state.bulkLoading = false;
  render();
}

function applyFilter(filter) {
  state.filter = filter;
  for (const button of elements.filterButtons) {
    const active = button.dataset.filter === filter;
    button.classList.toggle('is-active', active);
    button.setAttribute('aria-pressed', active ? 'true' : 'false');
  }

  render();
  if (isFilterActive()) ensureAllLoaded();
}

function handleSearchInput() {
  state.query = elements.searchInput.value;
  render();
  if (isFilterActive()) ensureAllLoaded();
}

function bindEvents() {
  for (const button of elements.filterButtons) {
    button.addEventListener('click', () => applyFilter(button.dataset.filter || 'all'));
  }

  elements.searchInput.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(handleSearchInput, 120);
  });

  elements.searchInput.addEventListener('search', () => {
    clearTimeout(searchTimer);
    handleSearchInput();
  });

  elements.archiveList.addEventListener('click', (event) => {
    if (!(event.target instanceof Element)) return;
    const retry = event.target.closest('[data-retry-date]');
    if (!retry) return;
    const date = retry.dataset.retryDate;
    state.dayErrors.delete(date);
    loadDay(date).catch(() => {});
  });
}

async function init() {
  bindEvents();
  render();

  try {
    const index = await fetchJSON(INDEX_PATH);
    if (!index || !Array.isArray(index.days)) throw new Error('invalid index payload');

    state.index = index;
    state.indexError = false;
    state.days = index.days
      .filter(
        (day) =>
          day &&
          isValidDateString(day.date) &&
          typeof day.file === 'string' &&
          day.file.startsWith('days/') &&
          Number(day.push_total) > 0
      )
      .sort((a, b) => b.date.localeCompare(a.date));

    updateLastUpdated(index.generated_at_utc);
    markSuccess();
    buildArchive();

    if (state.days.length > 0) {
      state.expandedDate = state.days[0].date;
      render();
      loadDay(state.expandedDate).catch(() => {});
      if (isFilterActive()) ensureAllLoaded();
    } else {
      state.expandedDate = null;
      render();
    }
  } catch (error) {
    state.indexError = true;
    state.index = null;
    state.days = [];
    updateLastUpdated('');
    render();
  }
}

init();
