/**
 * InvestIQ — app.js (Final & Profesyonel Sürüm)
 */
'use strict';

const ASSET_CONFIG = {
    'XAU-TRY':  { displayName: 'Altın (Gram)',       type: 'commodity', yahooTicker: 'GC=F',       isGoldGram: true  },
    'XAG-TRY':  { displayName: 'Gümüş (Gram)',       type: 'commodity', yahooTicker: 'SI=F',       isSilverGram: true },
    'USD-TRY':  { displayName: 'Dolar (USD)',         type: 'forex',     yahooTicker: 'USDTRY=X'  },
    'EUR-TRY':  { displayName: 'Euro (EUR)',          type: 'forex',     yahooTicker: 'EURTRY=X'  },
    'GBP-TRY':  { displayName: 'Sterlin (GBP)',       type: 'forex',     yahooTicker: 'GBPTRY=X'  },
    'BTC-TRY':  { displayName: 'Bitcoin (BTC)',       type: 'crypto',    yahooTicker: 'BTC-TRY'   },
    'ETH-TRY':  { displayName: 'Ethereum (ETH)',      type: 'crypto',    yahooTicker: 'ETH-TRY'   },
    'THYAO.IS': { displayName: 'Türk Hava Yolları',  type: 'stock', isTRY: true, yahooTicker: 'THYAO.IS' },
    'SISE.IS':  { displayName: 'Şişe Cam',          type: 'stock', isTRY: true, yahooTicker: 'SISE.IS'  },
    'EREGL.IS': { displayName: 'Ereğli Demir Çelik',type: 'stock', isTRY: true, yahooTicker: 'EREGL.IS' },
    'KOTON.IS': { displayName: 'Koton Mağazacılık', type: 'stock', isTRY: true, yahooTicker: 'KOTON.IS' },
    'AKFYE.IS': { displayName: 'Akfen Yen. Enerji', type: 'stock', isTRY: true, yahooTicker: 'AKFYE.IS' },
    'ALTNY.IS': { displayName: 'Altınay Savunma',   type: 'stock', isTRY: true, yahooTicker: 'ALTNY.IS' },
    'AGYO.IS':  { displayName: 'Ağaoğlu GMYO',      type: 'stock', isTRY: true, yahooTicker: 'AGYO.IS'  },
    'AAPL':     { displayName: 'Apple (AAPL)',         type: 'stock',     yahooTicker: 'AAPL'       },
    'NVDA':     { displayName: 'NVIDIA (NVDA)',        type: 'stock',     yahooTicker: 'NVDA'       }
};

const state = {
    transactions: JSON.parse(localStorage.getItem('investiq_v2_transactions')) || [],
    prices: JSON.parse(localStorage.getItem('investiq_v2_prices')) || {},
    usdTry: 32.50,
    charts: { pie: null }
};

const el = {};

function mapElements() {
    [
        'transactionForm','portfolioBody','historyBody','totalWealth','totalProfitLoss',
        'profitTrend','plIcon','bestPerformer','bestPerformerPct',
        'assetCount','txCount','clearData','refreshBtn','loadingOverlay','lastUpdateTime',
        'priceStatusBadge','distributionChart','lineChart','chartEmpty','lineChartEmpty',
        'portfolioEmpty','historyEmpty','assetSearch','searchDropdown',
        'clearSearch','selectedTicker','exportBtn','importBtn','type','typeBuy',
        'typeSell','autoFillPrice','toast','date','amount','price','note'
    ].forEach(id => { el[id] = document.getElementById(id); });
    
    el.form = el.transactionForm;
    el.priceStatus = el.priceStatusBadge;
}

async function init() {
    mapElements();
    if (el.loadingOverlay) el.loadingOverlay.style.display = 'none';
    
    try {
        if (el.date) el.date.valueAsDate = new Date();
        bindEvents();
        updateUI();
        fetchAllPrices();
        setInterval(fetchAllPrices, 5 * 60 * 1000);
    } catch (e) { console.error("Init Error:", e); }
}

function bindEvents() {
    const on = (id, ev, fn) => { if(el[id]) el[id].addEventListener(ev, fn); };
    on('form', 'submit', handleSubmit);
    on('refreshBtn', 'click', fetchAllPrices);
    on('assetSearch', 'input', handleSearchInput);
    on('clearSearch', 'click', clearSearch);
    on('typeBuy', 'click', () => setType('AL'));
    on('typeSell', 'click', () => setType('SAT'));
    on('autoFillPrice', 'click', autoFillCurrentPrice);
    on('exportBtn', 'click', handleExport);
    on('importBtn', 'click', handleImport);
    on('clearData', 'click', () => { if(confirm('Tüm veriler silinecek?')) { state.transactions=[]; saveTransactions(); updateUI(); }});
}

