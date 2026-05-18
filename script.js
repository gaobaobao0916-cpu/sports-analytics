// ===== 配置 =====
const PASSWORD = '@@bao657564332';
const STORAGE_KEY = 'sports_analytics_v1';
const LOCK_KEY = 'sports_unlocked';

// ===== 状态 =====
let isUnlocked = false;
let editingId = null;
let currentFilter = 'all';
let currentSport = 'football';

// ===== 数据存储 =====
function getData() {
    try {
        const d = localStorage.getItem(STORAGE_KEY);
        return d ? JSON.parse(d) : { analyses: [] };
    } catch {
        return { analyses: [] };
    }
}

function saveData(d) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(d));
    // 后台静默同步
    const cfg = getSyncConfig();
    if (cfg.token && cfg.gistId) {
        pushToGist().catch(() => {});
    }
}

// ===== 类型映射 =====
const TYPE_MAP = {
    asia: { label: '亚盘', cls: 'g' },
    lottery: { label: '竞彩', cls: 'b' },
    overunder: { label: '大小分', cls: 'o' },
    handicap: { label: '让球', cls: 'g' }
};

const SPORT_MAP = {
    football: '⚽',
    basketball: '🏀'
};

// ===== Toast =====
function toast(msg) {
    const t = document.getElementById('toast');
    t.textContent = msg;
    t.classList.add('show');
    setTimeout(() => t.classList.remove('show'), 2500);
}

// ===== 密码验证 =====
function checkUnlock() {
    isUnlocked = sessionStorage.getItem(LOCK_KEY) === '1';
    updateUI();
}

function updateUI() {
    const pwdModal = document.getElementById('pwdModal');
    const unlockedBar = document.getElementById('unlockedBar');
    const formSection = document.getElementById('formSection');
    
    if (isUnlocked) {
        pwdModal.classList.remove('active');
        unlockedBar.classList.remove('hidden');
        formSection.classList.remove('hidden');
    } else {
        pwdModal.classList.remove('active');
        unlockedBar.classList.add('hidden');
        formSection.classList.add('hidden');
    }
    
    renderRecords();
}

function openPwdModal() {
    document.getElementById('pwdModal').classList.add('active');
    document.getElementById('pwdInput').value = '';
    document.getElementById('pwdError').textContent = '';
    setTimeout(() => document.getElementById('pwdInput').focus(), 100);
}

function closePwdModal() {
    document.getElementById('pwdModal').classList.remove('active');
}

function doUnlock() {
    const pw = document.getElementById('pwdInput').value;
    const err = document.getElementById('pwdError');
    
    if (pw === PASSWORD) {
        sessionStorage.setItem(LOCK_KEY, '1');
        isUnlocked = true;
        err.textContent = '';
        updateUI();
        toast('已解锁');
        document.getElementById('formSection').scrollIntoView({ behavior: 'smooth' });
    } else {
        err.textContent = '密码错误';
        document.getElementById('pwdInput').value = '';
        document.getElementById('pwdInput').focus();
    }
}

function doLock() {
    sessionStorage.removeItem(LOCK_KEY);
    isUnlocked = false;
    updateUI();
    toast('已锁定');
}

// ===== 统计 =====
function calcStats() {
    const d = getData();
    const finished = d.analyses.filter(a => a.result !== null);
    const wins = finished.filter(a => a.result === 'win');
    const total = finished.length;
    const winCount = wins.length;
    const rate = total > 0 ? Math.round(winCount / total * 100) : 0;
    
    let streak = 0;
    [...finished].sort((a, b) => b.id - a.id).forEach(a => {
        if (a.result === 'win') streak++;
        else return;
    });
    
    function catRate(sport, type) {
        const items = finished.filter(a => a.sport === sport && a.betType === type);
        if (!items.length) return '--';
        return Math.round(items.filter(a => a.result === 'win').length / items.length * 100) + '%';
    }
    
    return { total, winCount, rate, streak, 
        fbAsia: catRate('football', 'asia'),
        fbLot: catRate('football', 'lottery'),
        bkOu: catRate('basketball', 'overunder'),
        bkHc: catRate('basketball', 'handicap')
    };
}

