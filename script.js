// ===== 配置 =====
const PASSWORD = '@@bao657564332';
const STORAGE_KEY = 'sports_analytics_v1';
const LOCK_KEY = 'sports_analytics_unlocked';

// ===== 数据存储 =====
function getData() {
    try {
        const data = localStorage.getItem(STORAGE_KEY);
        return data ? JSON.parse(data) : { analyses: [] };
    } catch {
        return { analyses: [] };
    }
}

function saveData(data) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

// ===== 类型映射 =====
const TYPE_MAP = {
    asia: { label: '亚盘', class: 'asia' },
    lottery: { label: '竞彩', class: 'lottery' },
    overunder: { label: '大小分', class: 'overunder' },
    handicap: { label: '让球', class: 'handicap' }
};

const SPORT_MAP = {
    football: '⚽',
    basketball: '🏀'
};

// ===== 密码锁 =====
function checkLock() {
    const unlocked = sessionStorage.getItem(LOCK_KEY) === 'true';
    if (unlocked) {
        document.getElementById('lockOverlay').classList.add('hidden');
        document.getElementById('loginBar').style.display = 'flex';
    }
}

function attemptUnlock() {
    const input = document.getElementById('lockPassword');
    const error = document.getElementById('lockError');
    const password = input.value;

    if (password === PASSWORD) {
        sessionStorage.setItem(LOCK_KEY, 'true');
        document.getElementById('lockOverlay').classList.add('hidden');
        document.getElementById('loginBar').style.display = 'flex';
        error.textContent = '';
        input.value = '';
    } else {
        error.textContent = '密码错误，请重试';
        input.value = '';
        input.focus();
    }
}

function logout() {
    sessionStorage.removeItem(LOCK_KEY);
    document.getElementById('lockOverlay').classList.remove('hidden');
    document.getElementById('loginBar').style.display = 'none';
}

// ===== Toast =====
function showToast(message) {
    const toast = document.getElementById('toast');
    toast.textContent = message;
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), 2500);
}

