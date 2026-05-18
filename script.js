// ===== 数据存储 =====
const STORAGE_KEY = 'sports_analytics_v1';

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
    asia: { label: '亚盘推荐', class: 'asia' },
    lottery: { label: '竞彩推荐', class: 'lottery' },
    overunder: { label: '大小分推荐', class: 'overunder' },
    handicap: { label: '让球推荐', class: 'handicap' }
};

const SPORT_MAP = {
    football: '⚽',
    basketball: '🏀'
};

// ===== Toast =====
function showToast(message) {
    const toast = document.getElementById('toast');
    toast.textContent = message;
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), 2500);
}

// ===== 背景粒子动画 =====
(function initParticles() {
    const canvas = document.getElementById('bgCanvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    let particles = [];
    const PARTICLE_COUNT = 60;
    const CONNECTION_DIST = 120;

    function resize() {
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;
    }

    class Particle {
        constructor() {
            this.reset();
        }
        reset() {
            this.x = Math.random() * canvas.width;
            this.y = Math.random() * canvas.height;
            this.vx = (Math.random() - 0.5) * 0.4;
            this.vy = (Math.random() - 0.5) * 0.4;
            this.radius = Math.random() * 1.5 + 0.5;
            this.opacity = Math.random() * 0.3 + 0.1;
        }
        update() {
            this.x += this.vx;
            this.y += this.vy;
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

    function init() {
        resize();
        particles = [];
        for (let i = 0; i < PARTICLE_COUNT; i++) {
            particles.push(new Particle());
        }
    }

    function drawConnections() {
        for (let i = 0; i < particles.length; i++) {
            for (let j = i + 1; j < particles.length; j++) {
                const dx = particles[i].x - particles[j].x;
                const dy = particles[i].y - particles[j].y;
                const dist = Math.sqrt(dx * dx + dy * dy);
                if (dist < CONNECTION_DIST) {
                    const opacity = (1 - dist / CONNECTION_DIST) * 0.08;
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

    // 连红计算
    let streak = 0;
    const sorted = [...finished].sort((a, b) => b.id - a.id);
    for (const a of sorted) {
        if (a.result === 'win') streak++;
        else break;
    }

    // 分类统计
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

    // 数字动画
    animateNumber('totalCount', s.total);
    animateNumber('winCount', s.winCount);
    animateNumber('streakCount', s.streak);

    // 胜率
    const rateEl = document.getElementById('winRate');
    rateEl.textContent = s.rate + '%';
    document.getElementById('rateText').textContent = s.rate + '%';

    // 环形进度
    const circle = document.getElementById('rateCircle');
    const circumference = 2 * Math.PI * 50; // ~314
    const offset = circumference - (s.rate / 100) * circumference;
    circle.style.strokeDashoffset = offset;

    // 进度条
    document.getElementById('totalBar').style.width = '100%';
    document.getElementById('winBar').style.width = s.total > 0 ? ((s.winCount / s.total) * 100) + '%' : '0%';

    // 分类
    document.getElementById('fbAsiaRate').textContent = s.fbAsiaRate;
    document.getElementById('fbLotteryRate').textContent = s.fbLotteryRate;
    document.getElementById('bkOuRate').textContent = s.bkOuRate;
    document.getElementById('bkHandicapRate').textContent = s.bkHandicapRate;
}

function animateNumber(id, target) {
    const el = document.getElementById(id);
    const start = parseInt(el.textContent) || 0;
    if (start === target) return;
    const duration = 800;
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

    const pendingList = document.getElementById('pendingList');
    const finishedList = document.getElementById('finishedList');

    // 筛选
    function filterList(list) {
        if (currentFilter === 'all') return list;
        if (currentFilter === 'pending') return list.filter(a => a.result === null || a.result === undefined);
        if (currentFilter === 'win') return list.filter(a => a.result === 'win');
        if (currentFilter === 'lose') return list.filter(a => a.result === 'lose');
        return list.filter(a => a.sport === currentFilter);
    }

    const filteredPending = filterList(pending);
    const filteredFinished = filterList(finished);

    pendingList.innerHTML = filteredPending.length
        ? filteredPending.map(a => createRecordHTML(a, true)).join('')
        : createEmptyHTML('pending');

    finishedList.innerHTML = filteredFinished.length
        ? filteredFinished.map(a => createRecordHTML(a, false)).join('')
        : createEmptyHTML('finished');

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
    const dateStr = a.date ? new Date(a.date).toLocaleDateString('zh-CN') : '';

    let resultHTML = '';
    if (!isPending && a.result) {
        const badgeClass = a.result;
        const badgeText = a.result === 'win' ? '命中' : a.result === 'lose' ? '未命中' : '走水';
        resultHTML = `
            <div style="text-align:right">
                <span class="result-badge ${badgeClass}">${badgeText}</span>
                ${a.finalScore ? `<div class="final-score">比分 ${a.finalScore}</div>` : ''}
            </div>
        `;
    }

    return `
        <div class="record-card" data-id="${a.id}">
            <div class="record-sport">${sportIcon}</div>
            <div class="record-info">
                <div class="record-match">${a.match || '未命名比赛'}</div>
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

function createEmptyHTML(type) {
    const icons = { pending: '📋', finished: '📊' };
    const texts = {
        pending: ['暂无待结算的分析记录', '请在上方录入赛前分析'],
        finished: ['暂无已结算记录', '比赛结束后输入赛果进行结算']
    };
    const t = texts[type];
    return `
        <div class="empty-state">
            <div class="empty-icon">${icons[type]}</div>
            <p>${t[0]}</p>
            <p class="empty-hint">${t[1]}</p>
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

    document.getElementById('modalMatchInfo').textContent =
        `${SPORT_MAP[a.sport] || ''} ${a.match || '未命名'} · ${a.recommendation || ''}`;

    // 重置
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
    // 设置默认日期为今天
    document.getElementById('matchDate').valueAsDate = new Date();

    // 标签切换
    document.querySelectorAll('.form-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('.form-tab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            currentSport = tab.dataset.sport;
            updateBetTypeOptions();
        });
    });

    // 推荐类型联动
    document.getElementById('betType').addEventListener('change', function() {
        const val = this.value;
        if (['asia', 'lottery'].includes(val)) {
            switchTab('football');
        } else if (['overunder', 'handicap'].includes(val)) {
            switchTab('basketball');
        }
    });

    // 提交
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
    updateBetTypeOptions();
}

function updateBetTypeOptions() {
    const select = document.getElementById('betType');
    const val = select.value;
    // 不自动切换已选项，只确保选项可用
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

    // 重置表单
    document.getElementById('analysisForm').reset();
    document.getElementById('matchDate').valueAsDate = new Date();
    document.getElementById('league').focus();

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
            showToast('结算完成');
        }
        closeModal();
    });

    // 点击遮罩关闭
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
                showToast('复制失败，请手动复制');
            });
        });
    });
}

// ===== 导航高亮 =====
function initNav() {
    const sections = document.querySelectorAll('section[id]');
    const navLinks = document.querySelectorAll('.nav-link');

    window.addEventListener('scroll', () => {
        let current = '';
        sections.forEach(sec => {
            const top = sec.offsetTop - 120;
            if (scrollY >= top) current = sec.getAttribute('id');
        });

        navLinks.forEach(link => {
            link.classList.toggle('active', link.getAttribute('href') === '#' + current);
        });
    });
}

// ===== 初始化 =====
document.addEventListener('DOMContentLoaded', () => {
    initForm();
    initModal();
    initFilters();
    initCopy();
    initNav();
    renderRecords();
    updateStats();
});