function updateStats() {
    const s = calcStats();
    
    document.getElementById('totalCount').textContent = s.total;
    document.getElementById('winCount').textContent = s.winCount;
    document.getElementById('winRate').textContent = s.rate + '%';
    document.getElementById('streakCount').textContent = s.streak;
    
    document.getElementById('fbAsiaRate').textContent = s.fbAsia;
    document.getElementById('fbLotteryRate').textContent = s.fbLot;
    document.getElementById('bkOuRate').textContent = s.bkOu;
    document.getElementById('bkHandicapRate').textContent = s.bkHc;
}

// ===== 记录 =====
function isMatchStarted(dateStr) {
    if (!dateStr) return false;
    const md = new Date(dateStr);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return md <= today;
}

function formatDateTime(dateStr) {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const hour = String(d.getHours()).padStart(2, '0');
    const min = String(d.getMinutes()).padStart(2, '0');
    return `${year}年${month}月${day}日 ${hour}:${min}`;
}

function createRecHTML(a, pending) {
    const t = TYPE_MAP[a.betType] || { label: a.betType, cls: '' };
    const icon = SPORT_MAP[a.sport] || '📋';
    const dateTime = a.date ? formatDateTime(a.date) : '';
    const started = isMatchStarted(a.date);
    const canOp = isUnlocked && started;
    const rec = a.recommendation || '';
    const odds = a.odds || '';
    
    let badge = '';
    if (!pending && a.result) {
        const txt = a.result === 'win' ? '命中' : a.result === 'lose' ? '未中' : '走水';
        badge = `<span class="rec-badge ${a.result}">${txt}</span>`;
    }
    
    const settleCls = canOp ? 'rec-btn settle' : 'rec-btn settle locked';
    const delCls = isUnlocked ? 'rec-btn delete' : 'rec-btn delete locked';
    
    return `
        <div class="rec-card">
            <div class="rec-icon">${icon}</div>
            <div class="rec-info">
                <div class="rec-match">${icon} ${a.match || '未命名'}</div>
                <div class="rec-meta">
                    <span class="rec-tag ${t.cls}">${t.label}</span>
                    <span class="rec-date">${a.league} · ${dateTime}</span>
                    ${pending && !started ? '<span class="rec-tag o">未开赛</span>' : ''}
                </div>
                ${rec ? `<div class="rec-recommendation">推荐：${rec}${odds ? ' @' + odds : ''}</div>` : ''}
            </div>
            ${badge}
            <div class="rec-actions">
                ${pending ? `<button class="${settleCls}" data-id="${a.id}">结算</button>` : ''}
                <button class="${delCls}" data-id="${a.id}">删除</button>
            </div>
        </div>
    `;
}

function renderRecords() {
    const d = getData();
    const pending = d.analyses.filter(a => a.result === null);
    const finished = d.analyses.filter(a => a.result !== null);
    
    document.getElementById('pendingCount').textContent = pending.length;
    document.getElementById('finishedCount').textContent = finished.length;
    
    function filter(list) {
        if (currentFilter === 'all') return list;
        if (currentFilter === 'pending') return list.filter(a => a.result === null);
        if (currentFilter === 'win') return list.filter(a => a.result === 'win');
        if (currentFilter === 'lose') return list.filter(a => a.result === 'lose');
        return list.filter(a => a.sport === currentFilter);
    }
    
    const pList = document.getElementById('pendingList');
    const fList = document.getElementById('finishedList');
    
    pList.innerHTML = filter(pending).length 
        ? filter(pending).map(a => createRecHTML(a, true)).join('')
        : '<div class="empty">暂无待结算记录</div>';
    
    fList.innerHTML = filter(finished).length 
        ? filter(finished).map(a => createRecHTML(a, false)).join('')
        : '<div class="empty">暂无已结算记录</div>';
    
    bindRecEvents();
}

