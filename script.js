// ===== Supabase 配置 =====
const SUPABASE_URL = 'https://zvrmynxrbfsnejvsxohh.supabase.co';
const SUPABASE_KEY = 'sb_publishable_JnsPJ6L9etq6QpQW4ih5Gw_5ksDu4y8';
const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// ===== 应用配置 =====
const PASSWORD = '@@bao657564332';

// ===== 状态 =====
let editingId = null;
let currentFilter = 'all';
let isAdmin = false;
let cloudData = []; // 云端数据
let isLoading = true;

// ===== Toast =====
function toast(msg) {
    const t = document.getElementById('toast');
    t.textContent = msg;
    t.classList.add('show');
    setTimeout(() => t.classList.remove('show'), 2500);
}

// ===== 字段名映射（Supabase返回小写）=====
function normalizeRecord(r) {
    return {
        id: r.id,
        sport: r.sport || 'football',
        league: r.league || '',
        date: r.date || '',
        match: r.match || '',
        betType: r.bettype || r.betType || '',
        recommendation: r.recommendation || '',
        odds: r.odds || '',
        analysis: r.analysis || '',
        result: r.result || null,
        finalScore: r.finalscore || r.finalScore || null
    };
}

// ===== Supabase 数据操作 =====
async function loadFromCloud() {
    try {
        const { data, error } = await supabase
            .from('analyses')
            .select('*')
            .order('date', { ascending: false });
        
        if (error) throw error;
        cloudData = (data || []).map(normalizeRecord);
        isLoading = false;
        renderRecords();
        updateStats();
    } catch (err) {
        console.error('加载失败:', err);
        isLoading = false;
        cloudData = [];
        renderRecords();
        updateStats();
        toast('加载数据失败');
    }
}

async function saveToCloud(item) {
    try {
        const cloudItem = {
            id: item.id,
            sport: item.sport,
            league: item.league,
            date: item.date,
            match: item.match,
            bettype: item.betType,
            recommendation: item.recommendation,
            odds: item.odds,
            analysis: item.analysis || null,
            result: item.result,
            finalscore: item.finalScore
        };
        
        const { error } = await supabase
            .from('analyses')
            .upsert(cloudItem);
        
        if (error) throw error;
        await loadFromCloud();
        return true;
    } catch (err) {
        console.error('保存失败:', err);
        toast('保存失败');
        return false;
    }
}