// ===== 背景粒子 =====
(function initParticles() {
    const canvas = document.getElementById('bgCanvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    let particles = [];
    const PARTICLE_COUNT = 50;
    const CONNECTION_DIST = 110;

    function resize() {
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;
    }

    class Particle {
        constructor() { this.reset(); }
        reset() {
            this.x = Math.random() * canvas.width;
            this.y = Math.random() * canvas.height;
            this.vx = (Math.random() - 0.5) * 0.4;
            this.vy = (Math.random() - 0.5) * 0.4;
            this.radius = Math.random() * 1.2 + 0.4;
            this.opacity = Math.random() * 0.25 + 0.08;
        }
        update() {
            this.x += this.vx; this.y += this.vy;
            if (this.x < 0 || this.x > canvas.width) this.vx *= -1;
            if (this.y < 0 || this.y > canvas.height) this.vy *= -1;
        }
        draw() {
            ctx.beginPath();
            ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
            ctx.fillStyle = `rgba(212, 168, 83, ${this.opacity})`;
            ctx.fill();
        }
    }

    function drawConnections() {
        for (let i = 0; i < particles.length; i++) {
            for (let j = i + 1; j < particles.length; j++) {
                const dx = particles[i].x - particles[j].x;
                const dy = particles[i].y - particles[j].y;
                const dist = Math.sqrt(dx * dx + dy * dy);
                if (dist < CONNECTION_DIST) {
                    const opacity = (1 - dist / CONNECTION_DIST) * 0.06;
                    ctx.beginPath();
                    ctx.moveTo(particles[i].x, particles[i].y);
                    ctx.lineTo(particles[j].x, particles[j].y);
                    ctx.strokeStyle = `rgba(212, 168, 83, ${opacity})`;
                    ctx.lineWidth = 0.5;
                    ctx.stroke();
                }
            }
        }
    }

    function init() {
        resize();
        particles = [];
        for (let i = 0; i < PARTICLE_COUNT; i++) particles.push(new Particle());
    }

    function animate() {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        particles.forEach(p => { p.update(); p.draw(); });
        drawConnections();
        requestAnimationFrame(animate);
    }

    window.addEventListener('resize', resize);
    init();
    animate();
})();

// ===== 统计计算 =====
function calculateStats() {
    const data = getData();
    const analyses = data.analyses;
    const finished = analyses.filter(a => a.result !== null && a.result !== undefined);
    const wins = finished.filter(a => a.result === 'win');
    const total = finished.length;
    const winCount = wins.length;
    const rate = total > 0 ? Math.round((winCount / total) * 100) : 0;

    let streak = 0;
    const sorted = [...finished].sort((a, b) => b.id - a.id);
    for (const a of sorted) {
        if (a.result === 'win') streak++;
        else break;
    }

    function catRate(sport, type) {
        const items = finished.filter(a => a.sport === sport && a.betType === type);
        if (items.length === 0) return '--';
        const w = items.filter(a => a.result === 'win').length;
        return Math.round((w / items.length) * 100) + '%';
    }

    return {
        total, winCount, rate, streak,
        fbAsiaRate: catRate('football', 'asia'),
        fbLotteryRate: catRate('football', 'lottery'),
        bkOuRate: catRate('basketball', 'overunder'),
        bkHandicapRate: catRate('basketball', 'handicap')
    };
}

function updateStats() {
    const s = calculateStats();

    animateNumber('totalCount', s.total);
    animateNumber('winCount', s.winCount);
    animateNumber('streakCount', s.streak);

    document.getElementById('winRate').textContent = s.rate + '%';
    document.getElementById('rateText').textContent = s.rate + '%';

    const circle = document.getElementById('rateCircle');
    const circumference = 2 * Math.PI * 50;
    const offset = circumference - (s.rate / 100) * circumference;
    circle.style.strokeDashoffset = offset;

    document.getElementById('totalBar').style.width = '100%';
    document.getElementById('winBar').style.width = s.total > 0 ? ((s.winCount / s.total) * 100) + '%' : '0%';

    document.getElementById('fbAsiaRate').textContent = s.fbAsiaRate;
    document.getElementById('fbLotteryRate').textContent = s.fbLotteryRate;
    document.getElementById('bkOuRate').textContent = s.bkOuRate;
    document.getElementById('bkHandicapRate').textContent = s.bkHandicapRate;
}

function animateNumber(id, target) {
    const el = document.getElementById(id);
    const start = parseInt(el.textContent) || 0;
    if (start === target) return;
    const duration = 600;
    const startTime = performance.now();

    function step(now) {
        const progress = Math.min((now - startTime) / duration, 1);
        const ease = 1 - Math.pow(1 - progress, 3);
        el.textContent = Math.round(start + (target - start) * ease);
        if (progress < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
}

// ===== 记录渲染 =====
let currentFilter = 'all';
let editingId = null;

function renderRecords() {
    const data = getData();
    const analyses = data.analyses;

    const pending = analyses.filter(a => a.result === null || a.result === undefined);
    const finished = analyses.filter(a => a.result !== null && a.result !== undefined);

    // 更新计数
    document.getElementById('pendingCount').textContent = pending.length;
    document.getElementById('finishedCount').textContent = finished.length;

    function filterList(list) {
        if (currentFilter === 'all') return list;
        if (currentFilter === 'pending') return list.filter(a => a.result === null || a.result === undefined);
        if (currentFilter === 'win') return list.filter(a => a.result === 'win');
        if (currentFilter === 'lose') return list.filter(a => a.result === 'lose');
        return list.filter(a => a.sport === currentFilter);
    }

    const filteredPending = filterList(pending);
    const filteredFinished = filterList(finished);

    const pendingList = document.getElementById('pendingList');
    const finishedList = document.getElementById('finishedList');

    pendingList.innerHTML = filteredPending.length
        ? filteredPending.map(a => createRecordHTML(a, true)).join('')
        : '<div class="empty-state small"><p>暂无待结算记录</p></div>';

    finishedList.innerHTML = filteredFinished.length
        ? filteredFinished.map(a => createRecordHTML(a, false)).join('')
        : '<div class="empty-state small"><p>暂无已结算记录</p></div>';

    // 绑定事件
    document.querySelectorAll('.settle-btn').forEach(btn => {
        btn.addEventListener('click', () => openModal(parseInt(btn.dataset.id)));
    });
    document.querySelectorAll('.delete-btn').forEach(btn => {
        btn.addEventListener('click', () => deleteRecord(parseInt(btn.dataset.id)));
    });
}

function createRecordHTML(a, isPending) {
    const typeInfo = TYPE_MAP[a.betType] || { label: a.betType, class: '' };
    const sportIcon = SPORT_MAP[a.sport] || '📋';
    const sportLabel = a.sport === 'football' ? '足球' : '篮球';
    const dateStr = a.date ? new Date(a.date).toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' }) : '';

    let resultHTML = '';
    if (!isPending && a.result) {
        const badgeText = a.result === 'win' ? '命中' : a.result === 'lose' ? '未中' : '走水';
        resultHTML = `
            <span class="result-badge ${a.result}">${badgeText}</span>
            ${a.finalScore ? `<div class="final-score">${a.finalScore}</div>` : ''}
        `;
    }

    return `
        <div class="record-card" data-id="${a.id}">
            <div class="record-sport" title="${sportLabel}">${sportIcon}</div>
            <div class="record-info">
                <div class="record-match">${sportIcon} ${a.match || '未命名比赛'}</div>
                <div class="record-meta">
                    <span class="record-tag ${typeInfo.class}">${typeInfo.label}</span>
                    <span class="record-date">${a.league || ''} · ${dateStr}</span>
                </div>
            </div>
            <div class="record-rec">${a.recommendation || ''}</div>
            <div class="record-actions">
                ${isPending
                    ? `<button class="action-btn settle-btn" data-id="${a.id}">结算</button>`
                    : resultHTML
                }
                <button class="action-btn delete-btn" data-id="${a.id}">删除</button>
            </div>
        </div>
    `;
}

function deleteRecord(id) {
    if (!confirm('确定要删除这条记录吗？')) return;
    const data = getData();
    data.analyses = data.analyses.filter(a => a.id !== id);
    saveData(data);
    renderRecords();
    updateStats();
    showToast('记录已删除');
}

// ===== 弹窗 =====
function openModal(id) {
    editingId = id;
    const data = getData();
    const a = data.analyses.find(x => x.id === id);
    if (!a) return;

    const sportIcon = SPORT_MAP[a.sport] || '';
    document.getElementById('modalMatchInfo').innerHTML =
        `${sportIcon} <strong>${a.match || '未命名'}</strong> · ${a.recommendation || ''}`;

    document.querySelectorAll('.result-btn').forEach(b => b.classList.remove('active'));
    document.getElementById('finalScore').value = '';

    document.getElementById('resultModal').classList.add('active');
}

function closeModal() {
    document.getElementById('resultModal').classList.remove('active');
    editingId = null;
}

// ===== 表单 =====
let currentSport = 'football';

function initForm() {
    document.getElementById('matchDate').valueAsDate = new Date();

    document.querySelectorAll('.form-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('.form-tab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            currentSport = tab.dataset.sport;
        });
    });

    document.getElementById('betType').addEventListener('change', function() {
        const val = this.value;
        if (['asia', 'lottery'].includes(val)) {
            switchTab('football');
        } else if (['overunder', 'handicap'].includes(val)) {
            switchTab('basketball');
        }
    });

    document.getElementById('analysisForm').addEventListener('submit', e => {
        e.preventDefault();
        addRecord();
    });
}