function bindRecEvents() {
    // 使用事件委托，更可靠
    document.querySelectorAll('.rec-card').forEach(card => {
        const settleBtn = card.querySelector('.rec-btn.settle');
        const deleteBtn = card.querySelector('.rec-btn.delete');
        
        if (settleBtn) {
            settleBtn.onclick = (e) => {
                e.stopPropagation();
                const id = parseInt(settleBtn.dataset.id);
                if (settleBtn.classList.contains('locked')) {
                    if (!isUnlocked) {
                        toast('请先解锁');
                        openPwdModal();
                    } else {
                        toast('比赛尚未开始');
                    }
                    return;
                }
                const d = getData();
                const a = d.analyses.find(x => x.id === id);
                if (!isMatchStarted(a.date)) {
                    toast('比赛尚未开始');
                    return;
                }
                openSettleModal(id);
            };
        }
        
        if (deleteBtn) {
            deleteBtn.onclick = (e) => {
                e.stopPropagation();
                console.log('删除按钮点击', deleteBtn.classList.contains('locked'), isUnlocked);
                if (deleteBtn.classList.contains('locked')) {
                    if (!isUnlocked) {
                        toast('请先解锁');
                        openPwdModal();
                    }
                    return;
                }
                if (confirm('确定删除？')) {
                    const id = parseInt(deleteBtn.dataset.id);
                    console.log('执行删除, id:', id);
                    const d = getData();
                    d.analyses = d.analyses.filter(a => a.id !== id);
                    saveData(d);
                    renderRecords();
                    updateStats();
                    toast('已删除');
                }
            };
        }
    });
}

// ===== 结算弹窗 =====
function openSettleModal(id) {
    editingId = id;
    const d = getData();
    const a = d.analyses.find(x => x.id === id);
    if (!a) return;
    
    document.getElementById('modalMatch').innerHTML = 
        `${SPORT_MAP[a.sport] || ''} <strong>${a.match}</strong> · ${a.recommendation}`;
    
    document.querySelectorAll('.r-btn').forEach(b => b.classList.remove('active'));
    document.getElementById('finalScore').value = '';
    
    document.getElementById('settleModal').classList.add('active');
}

function closeSettleModal() {
    document.getElementById('settleModal').classList.remove('active');
    editingId = null;
}

function doSettle() {
    if (!isUnlocked) {
        toast('请先解锁');
        closeSettleModal();
        return;
    }
    
    const active = document.querySelector('.r-btn.active');
    if (!active) {
        toast('请选择结果');
        return;
    }
    
    const result = active.dataset.r;
    const score = document.getElementById('finalScore').value.trim();
    
    const d = getData();
    const a = d.analyses.find(x => x.id === editingId);
    if (a) {
        a.result = result;
        a.finalScore = score || null;
        saveData(d);
        renderRecords();
        updateStats();
        toast(result === 'win' ? '🎉 命中！' : result === 'push' ? '走水' : '未命中');
    }
    
    closeSettleModal();
}

// ===== 表单 =====
function initForm() {
    document.getElementById('matchDate').valueAsDate = new Date();
    document.getElementById('matchTime').value = '00:00';
    
    document.getElementById('analysisForm').onsubmit = e => {
        e.preventDefault();
        
        if (!isUnlocked) {
            toast('请先解锁');
            openPwdModal();
            return;
        }
        
        const league = document.getElementById('league').value.trim();
        const date = document.getElementById('matchDate').value;
        const time = document.getElementById('matchTime').value;
        const match = document.getElementById('matchTeams').value.trim();
        const betType = document.getElementById('betType').value;
        const rec = document.getElementById('recommendation').value.trim();
        const odds = document.getElementById('odds').value.trim();
        const analysis = document.getElementById('analysisText').value.trim();
        
        if (!league || !date || !match || !betType || !rec) {
            toast('请填写必填项');
            return;
        }
        
        // 组合日期和时间
        const dateTime = `${date}T${time || '00:00'}:00`;
        
        // 根据类型自动设置运动类型
        let sport = 'football';
        if (['overunder', 'handicap'].includes(betType)) sport = 'basketball';
        
        const d = getData();
        d.analyses.push({
            id: Date.now(),
            sport,
            league,
            date: dateTime,
            match,
            betType,
            recommendation: rec,
            odds,
            analysis,
            result: null,
            finalScore: null
        });
        saveData(d);
        
        document.getElementById('analysisForm').reset();
        document.getElementById('matchDate').valueAsDate = new Date();
        document.getElementById('matchTime').value = '00:00';
        
        renderRecords();
        updateStats();
        toast('保存成功');
    };
}