async function deleteFromCloud(id) {
    try {
        const { error } = await supabase
            .from('analyses')
            .delete()
            .eq('id', id);
        
        if (error) throw error;
        await loadFromCloud();
        return true;
    } catch (err) {
        console.error('删除失败:', err);
        toast('删除失败');
        return false;
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

// ===== 统计 =====
function calcStats() {
    const finished = cloudData.filter(a => a.result !== null);
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
    const rec = a.recommendation || '';
    const odds = a.odds || '';
    
    let badge = '';
    if (!pending && a.result) {
        const txt = a.result === 'win' ? '命中' : a.result === 'lose' ? '未中' : '走水';
        badge = `<span class="rec-badge ${a.result}">${txt}</span>`;
    }
    
    let actions = '';
    if (isAdmin) {
        actions = `
            <div class="rec-actions">
                ${pending ? `<button class="rec-btn settle" data-id="${a.id}">结算</button>` : ''}
                <button class="rec-btn delete" data-id="${a.id}">删除</button>
            </div>
        `;
    }
    
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
            ${actions}
        </div>
    `;
}

function renderRecords() {
    if (isLoading) {
        document.getElementById('pendingList').innerHTML = '<div class="empty">加载中...</div>';
        document.getElementById('finishedList').innerHTML = '<div class="empty">加载中...</div>';
        document.getElementById('pendingCount').textContent = '-';
        document.getElementById('finishedCount').textContent = '-';
        return;
    }
    
    const pending = cloudData.filter(a => a.result === null);
    const finished = cloudData.filter(a => a.result !== null);
    
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
    document.querySelectorAll('.rec-card').forEach(card => {
        const settleBtn = card.querySelector('.rec-btn.settle');
        const deleteBtn = card.querySelector('.rec-btn.delete');
        
        if (settleBtn) {
            settleBtn.onclick = (e) => {
                e.stopPropagation();
                const id = parseInt(settleBtn.dataset.id);
                const a = cloudData.find(x => x.id === id);
                if (!isMatchStarted(a.date)) {
                    toast('比赛尚未开始');
                    return;
                }
                openSettleModal(id);
            };
        }
        
        if (deleteBtn) {
            deleteBtn.onclick = async (e) => {
                e.stopPropagation();
                if (confirm('确定删除？')) {
                    const id = parseInt(deleteBtn.dataset.id);
                    await deleteFromCloud(id);
                    toast('已删除');
                }
            };
        }
    });
}

// ===== 结算弹窗 =====
function openSettleModal(id) {
    editingId = id;
    const a = cloudData.find(x => x.id === id);
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

async function doSettle() {
    const active = document.querySelector('.r-btn.active');
    if (!active) {
        toast('请选择结果');
        return;
    }
    
    const result = active.dataset.r;
    const score = document.getElementById('finalScore').value.trim();
    
    const a = cloudData.find(x => x.id === editingId);
    if (a) {
        a.result = result;
        a.finalScore = score || null;
        await saveToCloud(a);
        toast(result === 'win' ? '🎉 命中！' : result === 'push' ? '走水' : '未命中');
    }
    
    closeSettleModal();
}

// ===== 表单 =====
function initForm() {
    document.getElementById('matchDate').valueAsDate = new Date();
    document.getElementById('matchTime').value = '00:00';
    
    document.getElementById('analysisForm').onsubmit = async (e) => {
        e.preventDefault();
        
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
        
        const dateTime = `${date}T${time || '00:00'}:00`;
        
        let sport = 'football';
        if (['overunder', 'handicap'].includes(betType)) sport = 'basketball';
        
        const item = {
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
        };
        
        const ok = await saveToCloud(item);
        if (ok) {
            document.getElementById('analysisForm').reset();
            document.getElementById('matchDate').valueAsDate = new Date();
            document.getElementById('matchTime').value = '00:00';
            toast('保存成功');
        }
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

// ===== 管理模式 =====
function setAdminMode(enabled) {
    isAdmin = enabled;
    const lockBtn = document.getElementById('lockBtn');
    const formSection = document.querySelector('#formSection');
    
    if (enabled) {
        lockBtn.textContent = '🔓';
        lockBtn.classList.add('unlocked');
        formSection.style.display = 'block';
        document.getElementById('pwdModal').classList.remove('active');
    } else {
        lockBtn.textContent = '🔒';
        lockBtn.classList.remove('unlocked');
        formSection.style.display = 'none';
    }
    
    renderRecords();
}

function initAdminMode() {
    const lockBtn = document.getElementById('lockBtn');
    const pwdModal = document.getElementById('pwdModal');
    const pwdClose = document.getElementById('pwdClose');
    const pwdSubmit = document.getElementById('pwdSubmit');
    const pwdInput = document.getElementById('pwdInput');
    
    lockBtn.onclick = () => {
        if (isAdmin) {
            setAdminMode(false);
        } else {
            pwdInput.value = '';
            pwdModal.classList.add('active');
            pwdInput.focus();
        }
    };
    
    pwdClose.onclick = () => pwdModal.classList.remove('active');
    pwdModal.querySelector('.modal-overlay').onclick = () => pwdModal.classList.remove('active');
    
    pwdSubmit.onclick = () => {
        if (pwdInput.value === PASSWORD) {
            setAdminMode(true);
            toast('已解锁管理模式');
        } else {
            toast('密码错误');
            pwdInput.value = '';
        }
    };
    
    pwdInput.onkeydown = e => {
        if (e.key === 'Enter') pwdSubmit.click();
    };
}

// ===== 初始化 =====
document.addEventListener('DOMContentLoaded', () => {
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
    initAdminMode();
    
    // 从云端加载数据
    loadFromCloud();
});
