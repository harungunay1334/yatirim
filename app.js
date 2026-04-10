/**
 * InvestIQ - app.js (Gelişmiş CORS & Mobil Uyumlu Sürüm)
 */
'use strict';

const ASSET_CONFIG = {
    'XAU-TRY':  { name: 'Altın (Gram)',       yTick: 'GC=F',       isGold: true },
    'XAG-TRY':  { name: 'Gümüş (Gram)',       yTick: 'SI=F',       isSilver: true },
    'USD-TRY':  { name: 'Dolar (USD)',         yTick: 'USDTRY=X',   isForex: true },
    'EUR-TRY':  { name: 'Euro (EUR)',          yTick: 'EURTRY=X',   isForex: true },
    'BTC-TRY':  { name: 'Bitcoin (BTC)',       yTick: 'BTC-TRY',    isCrypto: true },
    'THYAO.IS': { name: 'Türk Hava Yolları',  yTick: 'THYAO.IS',   isTRY: true },
    'KOTON.IS': { name: 'Koton Mağazacılık', yTick: 'KOTON.IS',   isTRY: true },
    'AAPL':     { name: 'Apple (AAPL)',         yTick: 'AAPL',       isUSD: true }
};

const state = {
    transactions: JSON.parse(localStorage.getItem('investiq_v3_tx')) || [],
    prices: {},
    usdTry: 32.50
};

const el = {};
function map() {
    const ids = ['transactionForm','portfolioBody','totalWealth','totalProfitLoss',
    'refreshBtn','exportBtn','importBtn','clearData','assetSearch','searchDropdown',
    'selectedTicker','typeBuy','typeSell','type','amount','price','autoFillPrice','date','toast'];
    ids.forEach(id => el[id] = document.getElementById(id));
}

async function init() {
    map();
    if (el.date) el.date.valueAsDate = new Date();
    bind();
    updateUI();
    fetchAll();
    setInterval(fetchAll, 300000);
}

function bind() {
    const on = (id, ev, fn) => { if(el[id]) el[id].addEventListener(ev, fn); };
    on('transactionForm', 'submit', handleSave);
    on('refreshBtn', 'click', fetchAll);
    on('assetSearch', 'input', handleSearch);
    on('typeBuy', 'click', () => setType('AL'));
    on('typeSell', 'click', () => setType('SAT'));
    on('autoFillPrice', 'click', fillCurrent);
    on('clearData', 'click', () => { if(confirm('Tüm veriler silinsin mi?')) { state.transactions=[]; store(); updateUI(); }});
}

async function fetchAll() {
    if(el.refreshBtn) el.refreshBtn.classList.add('spinning');
    try {
        const tickers = new Set();
        state.transactions.forEach(t => tickers.add(t.ticker));
        
        // Önce Dolar Kuru (Zorunlu)
        await fetchTicker('USD-TRY');
        
        // Diğerlerini Paralel Çek
        const others = [...tickers].filter(t => t !== 'USD-TRY');
        await Promise.allSettled(others.map(t => fetchTicker(t)));
        
        updateUI();
    } finally {
        if(el.refreshBtn) el.refreshBtn.classList.remove('spinning');
    }
}

async function fetchTicker(ticker) {
    const cfg = ASSET_CONFIG[ticker];
    const yId = cfg ? cfg.yTick : ticker;
    const cacheBuster = `&_=${Date.now()}`;
    const baseUrl = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${yId}`;
    
    // Proxy Listesi (Yedekli)
    const proxies = [
        `https://api.allorigins.win/get?url=${encodeURIComponent(baseUrl)}${cacheBuster}`,
        `https://corsproxy.io/?${encodeURIComponent(baseUrl)}`
    ];

    for (let proxyUrl of proxies) {
        try {
            const res = await fetch(proxyUrl);
            const data = await res.json();
            const contents = typeof data.contents === 'string' ? JSON.parse(data.contents) : data;
            const quote = contents?.quoteResponse?.result?.[0];
            
            if(quote) {
                let p = quote.regularMarketPrice || 0;
                // Para birimi çevrimi
                if(!cfg?.isTRY && quote.currency !== 'TRY') {
                    const rate = state.prices['USD-TRY'] || 32.5;
                    if(cfg?.isGold) p = (p / 31.1035) * rate; // Gram Altın çevrimi
                    else if(ticker !== 'USD-TRY') p = p * rate;
                }
                state.prices[ticker] = p;
                if(ticker === 'USD-TRY') state.usdTry = p;
                return p;
            }
        } catch (e) { console.warn(`Proxy hatası: ${proxyUrl}`); }
    }
    return null;
}