// ===== 筛选 =====
function initFilters() {
    document.querySelectorAll('.filter').forEach(btn => {
        btn.onclick = () => {
            document.querySelectorAll('.filter').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            currentFilter = btn.dataset.f;
            renderRecords();
        };
    });
}

// ===== 复制 =====
function initCopy() {
    document.querySelectorAll('.copy-btn').forEach(btn => {
        btn.onclick = () => {
            navigator.clipboard.writeText(btn.dataset.n).then(() => {
                toast('已复制：' + btn.dataset.n);
            });
        };
    });
}

// ===== 初始化 =====
document.addEventListener('DOMContentLoaded', () => {
    // 密码相关
    document.getElementById('addBtn').onclick = () => {
        if (isUnlocked) {
            document.getElementById('formSection').scrollIntoView({ behavior: 'smooth' });
        } else {
            openPwdModal();
        }
    };
    
    document.getElementById('pwdSubmit').onclick = doUnlock;
    document.getElementById('pwdClose').onclick = closePwdModal;
    document.getElementById('pwdInput').onkeypress = e => { if (e.key === 'Enter') doUnlock(); };
    document.querySelector('.pwd-overlay').onclick = closePwdModal;
    
    document.getElementById('lockBtn').onclick = doLock;
    
    // 结算弹窗
    document.getElementById('modalClose').onclick = closeSettleModal;
    document.getElementById('modalCancel').onclick = closeSettleModal;
    document.querySelector('#settleModal .modal-overlay').onclick = closeSettleModal;
    
    document.querySelectorAll('.r-btn').forEach(btn => {
        btn.onclick = () => {
            document.querySelectorAll('.r-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
        };
    });
    
    document.getElementById('modalConfirm').onclick = doSettle;
    
    // 初始化
    initForm();
    initFilters();
    initCopy();
    
    checkUnlock();
    
    // 尝试从云端拉取数据
    const cfg = getSyncConfig();
    if (cfg.token && cfg.gistId) {
        pullFromGist().then(() => {
            renderRecords();
            updateStats();
        }).catch(() => {
            renderRecords();
            updateStats();
        });
    } else {
        renderRecords();
        updateStats();
    }
    
    initSync();
});

// ===== 云端同步 =====
const SYNC_CONFIG_KEY = 'sports_sync_config';
const GIST_FILENAME = 'sports_analytics_data.json';

function getSyncConfig() {
    try {
        const c = localStorage.getItem(SYNC_CONFIG_KEY);
        return c ? JSON.parse(c) : { token: '', gistId: '' };
    } catch {
        return { token: '', gistId: '' };
    }
}

function saveSyncConfig(cfg) {
    localStorage.setItem(SYNC_CONFIG_KEY, JSON.stringify(cfg));
}

async function apiRequest(url, method, token, body) {
    const opts = {
        method,
        headers: {
            'Authorization': `token ${token}`,
            'Accept': 'application/vnd.github.v3+json',
            'Content-Type': 'application/json'
        }
    };
    if (body) opts.body = JSON.stringify(body);
    const res = await fetch(url, opts);
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || `HTTP ${res.status}`);
    }
    return res.json();
}