async function handleSubmit(e) {
    e.preventDefault();
    const ticker = getSelectedTicker();
    if(!ticker) return showToast("Lütfen bir varlık seçin");

    const tx = {
        id: Date.now(),
        date: el.date.value,
        ticker: ticker,
        name: getDisplayName(ticker),
        type: document.getElementById('type').value,
        amount: parseFloat(el.amount.value),
        price: parseFloat(el.price.value),
        note: el.note.value
    };

    state.transactions.push(tx);
    saveTransactions();
    updateUI();
    el.form.reset();
    el.date.valueAsDate = new Date();
    showToast("İşlem kaydedildi ✓");
}

function getSelectedTicker() {
    let t = el.selectedTicker.value;
    if(!t) {
        t = el.assetSearch.value.trim().toUpperCase();
        if(t.length>=4 && t.length<=6 && !t.includes('.')) t += '.IS';
    }
    return t || null;
}

async function fetchAllPrices() {
    if(el.refreshBtn) el.refreshBtn.classList.add('spinning');
    try {
        const tickers = new Set();
        state.transactions.forEach(tx => tickers.add(tx.ticker));
        if(tickers.size > 0) {
            await fetchPrice('USD-TRY');
            await Promise.allSettled([...tickers].map(t => fetchPrice(t)));
        }
        if(el.lastUpdateTime) el.lastUpdateTime.textContent = new Date().toLocaleTimeString('tr-TR', {hour:'2-digit', minute:'2-digit'});
        updateUI();
    } finally { if(el.refreshBtn) el.refreshBtn.classList.remove('spinning'); }
}

async function fetchPrice(ticker) {
    const config = ASSET_CONFIG[ticker];
    const yahoo = config ? config.yahooTicker : ticker;
    try {
        const res = await fetch(`https://api.allorigins.win/get?url=${encodeURIComponent('https://query1.finance.yahoo.com/v7/finance/quote?symbols='+yahoo)}`);
        const d = await res.json();
        const json = JSON.parse(d.contents);
        const q = json.quoteResponse.result[0];
        if(q) {
            let p = q.regularMarketPrice || q.previousClose || 0;
            if(!config?.isTRY && q.currency !== 'TRY') {
                const usd = state.prices['USD-TRY'] || 32.5;
                if(config?.isGoldGram) p = (p/31.1035)*usd;
                else if(ticker !== 'USD-TRY') p = p * usd;
            }
            state.prices[ticker] = p;
        }
    } catch(e) {}
}

function calculatePortfolio() {
    const p = {};
    state.transactions.forEach(tx => {
        if(!p[tx.ticker]) p[tx.ticker] = { amount: 0, cost: 0, date: tx.date };
        if(tx.type==='AL') { p[tx.ticker].amount += tx.amount; p[tx.ticker].cost += tx.amount*tx.price; }
        else { 
            const avg = p[tx.ticker].amount > 0 ? p[tx.ticker].cost/p[tx.ticker].amount : 0;
            p[tx.ticker].amount -= tx.amount; p[tx.ticker].cost -= tx.amount*avg; 
        }
    });
    return p;
}

function updateUI() {
    const portfolio = calculatePortfolio();
    renderPortfolioTable(portfolio);
    renderSummary(portfolio);
    renderPieChart(portfolio);
    renderHistoryTable();
    if(window.lucide) lucide.createIcons();
}