function updateUI() {
    const portfolio = calc();
    renderTable(portfolio);
    renderSummary(portfolio);
    if(window.lucide) lucide.createIcons();
}

function calc() {
    const p = {};
    state.transactions.forEach(tx => {
        if(!p[tx.ticker]) p[tx.ticker] = { amount: 0, cost: 0, firstDate: tx.date };
        if(tx.type === 'AL') {
            p[tx.ticker].amount += tx.amount;
            p[tx.ticker].cost += tx.amount * tx.price;
        } else {
            const avg = p[tx.ticker].cost / p[tx.ticker].amount;
            p[tx.ticker].amount -= tx.amount;
            p[tx.ticker].cost -= tx.amount * avg;
        }
    });
    return p;
}

function renderTable(portfolio) {
    if(!el.portfolioBody) return;
    el.portfolioBody.innerHTML = '';
    
    Object.entries(portfolio).forEach(([t, pos]) => {
        if(pos.amount <= 0) return;
        const price = state.prices[t];
        const val = price ? pos.amount * price : null;
        const pl = val !== null ? val - pos.cost : null;
        const plPct = (pl !== null && pos.cost > 0) ? (pl/pos.cost)*100 : null;
        
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td><b>${ASSET_CONFIG[t]?.name || t}</b></td>
            <td>${pos.amount.toFixed(4)}</td>
            <td>${format(pos.cost / pos.amount)}</td>
            <td style="color:${price?'white':'#f59e0b'}">${price ? format(price) : 'Yükleniyor...'}</td>
            <td class="${pl>=0?'text-success':'text-danger'}">
                ${pl !== null ? format(pl) : '--'}<br>
                <small>${plPct !== null ? '%' + plPct.toFixed(2) : ''}</small>
            </td>
        `;
        el.portfolioBody.appendChild(tr);
    });
}

function renderSummary(p) {
    let total = 0, cost = 0;
    Object.entries(p).forEach(([t, pos]) => {
        const pr = state.prices[t] || (pos.cost / pos.amount);
        total += pos.amount * pr;
        cost += pos.cost;
    });
    if(el.totalWealth) el.totalWealth.textContent = format(total);
    if(el.totalProfitLoss) el.totalProfitLoss.textContent = format(total - cost);
}

function handleSave(e) {
    e.preventDefault();
    const ticker = el.selectedTicker.value || el.assetSearch.value.trim().toUpperCase();
    if(!ticker) return;
    state.transactions.push({
        id: Date.now(),
        date: el.date.value,
        ticker: ticker.includes('.') || ticker.length < 4 ? ticker : ticker + '.IS',
        type: el.type.value,
        amount: parseFloat(el.amount.value),
        price: parseFloat(el.price.value)
    });
    store();
    updateUI();
    el.transactionForm.reset();
    el.date.valueAsDate = new Date();
    showToast("İşlem Kaydedildi");
    fetchAll();
}

function format(v) { return '₺' + v.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function store() { localStorage.setItem('investiq_v3_tx', JSON.stringify(state.transactions)); }
function showToast(m) { if(el.toast) { el.toast.textContent = m; el.toast.classList.add('show'); setTimeout(()=>el.toast.classList.remove('show'), 2000); } }
function setType(v) { el.type.value = v; el.typeBuy.classList.toggle('active', v==='AL'); el.typeSell.classList.toggle('active', v==='SAT'); }
function fillCurrent() { const t = el.selectedTicker.value; if(state.prices[t]) el.price.value = state.prices[t].toFixed(2); }
function handleSearch() {
    const v = el.assetSearch.value.toLowerCase();
    el.searchDropdown.innerHTML = '';
    Object.entries(ASSET_CONFIG).forEach(([t,c]) => {
        if(c.name.toLowerCase().includes(v) || t.toLowerCase().includes(v)) {
            const d = document.createElement('div'); d.className='search-item'; d.textContent = c.name;
            d.onclick = () => { el.assetSearch.value = c.name; el.selectedTicker.value = t; el.searchDropdown.classList.add('hidden'); };
            el.searchDropdown.appendChild(d);
        }
    });
    el.searchDropdown.classList.toggle('hidden', v==='');
}

init();