async function createGist(token) {
    const data = {
        description: '博弈增强型分析模型 - 赛事数据',
        public: false,
        files: {
            [GIST_FILENAME]: {
                content: JSON.stringify({ analyses: [] })
            }
        }
    };
    const gist = await apiRequest('https://api.github.com/gists', 'POST', token, data);
    return gist.id;
}

async function pushToGist() {
    const cfg = getSyncConfig();
    if (!cfg.token) throw new Error('未配置 Token');
    
    let gistId = cfg.gistId;
    if (!gistId) {
        gistId = await createGist(cfg.token);
        cfg.gistId = gistId;
        saveSyncConfig(cfg);
    }
    
    const d = getData();
    await apiRequest(`https://api.github.com/gists/${gistId}`, 'PATCH', cfg.token, {
        files: {
            [GIST_FILENAME]: {
                content: JSON.stringify(d, null, 2)
            }
        }
    });
    return gistId;
}

async function pullFromGist() {
    const cfg = getSyncConfig();
    if (!cfg.token) throw new Error('未配置 Token');
    if (!cfg.gistId) throw new Error('未配置 Gist ID，请先推送一次');
    
    const gist = await apiRequest(`https://api.github.com/gists/${cfg.gistId}`, 'GET', cfg.token);
    const file = gist.files[GIST_FILENAME];
    if (!file) throw new Error('Gist 中未找到数据文件');
    
    const data = JSON.parse(file.content);
    saveData(data);
    return data;
}

function setSyncStatus(msg, type) {
    const el = document.getElementById('syncStatus');
    el.textContent = msg;
    el.className = 'sync-status ' + (type || '');
}

function initSync() {
    const cfg = getSyncConfig();
    document.getElementById('githubToken').value = cfg.token || '';
    document.getElementById('gistId').value = cfg.gistId || '';
    
    const openSync = () => {
        document.getElementById('syncModal').classList.add('active');
        setSyncStatus('');
    };
    const closeSync = () => {
        document.getElementById('syncModal').classList.remove('active');
    };
    
    document.getElementById('syncBtn').onclick = openSync;
    document.getElementById('syncClose').onclick = closeSync;
    document.getElementById('syncCancel').onclick = closeSync;
    document.querySelector('#syncModal .modal-overlay').onclick = closeSync;
    
    document.getElementById('syncTest').onclick = async () => {
        const token = document.getElementById('githubToken').value.trim();
        if (!token) { setSyncStatus('请输入 Token', 'err'); return; }
        setSyncStatus('测试中...', 'info');
        try {
            await apiRequest('https://api.github.com/user', 'GET', token);
            setSyncStatus('✓ Token 有效', 'ok');
        } catch (e) {
            setSyncStatus('✗ ' + e.message, 'err');
        }
    };
    
    document.getElementById('syncPush').onclick = async () => {
        const token = document.getElementById('githubToken').value.trim();
        const gistId = document.getElementById('gistId').value.trim();
        if (!token) { setSyncStatus('请输入 Token', 'err'); return; }
        saveSyncConfig({ token, gistId });
        setSyncStatus('推送中...', 'info');
        try {
            const id = await pushToGist();
            document.getElementById('gistId').value = id;
            saveSyncConfig({ token, gistId: id });
            setSyncStatus(`✓ 已推送，Gist ID: ${id.slice(0, 8)}...`, 'ok');
        } catch (e) {
            setSyncStatus('✗ ' + e.message, 'err');
        }
    };
    
    document.getElementById('syncPull').onclick = async () => {
        const token = document.getElementById('githubToken').value.trim();
        const gistId = document.getElementById('gistId').value.trim();
        if (!token) { setSyncStatus('请输入 Token', 'err'); return; }
        saveSyncConfig({ token, gistId });
        setSyncStatus('拉取中...', 'info');
        try {
            await pullFromGist();
            renderRecords();
            updateStats();
            setSyncStatus('✓ 拉取成功，数据已更新', 'ok');
        } catch (e) {
            setSyncStatus('✗ ' + e.message, 'err');
        }
    };
}