function renderPortfolioTable(portfolio) {
    if (!el.portfolioBody) return;
    el.portfolioBody.innerHTML = '';
    Object.entries(portfolio).forEach(([t, pos]) => {
        if(pos.amount <= 0.00001) return;
        const price = state.prices[t] || 0;
        const val = pos.amount * price;
        const pl = val - pos.cost;
        const plPct = pos.cost > 0 ? (pl/pos.cost)*100 : 0;
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td><span class="asset-badge">${getDisplayName(t)}</span></td>
            <td>${pos.date}</td>
            <td>${pos.amount.toFixed(4)}</td>
            <td>₺${(pos.cost/pos.amount).toFixed(2)}</td>
            <td onclick="editPrice('${t}')" style="cursor:pointer">₺${price.toFixed(2)}</td>
            <td style="font-weight:700">₺${val.toLocaleString('tr-TR',{minimumFractionDigits:2})}</td>
            <td class="${pl>=0?'text-success':'text-danger'}">
                ${pl>=0?'+':''}${pl.toFixed(2)} TL<br>
                <small>%${plPct.toFixed(2)}</small>
            </td>
        `;
        el.portfolioBody.appendChild(tr);
    });
}

function renderSummary(p) {
    let total = 0, cost = 0;
    Object.entries(p).forEach(([t, pos]) => {
        total += pos.amount * (state.prices[t] || (pos.cost/pos.amount));
        cost += pos.cost;
    });
    if(el.totalWealth) el.totalWealth.textContent = '₺' + total.toLocaleString('tr-TR',{minimumFractionDigits:2});
    if(el.totalProfitLoss) el.totalProfitLoss.textContent = '₺' + (total - cost).toLocaleString('tr-TR',{minimumFractionDigits:2});
    if(el.assetCount) el.assetCount.textContent = Object.keys(p).filter(k => p[k].amount>0).length;
}

function renderHistoryTable() {
    if(!el.historyBody) return;
    el.historyBody.innerHTML = '';
    [...state.transactions].reverse().slice(0, 10).forEach(tx => {
        const tr = document.createElement('tr');
        tr.innerHTML = `<td>${tx.date}</td><td>${tx.name}</td><td>${tx.type}</td><td>${tx.amount}</td><td>₺${tx.price}</td><td>₺${(tx.amount*tx.price).toFixed(2)}</td><td>${tx.note||'-'}</td><td><button onclick="deleteTx(${tx.id})" class="btn-delete">×</button></td>`;
        el.historyBody.appendChild(tr);
    });
}

function renderPieChart(portfolio) {
    const canvas = document.getElementById('distributionChart');
    if(!canvas || !window.Chart) return;
    const entries = Object.entries(portfolio).filter(([t, pos]) => pos.amount > 0);
    const data = entries.map(([t, pos]) => pos.amount * (state.prices[t] || (pos.cost/pos.amount)));
    const labels = entries.map(([t]) => getDisplayName(t));
    if(state.charts.pie) state.charts.pie.destroy();
    state.charts.pie = new Chart(canvas, {
        type: 'doughnut',
        data: { labels, datasets: [{ data, backgroundColor: ['#6366f1','#ec4899','#10b981','#f59e0b','#8b5cf6','#06b6d4'] }] },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position:'bottom', labels:{color:'#94a3b8'} } } }
    });
}

function handleSearchInput() {
    const v = el.assetSearch.value.toLowerCase();
    el.searchDropdown.innerHTML = '';
    Object.entries(ASSET_CONFIG).forEach(([t,c]) => {
        if(t.toLowerCase().includes(v) || c.displayName.toLowerCase().includes(v)) {
            const d = document.createElement('div'); d.className='search-item';
            d.innerHTML = `<span>${c.displayName}</span><small>${t}</small>`;
            d.onclick=()=>{ el.assetSearch.value=c.displayName; el.selectedTicker.value=t; el.searchDropdown.classList.add('hidden'); };
            el.searchDropdown.appendChild(d);
        }
    });
    el.searchDropdown.classList.toggle('hidden', v==='' || el.searchDropdown.children.length === 0);
}

function getDisplayName(t) { return ASSET_CONFIG[t]?.displayName || t; }
function saveTransactions() { localStorage.setItem('investiq_v2_transactions', JSON.stringify(state.transactions)); }
function showToast(m) { if(el.toast) { el.toast.textContent = m; el.toast.classList.add('show'); setTimeout(()=>el.toast.classList.remove('show'), 2000); } }
function setType(v) { document.getElementById('type').value = v; el.typeBuy.classList.toggle('active', v==='AL'); el.typeSell.classList.toggle('active', v==='SAT'); }
function clearSearch() { el.assetSearch.value=''; el.selectedTicker.value=''; el.searchDropdown.classList.add('hidden'); }
function handleExport() { navigator.clipboard.writeText(JSON.stringify(state.transactions)); alert("Veriler panoya kopyalandı!"); }
function handleImport() { const d = prompt("Portföy kodunu yapıştırın:"); if(d) { try { state.transactions = JSON.parse(d); saveTransactions(); updateUI(); } catch(e){alert("Hatalı kod!");} } }
function autoFillCurrentPrice() { const t = getSelectedTicker(); if(state.prices[t]) el.price.value = state.prices[t].toFixed(2); }

window.editPrice = (t) => { const p=prompt("Fiyat (TL):", state.prices[t]); if(p){ state.prices[t]=parseFloat(p); updateUI(); } };
window.deleteTx = (id) => { if(confirm('Silinsin mi?')) { state.transactions = state.transactions.filter(t=>t.id!==id); saveTransactions(); updateUI(); } };

window.onload = init;