function switchTab(sport) {
    currentSport = sport;
    document.querySelectorAll('.form-tab').forEach(t => {
        t.classList.toggle('active', t.dataset.sport === sport);
    });
}

function addRecord() {
    const league = document.getElementById('league').value.trim();
    const date = document.getElementById('matchDate').value;
    const match = document.getElementById('matchTeams').value.trim();
    const betType = document.getElementById('betType').value;
    const recommendation = document.getElementById('recommendation').value.trim();
    const odds = document.getElementById('odds').value.trim();
    const analysis = document.getElementById('analysisText').value.trim();

    if (!league || !date || !match || !betType || !recommendation) {
        showToast('请填写完整信息');
        return;
    }

    const data = getData();
    data.analyses.push({
        id: Date.now(),
        sport: currentSport,
        league,
        date,
        match,
        betType,
        recommendation,
        odds,
        analysis,
        result: null,
        finalScore: null
    });
    saveData(data);

    document.getElementById('analysisForm').reset();
    document.getElementById('matchDate').valueAsDate = new Date();

    renderRecords();
    updateStats();
    showToast('分析记录已保存');
}

// ===== 结算 =====
function initModal() {
    document.getElementById('modalClose').addEventListener('click', closeModal);
    document.getElementById('modalCancel').addEventListener('click', closeModal);

    document.querySelectorAll('.result-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.result-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
        });
    });

    document.getElementById('modalConfirm').addEventListener('click', () => {
        const activeBtn = document.querySelector('.result-btn.active');
        if (!activeBtn) {
            showToast('请选择赛果');
            return;
        }
        const result = activeBtn.dataset.result;
        const finalScore = document.getElementById('finalScore').value.trim();

        const data = getData();
        const a = data.analyses.find(x => x.id === editingId);
        if (a) {
            a.result = result;
            a.finalScore = finalScore || null;
            saveData(data);
            renderRecords();
            updateStats();
            showToast(result === 'win' ? '🎉 命中！' : result === 'push' ? '走水' : '未命中');
        }
        closeModal();
    });

    document.getElementById('resultModal').addEventListener('click', e => {
        if (e.target === e.currentTarget) closeModal();
    });
}

// ===== 筛选 =====
function initFilters() {
    document.querySelectorAll('.filter-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            currentFilter = btn.dataset.filter;
            renderRecords();
        });
    });
}

// ===== 复制 =====
function initCopy() {
    document.querySelectorAll('.copy-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const text = btn.dataset.copy;
            navigator.clipboard.writeText(text).then(() => {
                showToast('QQ号码已复制：' + text);
            }).catch(() => {
                showToast('复制失败');
            });
        });
    });
}

// ===== 密码锁事件 =====
function initLock() {
    document.getElementById('lockBtn').addEventListener('click', attemptUnlock);
    document.getElementById('lockPassword').addEventListener('keypress', e => {
        if (e.key === 'Enter') attemptUnlock();
    });
    document.getElementById('logoutBtn').addEventListener('click', logout);
}

// ===== 初始化 =====
document.addEventListener('DOMContentLoaded', () => {
    checkLock();
    initLock();
    initForm();
    initModal();
    initFilters();
    initCopy();
    renderRecords();
    updateStats();
});
