/**
 * InvestIQ — kişisel yatırım takip uygulaması
 *
 * Fiyat kaynakları (hepsi tarayıcıdan doğrudan erişilebilir, proxy gerekmez):
 *  - Altın / gümüş / döviz : finans.truncgil.com (kuyumcu alış-satış fiyatları, TL)
 *                            veya Ziraat Bankası (internet/şube kurları; Vercel'deki api/ziraat
 *                            anlık çeker, ulaşılamazsa GitHub Actions'ın "ziraat-data" dalına
 *                            yazdığı yedek JSON okunur)
 *  - Kripto                : Binance (TRY pariteleri)
 *  - BIST & ABD hisseleri  : TradingView tarayıcı API'si (BIST ~15 dk gecikmeli)
 *  - Fon & diğer           : elle girilen fiyat
 *
 * Tüm veriler cihazda (localStorage) tutulur.
 */
'use strict';

const VERSION = '4.2.0';

const LS = {
    tx: 'investiq_v3_tx',
    assets: 'investiq_v3_assets',
    prices: 'investiq_v3_prices',
    manual: 'investiq_v3_manual',
    settings: 'investiq_v3_settings',
    prev: 'investiq_v3_prev_backup',
    legacyTx: 'investiq_v2_transactions'
};

// ============================================================
// VARLIK KATALOĞU
// ============================================================

const CATS = {
    gold:   { label: 'Altın & Maden', color: '#f5c142' },
    fx:     { label: 'Döviz',         color: '#60a5fa' },
    bist:   { label: 'BIST Hisse',    color: '#34d399' },
    us:     { label: 'ABD Hisse',     color: '#a78bfa' },
    crypto: { label: 'Kripto',        color: '#fb923c' },
    fund:   { label: 'Fon',           color: '#f472b6' },
    other:  { label: 'Diğer',         color: '#94a3b8' }
};

const gold = (name, sym, unit = 'adet', ic = 'Au') => ({ name, cat: 'gold', src: 'tg', sym, unit, ic });
const fx = (name, sym, ic) => ({ name, cat: 'fx', src: 'tg', sym, unit: sym, ic });
const cr = (name, base, ic) => ({ name, cat: 'crypto', src: 'bn', sym: base + 'TRY', unit: base, ic: ic || base.slice(0, 3) });

const CATALOG = {
    GRA:        gold('Gram Altın', 'GRA', 'gr'),
    CEYREK:     gold('Çeyrek Altın', 'CEYREKALTIN'),
    YARIM:      gold('Yarım Altın', 'YARIMALTIN'),
    TAM:        gold('Tam Altın', 'TAMALTIN'),
    CUMHURIYET: gold('Cumhuriyet Altını', 'CUMHURIYETALTINI'),
    ATA:        gold('Ata Altın', 'ATAALTIN'),
    RESAT:      gold('Reşat Altın', 'RESATALTIN'),
    IKIBUCUK:   gold('İkibuçuk Altın', 'IKIBUCUKALTIN'),
    BESLI:      gold('Beşli Altın', 'BESLIALTIN'),
    GREMSE:     gold('Gremse Altın', 'GREMSEALTIN'),
    HAS:        gold('Has Altın (24 Ayar)', 'HAS', 'gr'),
    B22:        gold('22 Ayar Bilezik', 'YIA', 'gr', '22'),
    A18:        gold('18 Ayar Altın', '18AYARALTIN', 'gr', '18'),
    A14:        gold('14 Ayar Altın', '14AYARALTIN', 'gr', '14'),
    GUMUS:      gold('Gümüş', 'GUMUS', 'gr', 'Ag'),
    PLATIN:     gold('Platin', 'GPL', 'gr', 'Pt'),
    PALADYUM:   gold('Paladyum', 'PAL', 'gr', 'Pd'),
    USD: fx('Amerikan Doları', 'USD', '$'),
    EUR: fx('Euro', 'EUR', '€'),
    GBP: fx('İngiliz Sterlini', 'GBP', '£'),
    CHF: fx('İsviçre Frangı', 'CHF', 'Fr'),
    CAD: fx('Kanada Doları', 'CAD', 'C$'),
    AUD: fx('Avustralya Doları', 'AUD', 'A$'),
    AED: fx('BAE Dirhemi', 'AED', 'AE'),
    SAR: fx('Suudi Riyali', 'SAR', 'SR'),
    JPY: fx('Japon Yeni', 'JPY', '¥'),
    BTC:  cr('Bitcoin', 'BTC', '₿'),
    ETH:  cr('Ethereum', 'ETH', 'Ξ'),
    SOL:  cr('Solana', 'SOL'),
    XRP:  cr('XRP', 'XRP'),
    BNB:  cr('BNB', 'BNB'),
    AVAX: cr('Avalanche', 'AVAX', 'AVX'),
    DOGE: cr('Dogecoin', 'DOGE', 'Ð'),
    ADA:  cr('Cardano', 'ADA'),
    USDT: cr('Tether', 'USDT', '₮')
};

const POPULAR = {
    bist: ['THYAO', 'ASELS', 'GARAN', 'AKBNK', 'YKBNK', 'ISCTR', 'KCHOL', 'BIMAS', 'TUPRS', 'FROTO', 'EREGL', 'SISE', 'PGSUS', 'TCELL', 'SAHOL', 'ALTNY', 'GLDTR'],
    us: ['AAPL', 'NVDA', 'MSFT', 'GOOGL', 'AMZN', 'META', 'TSLA', 'SPY', 'QQQ', 'VOO']
};

// Eski sürümün (v2) varlık kodları → yeni kodlar
const LEGACY_MAP = {
    'XAU-TRY': 'GRA', 'XAG-TRY': 'GUMUS', 'USD-TRY': 'USD', 'EUR-TRY': 'EUR',
    'GBP-TRY': 'GBP', 'BTC-TRY': 'BTC', 'ETH-TRY': 'ETH'
};

// ============================================================
// DURUM & DEPOLAMA
// ============================================================

const load = (k, d) => {
    try { const v = JSON.parse(localStorage.getItem(k)); return v ?? d; } catch { return d; }
};
const store = (k, v) => {
    try { localStorage.setItem(k, JSON.stringify(v)); }
    catch { toast('Kaydedilemedi — cihaz depolaması dolu olabilir', 'err'); }
};

const S = {
    tx: load(LS.tx, null),
    assets: load(LS.assets, {}),
    prices: load(LS.prices, {}),
    manual: load(LS.manual, {}),
    settings: Object.assign({
        hide: false, valuation: 'buy', sort: 'value', histFilter: 'all',
        fxSource: 'zr-int', zrTime: 0, lastBackup: 0, lastChange: 0
    }, load(LS.settings, {})),
    view: 'portfolio',
    fetching: false,
    lastFetch: 0,
    fetchErrors: [],
    online: navigator.onLine
};

const saveTx = () => { S.settings.lastChange = Date.now(); store(LS.tx, S.tx); store(LS.settings, S.settings); };
const saveAssets = () => store(LS.assets, S.assets);
const savePrices = () => store(LS.prices, S.prices);
const saveManual = () => store(LS.manual, S.manual);
const saveSettings = () => store(LS.settings, S.settings);

function getAsset(id) {
    if (CATALOG[id]) return { id, ...CATALOG[id] };
    if (S.assets[id]) return { id, ...S.assets[id] };
    return null;
}
const assetName = id => getAsset(id)?.name || id;
const assetShort = a => a.ticker || a.name;
const assetIcon = a => a.ic || (a.ticker || a.name || '?').slice(0, 3).toUpperCase();

// ============================================================
// ESKİ VERİYİ TAŞIMA
// ============================================================

function legacyToAssetId(t) {
    if (LEGACY_MAP[t]) return LEGACY_MAP[t];
    if (CATALOG[t] || S.assets[t]) return t;
    const up = String(t || '').toUpperCase().trim();
    if (!up) return null;
    if (up.endsWith('.IS')) {
        const tk = up.slice(0, -3);
        const id = 'BIST:' + tk;
        if (!S.assets[id]) S.assets[id] = { name: tk, ticker: tk, cat: 'bist', src: 'tv', sym: id, unit: 'adet' };
        return id;
    }
    const id = 'US:' + up;
    if (!S.assets[id]) S.assets[id] = { name: up, ticker: up, cat: 'us', src: 'tv', sym: null, pending: true, unit: 'adet' };
    return id;
}

function convertLegacyTx(list) {
    return list
        .filter(t => t && t.ticker && +t.amount > 0)
        .map((t, i) => ({
            id: t.id || Date.now() + i,
            asset: legacyToAssetId(t.ticker),
            type: t.type === 'SAT' ? 'SAT' : 'AL',
            date: t.date || today(),
            amount: +t.amount,
            price: +t.price || 0,
            fee: 0,
            note: t.note || ''
        }))
        .filter(t => t.asset);
}

function migrate() {
    if (Array.isArray(S.tx)) return;
    const legacy = load(LS.legacyTx, null);
    S.tx = Array.isArray(legacy) ? convertLegacyTx(legacy) : [];
    saveAssets();
    store(LS.tx, S.tx);
    if (S.tx.length) setTimeout(() => toast(`${S.tx.length} eski işlemin yeni sürüme taşındı ✓`, 'ok'), 600);
}

// ABD hissesi eski kayıtlarda borsa bilgisi olmadan gelir — NASDAQ/NYSE/AMEX'te ara
async function resolvePendingAssets() {
    const pend = Object.entries(S.assets).filter(([, a]) => a.pending);
    if (!pend.length) return;
    const tickers = pend.flatMap(([, a]) => ['NASDAQ', 'NYSE', 'AMEX'].map(ex => `${ex}:${a.ticker}`));
    try {
        const rows = await tvScan('global', { symbols: { tickers }, columns: ['description'] });
        for (const [, a] of pend) {
            const hit = rows.find(r => r.s.split(':')[1] === a.ticker);
            if (hit) { a.sym = hit.s; a.name = shortDesc(hit.d[0]) || a.ticker; delete a.pending; }
        }
        saveAssets();
    } catch { /* bir sonraki açılışta tekrar dener */ }
}

// ============================================================
// FİYAT ÇEKME
// ============================================================

async function fetchText(url, opts = {}, ms = 12000) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), ms);
    try {
        const r = await fetch(url, { ...opts, signal: ctrl.signal, cache: 'no-store' });
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return await r.text();
    } finally { clearTimeout(timer); }
}

const fetchJSON = async (url, opts, ms) => JSON.parse(await fetchText(url, opts, ms));

async function fetchTruncgil() {
    const txt = await fetchText('https://finans.truncgil.com/v4/today.json');
    let d;
    try { d = JSON.parse(txt); }
    catch {
        // Truncgil bazen dosyayı yarıda kesilmiş veriyor — son eksiksiz kayda kadar olan kısmı kurtar
        d = JSON.parse(txt.slice(0, txt.lastIndexOf('},"') + 1) + '}');
    }
    const t = Date.now();
    for (const [id, a] of Object.entries(CATALOG)) {
        if (a.src !== 'tg') continue;
        const it = d[a.sym];
        if (!it) continue;
        const b = +it.Buying || 0, s = +it.Selling || 0;
        if (!b && !s) continue;
        S.prices[id] = { b, s, chg: +it.Change || 0, t };
    }
}

// Altın & döviz fiyat kaynağı seçenekleri
const FX_SOURCES = {
    'zr-int':  { label: 'Ziraat internet', table: 'internet' },
    'zr-gise': { label: 'Ziraat şube',     table: 'gise' },
    'tg':      { label: 'Kuyumcu',         table: null }
};
const ZIRAAT_LIVE = 'https://yatirim-iota.vercel.app/api/ziraat';
const ZIRAAT_BACKUP = 'https://raw.githubusercontent.com/harungunay1334/yatirim/ziraat-data/ziraat.json';

// Ziraat'te olan varlıkların (dövizler, gram/has altın, gümüş) Truncgil fiyatını Ziraat'inkiyle değiştirir
async function fetchZiraat(table) {
    // Önce Vercel'den anlık fiyat; olmazsa GitHub Actions'ın birkaç saatte bir yazdığı yedek dosya
    const d = await fetchJSON(ZIRAAT_LIVE, {}, 8000)
        .catch(() => fetchJSON(ZIRAAT_BACKUP + '?t=' + Math.floor(Date.now() / 60000)));
    if (!d?.[table] || Date.now() - d.t > 3 * 86400000) throw new Error('ziraat eski');
    for (const [id, x] of Object.entries(d[table])) {
        if (!CATALOG[id] || !(x.b || x.s)) continue;
        S.prices[id] = { b: x.b, s: x.s, chg: x.chg || 0, t: d.t, src: 'zr' };
    }
    S.settings.zrTime = d.t;
    saveSettings();
}

// Önce Truncgil (tüm altın türleri), seçiliyse üstüne Ziraat
async function fetchFxGold() {
    const errs = [];
    await fetchTruncgil().catch(() => errs.push('Altın/Döviz'));
    const table = FX_SOURCES[S.settings.fxSource]?.table;
    if (table) await fetchZiraat(table).catch(() => errs.push('Ziraat'));
    if (errs.length) throw new Error(errs.join(', '));
}

async function fetchBinance(assets) {
    const syms = [...new Set(assets.map(a => a.sym))];
    const put = (row) => {
        const ids = assets.filter(a => a.sym === row.symbol).map(a => a.id);
        ids.forEach(id => { S.prices[id] = { p: +row.lastPrice, chg: +row.priceChangePercent || 0, t: Date.now() }; });
    };
    try {
        const rows = await fetchJSON('https://api.binance.com/api/v3/ticker/24hr?symbols=' + encodeURIComponent(JSON.stringify(syms)));
        rows.forEach(put);
    } catch {
        // Listedeki tek bir geçersiz sembol tüm isteği bozar — tek tek dene
        const res = await Promise.allSettled(syms.map(s => fetchJSON('https://api.binance.com/api/v3/ticker/24hr?symbol=' + s)));
        res.forEach(r => r.status === 'fulfilled' && put(r.value));
        if (res.every(r => r.status === 'rejected')) throw new Error('binance');
    }
}

async function tvScan(market, body) {
    const d = await fetchJSON(`https://scanner.tradingview.com/${market}/scan`, { method: 'POST', body: JSON.stringify(body) });
    return d.data || [];
}

// TradingView fiyatı (USD/EUR) → TL
function toTRY(price, currency) {
    if (!currency || currency === 'TRY') return price;
    const fxId = CATALOG[currency] ? currency : null;
    const r = fxId && S.prices[fxId];
    if (!r) return null;
    return price * ((r.b + r.s) / 2 || r.s || r.b);
}

async function fetchTV(assets) {
    const tickers = [...new Set(assets.map(a => a.sym).filter(Boolean))];
    if (!tickers.length) return;
    const rows = await tvScan('global', { symbols: { tickers }, columns: ['close', 'change', 'currency', 'description'] });
    const t = Date.now();
    let renamed = false;
    for (const r of rows) {
        const p = toTRY(+r.d[0], r.d[2]);
        if (p == null || !isFinite(p)) continue;
        assets.filter(a => a.sym === r.s).forEach(a => {
            S.prices[a.id] = { p, chg: +r.d[1] || 0, t, ccy: r.d[2], raw: +r.d[0] };
            // Eski sürümden gelen hisselerin adı sadece koddan ibaret — tam adı ekle
            const custom = S.assets[a.id];
            if (custom && custom.name === custom.ticker && r.d[3]) { custom.name = shortDesc(r.d[3]); renamed = true; }
        });
    }
    if (renamed) saveAssets();
}

async function refreshPrices({ silent = false } = {}) {
    if (S.fetching) return;
    S.fetching = true;
    S.fetchErrors = [];
    renderStatus();
    const btn = document.getElementById('btnRefresh');
    btn?.classList.add('spin');

    try {
        await resolvePendingAssets();
        const assets = [...new Set(S.tx.map(t => t.asset))].map(getAsset).filter(Boolean);

        // Döviz kurları TradingView'daki ABD hisselerini çevirmek için önce lazım
        await fetchFxGold().catch(e => S.fetchErrors.push(e.message));

        const jobs = [];
        const bn = assets.filter(a => a.src === 'bn');
        const tv = assets.filter(a => a.src === 'tv');
        if (bn.length) jobs.push(fetchBinance(bn).catch(() => S.fetchErrors.push('Kripto')));
        if (tv.length) jobs.push(fetchTV(tv).catch(() => S.fetchErrors.push('Hisse')));
        await Promise.all(jobs);

        S.lastFetch = Date.now();
        savePrices();
        if (!silent) {
            if (S.fetchErrors.length) toast(`Bazı fiyatlar alınamadı: ${S.fetchErrors.join(', ')}`, 'err');
            else toast('Fiyatlar güncellendi', 'ok');
        }
    } finally {
        S.fetching = false;
        btn?.classList.remove('spin');
        renderAll();
    }
}

function priceOf(id) {
    const a = S.prices[id], m = S.manual[id];
    const auto = a ? {
        p: a.p ?? (S.settings.valuation === 'sell' ? (a.s || a.b) : (a.b || a.s)),
        chg: a.chg || 0, t: a.t, manual: false, src: a.src
    } : null;
    if (m && (!auto || m.t >= auto.t)) return { p: m.p, chg: 0, t: m.t, manual: true };
    return auto;
}

function usdRate() {
    const r = S.prices.USD;
    return r ? ((r.b + r.s) / 2 || r.s || r.b) : null;
}

// ============================================================
// HESAPLAMA (ortalama maliyet yöntemi)
// ============================================================

function sortedTx(list = S.tx) {
    return [...list].sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id);
}

function computePositions() {
    const map = {};
    for (const t of sortedTx()) {
        const p = map[t.asset] ||= {
            id: t.asset, qty: 0, cost: 0, realized: 0, txCount: 0, first: t.date,
            costUsd: 0, usdOk: true, sold: 0
        };
        p.txCount++;
        const fee = +t.fee || 0;
        if (t.type === 'AL') {
            if (p.qty <= 1e-12) p.first = t.date;
            const total = t.amount * t.price + fee;
            p.qty += t.amount;
            p.cost += total;
            if (t.usd > 0) p.costUsd += total / t.usd; else p.usdOk = false;
        } else {
            const q = Math.min(t.amount, p.qty);
            if (q <= 0) continue;
            const avg = p.cost / p.qty;
            const avgUsd = p.costUsd / p.qty;
            p.realized += q * t.price - fee - avg * q;
            p.sold += q * t.price - fee;
            p.cost -= avg * q;
            p.costUsd -= avgUsd * q;
            p.qty -= q;
            if (p.qty < 1e-9) { p.qty = 0; p.cost = 0; p.costUsd = 0; }
        }
    }

    const usd = usdRate();
    const list = Object.values(map).map(p => {
        const a = getAsset(p.id) || { id: p.id, name: p.id, cat: 'other', unit: '' };
        const pr = priceOf(p.id);
        const hasPrice = !!(pr && pr.p > 0);
        const value = hasPrice ? p.qty * pr.p : p.cost;
        const pl = hasPrice ? value - p.cost : 0;
        const day = hasPrice && pr.chg ? value - value / (1 + pr.chg / 100) : 0;
        return {
            ...p, asset: a, price: hasPrice ? pr.p : null, priceInfo: pr, hasPrice,
            value, pl, plPct: p.cost > 0 ? pl / p.cost * 100 : 0,
            avg: p.qty > 0 ? p.cost / p.qty : 0, day, chg: pr?.chg || 0,
            valueUsd: usd ? value / usd : null
        };
    });

    const open = list.filter(p => p.qty > 0);
    const closed = list.filter(p => p.qty === 0);
    const sum = open.reduce((s, p) => {
        s.value += p.value; s.cost += p.cost; s.pl += p.pl; s.day += p.day;
        if (!p.hasPrice) s.missing++;
        return s;
    }, { value: 0, cost: 0, pl: 0, day: 0, missing: 0 });
    sum.realized = list.reduce((s, p) => s + p.realized, 0);
    sum.plPct = sum.cost > 0 ? sum.pl / sum.cost * 100 : 0;
    sum.dayPct = sum.value - sum.day > 0 ? sum.day / (sum.value - sum.day) * 100 : 0;
    sum.usd = usd;
    open.forEach(p => { p.share = sum.value > 0 ? p.value / sum.value * 100 : 0; });

    // Dolar bazında getiri (sadece alış kurunu bildiğimiz pozisyonlar)
    const usdPos = open.filter(p => p.usdOk && p.costUsd > 0);
    sum.usdCoverage = { n: usdPos.length, total: open.length };
    if (usd && usdPos.length) {
        sum.usdCost = usdPos.reduce((s, p) => s + p.costUsd, 0);
        sum.usdValue = usdPos.reduce((s, p) => s + p.value / usd, 0);
        sum.usdPl = sum.usdValue - sum.usdCost;
        sum.usdPct = sum.usdPl / sum.usdCost * 100;
    }
    return { open, closed, all: list, sum, byId: map };
}

function heldQty(assetId, excludeTxId) {
    let q = 0;
    for (const t of sortedTx(S.tx.filter(t => t.asset === assetId && t.id !== excludeTxId))) {
        q += t.type === 'AL' ? t.amount : -Math.min(t.amount, q);
    }
    return Math.max(0, q);
}

// ============================================================
// BİÇİMLENDİRME
// ============================================================

const nfCache = {};
const nf = (min, max = min) => (nfCache[min + '-' + max] ||= new Intl.NumberFormat('tr-TR', { minimumFractionDigits: min, maximumFractionDigits: max }));
const MASK = '•••••';

function money(v, { sign = false, force = false, cur = '₺' } = {}) {
    if (v == null || !isFinite(v)) return '—';
    if (S.settings.hide && !force) return cur + MASK;
    const abs = Math.abs(v);
    const s = (abs >= 100000 ? nf(0) : nf(2)).format(abs);
    const pre = v < 0 ? '−' : (sign && v > 0 ? '+' : '');
    return pre + cur + s;
}
function priceFmt(v) {
    if (v == null || !isFinite(v)) return '—';
    const abs = Math.abs(v);
    return '₺' + (abs >= 1000 ? nf(2) : abs >= 1 ? nf(2, 4) : nf(2, 8)).format(v);
}
function pct(v, { sign = true } = {}) {
    if (v == null || !isFinite(v)) return '—';
    const pre = v < 0 ? '−' : (sign && v > 0 ? '+' : '');
    return pre + '%' + nf(2).format(Math.abs(v));
}
function qty(v, unit) {
    if (S.settings.hide) return MASK + (unit ? ' ' + unit : '');
    const s = nf(0, Math.abs(v) < 1 ? 8 : 4).format(v);
    return unit ? `${s} ${unit}` : s;
}
const tone = v => v > 0.0001 ? 'up' : v < -0.0001 ? 'down' : 'flat';
const arrow = v => v > 0.0001 ? '▲' : v < -0.0001 ? '▼' : '•';

function today() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
const dateObj = s => new Date(s + 'T12:00:00');
const dateFmt = s => dateObj(s).toLocaleDateString('tr-TR', { day: 'numeric', month: 'short', year: 'numeric' });
const monthFmt = s => dateObj(s).toLocaleDateString('tr-TR', { month: 'long', year: 'numeric' });
const timeFmt = t => new Date(t).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
function ago(t) {
    const m = Math.round((Date.now() - t) / 60000);
    if (m < 1) return 'az önce';
    if (m < 60) return `${m} dk önce`;
    const h = Math.round(m / 60);
    if (h < 24) return `${h} sa önce`;
    return `${Math.round(h / 24)} gün önce`;
}
function daysSince(s) { return Math.max(0, Math.round((Date.now() - dateObj(s)) / 86400000)); }
function holdFmt(s) {
    const d = daysSince(s);
    if (d < 31) return `${d} gün`;
    if (d < 365) return `${Math.floor(d / 30)} ay`;
    const y = Math.floor(d / 365), m = Math.floor((d % 365) / 30);
    return m ? `${y} yıl ${m} ay` : `${y} yıl`;
}

function parseNum(s) {
    if (s == null) return NaN;
    s = String(s).trim().replace(/[\s₺$]|TL/gi, '');
    if (!s) return NaN;
    if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
    return Number(s);
}
const toInput = v => (v == null || !isFinite(v)) ? '' : v.toLocaleString('tr-TR', { useGrouping: false, maximumFractionDigits: 8 });

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const shortDesc = d => String(d || '')
    .replace(/\b(A\.?S\.?|A\.O\.|T\.A\.S\.|Anonim Sirketi|Sanayi ve Ticaret|Class [A-Z]|Inc\.?|Corporation|Corp\.?|Holdings?|Ltd\.?|plc)\b/gi, '')
    .replace(/\s+A\.?\s?[SŞO]\.?$/i, '')
    .replace(/[\s,.]+$/g, '').replace(/\s{2,}/g, ' ').trim();

// ============================================================
// İKONLAR
// ============================================================

const svg = p => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${p}</svg>`;
const ICON = {
    plus: svg('<path d="M12 5v14M5 12h14"/>'),
    refresh: svg('<path d="M21 12a9 9 0 1 1-2.64-6.36L21 8"/><path d="M21 3v5h-5"/>'),
    eye: svg('<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>'),
    eyeOff: svg('<path d="M3 3l18 18"/><path d="M10.6 5.1A10.8 10.8 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-3.2 4.2M6.6 6.6A17 17 0 0 0 2 12s3.5 7 10 7a10 10 0 0 0 5.4-1.6"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/>'),
    wallet: svg('<path d="M20 7H5a2 2 0 0 1 0-4h13v4"/><path d="M3 5v14a2 2 0 0 0 2 2h15V7"/><path d="M16 14h.01"/>'),
    list: svg('<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>'),
    pie: svg('<path d="M21 12A9 9 0 1 1 12 3v9z"/><path d="M15 3.3A9 9 0 0 1 20.7 9H15z"/>'),
    sliders: svg('<path d="M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1"/><circle cx="15" cy="6" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="17" cy="18" r="2"/>'),
    x: svg('<path d="M18 6 6 18M6 6l12 12"/>'),
    search: svg('<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>'),
    chev: svg('<path d="m9 6 6 6-6 6"/>'),
    download: svg('<path d="M12 3v12m0 0-4-4m4 4 4-4M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/>'),
    upload: svg('<path d="M12 15V3m0 0L8 7m4-4 4 4M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/>'),
    file: svg('<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6M8 13h8M8 17h8"/>'),
    trash: svg('<path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/>'),
    sort: svg('<path d="M7 4v16m0 0-3-3m3 3 3-3M17 20V4m0 0-3 3m3-3 3 3"/>'),
    edit: svg('<path d="M4 20h4L19 9l-4-4L4 16z"/>'),
    shield: svg('<path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6z"/><path d="m9 12 2 2 4-4"/>'),
    alert: svg('<path d="M12 3 2 21h20z"/><path d="M12 10v4M12 18h.01"/>')
};

// ============================================================
// GENEL ARAYÜZ
// ============================================================

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

let toastTimer;
function toast(msg, type = '') {
    const el = $('#toast');
    el.textContent = msg;
    el.className = 'toast show ' + type;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 2800);
}

function renderStatus() {
    const el = $('#status');
    if (!el) return;
    let txt, cls = '';
    if (S.fetching) { txt = 'Fiyatlar güncelleniyor…'; cls = 'busy'; }
    else if (!S.online) { txt = 'Çevrimdışı · son fiyatlar gösteriliyor'; cls = 'warn'; }
    else if (S.lastFetch) {
        txt = `Fiyatlar ${timeFmt(S.lastFetch)}`;
        if (S.fetchErrors.length) { txt += ` · ${S.fetchErrors.join(', ')} alınamadı`; cls = 'warn'; }
        else cls = 'live';
    } else txt = 'Fiyatlar bekleniyor';
    el.textContent = txt;
    el.className = 'status ' + cls;
}

function setView(v) {
    S.view = v;
    $$('.view').forEach(s => { s.hidden = s.id !== 'view-' + v; });
    $$('#tabbar button').forEach(b => b.classList.toggle('active', b.dataset.view === v));
    $('#fab').hidden = v === 'settings';
    renderView();
    window.scrollTo({ top: 0 });
}

function renderAll() {
    renderStatus();
    $('#btnPrivacy').innerHTML = S.settings.hide ? ICON.eyeOff : ICON.eye;
    renderView();
    sheetStack.forEach(w => w._refresh?.());
}

function renderView() {
    const c = computePositions();
    if (S.view === 'portfolio') renderPortfolio(c);
    else if (S.view === 'history') renderHistory(c);
    else if (S.view === 'analysis') renderAnalysis(c);
    else renderSettings(c);
}

const assetBadge = (a, size = '') =>
    `<span class="badge ${size}" style="--c:${CATS[a.cat]?.color || '#94a3b8'}">${esc(assetIcon(a))}</span>`;

// ---------- PORTFÖY ----------

function renderPortfolio(c) {
    const el = $('#view-portfolio');
    const { sum, open, closed } = c;

    if (!S.tx.length) {
        el.innerHTML = `
            <div class="empty">
                <div class="empty-art">📊</div>
                <h2>Portföyün boş</h2>
                <p>Aldığın altını, dövizi, hisseyi veya kriptoyu ekle; güncel değerini ve kâr/zarar durumunu anlık takip et.</p>
                <button class="btn btn-primary" data-act="add">${ICON.plus} İlk yatırımını ekle</button>
                <button class="btn btn-ghost" data-act="import">${ICON.upload} Yedekten geri yükle</button>
            </div>`;
        return;
    }

    const usdLine = sum.usd ? `≈ ${money(sum.value / sum.usd, { cur: '$' })}` : '';
    const sorters = {
        value: [(a, b) => b.value - a.value, 'Değer'],
        pl: [(a, b) => b.plPct - a.plPct, 'Getiri %'],
        day: [(a, b) => b.chg - a.chg, 'Bugün'],
        name: [(a, b) => assetShort(a.asset).localeCompare(assetShort(b.asset), 'tr'), 'İsim']
    };
    const [sorter, sortLabel] = sorters[S.settings.sort] || sorters.value;
    const rows = [...open].sort(sorter);

    // Kategori dağılım çubuğu
    const catTotals = {};
    open.forEach(p => { catTotals[p.asset.cat] = (catTotals[p.asset.cat] || 0) + p.value; });
    const catBar = Object.entries(catTotals).sort((a, b) => b[1] - a[1])
        .map(([k, v]) => `<i style="flex:${v};background:${CATS[k]?.color}"></i>`).join('');

    el.innerHTML = `
        ${backupBanner()}
        <div class="hero">
            <div class="hero-label">Toplam Portföy Değeri</div>
            <div class="hero-value">${money(sum.value)}</div>
            <div class="hero-usd">${usdLine}</div>
            <div class="hero-pills">
                <div class="pill ${tone(sum.pl)}">
                    <small>Toplam K/Z</small>
                    <b>${money(sum.pl, { sign: true })}</b>
                    <span>${arrow(sum.pl)} ${pct(Math.abs(sum.plPct), { sign: false })}</span>
                </div>
                <div class="pill ${tone(sum.day)}">
                    <small>Bugün</small>
                    <b>${money(sum.day, { sign: true })}</b>
                    <span>${arrow(sum.day)} ${pct(Math.abs(sum.dayPct), { sign: false })}</span>
                </div>
            </div>
            <div class="hero-foot">
                <div><small>Maliyet</small><b>${money(sum.cost)}</b></div>
                <div><small>Gerçekleşen K/Z</small><b class="${tone(sum.realized)}">${money(sum.realized, { sign: true })}</b></div>
            </div>
            ${catBar ? `<div class="catbar">${catBar}</div>` : ''}
        </div>
        ${sum.missing ? `<div class="note warn">${ICON.alert}<span>${sum.missing} varlığın güncel fiyatı yok; maliyetiyle hesaplanıyor. Varlığa dokunup fiyatı elle girebilirsin.</span></div>` : ''}

        <div class="section-head">
            <h2>Varlıklarım <span class="count">${open.length}</span></h2>
            <button class="chip" data-act="sort">${ICON.sort}${sortLabel}</button>
        </div>
        <div class="list">
            ${rows.map(holdingRow).join('') || '<p class="muted pad">Açık pozisyon yok.</p>'}
        </div>

        ${closed.length ? `
        <details class="closed">
            <summary>Kapanan pozisyonlar <span class="count">${closed.length}</span>${ICON.chev}</summary>
            <div class="list">
                ${closed.map(p => `
                    <button class="row" data-detail="${esc(p.id)}">
                        ${assetBadge(p.asset)}
                        <div class="row-main"><b>${esc(assetShort(p.asset))}</b><small>${p.txCount} işlem · tamamı satıldı</small></div>
                        <div class="row-end"><small>Gerçekleşen</small><b class="${tone(p.realized)}">${money(p.realized, { sign: true })}</b></div>
                    </button>`).join('')}
            </div>
        </details>` : ''}
    `;
}

function holdingRow(p) {
    const a = p.asset;
    const sub = a.ticker ? esc(a.name) : CATS[a.cat]?.label || '';
    return `
        <button class="row" data-detail="${esc(p.id)}">
            ${assetBadge(a)}
            <div class="row-main">
                <b>${esc(assetShort(a))}</b>
                <small>${qty(p.qty, a.unit)} · ${p.hasPrice ? priceFmt(p.price) : '<em class="warn-t">fiyat yok</em>'}</small>
                ${a.ticker ? `<small class="sub">${sub}</small>` : ''}
            </div>
            <div class="row-end">
                <b>${money(p.value)}</b>
                ${p.hasPrice
                    ? `<span class="${tone(p.pl)}">${money(p.pl, { sign: true })} · ${pct(p.plPct)}</span>`
                    : '<span class="muted">—</span>'}
                ${p.chg ? `<small class="${tone(p.chg)}">Bugün ${pct(p.chg)}</small>` : ''}
            </div>
        </button>`;
}

function backupBanner() {
    const { lastBackup, lastChange } = S.settings;
    if (!S.tx.length || (lastBackup && lastBackup >= lastChange)) return '';
    const days = lastBackup ? Math.floor((Date.now() - lastBackup) / 86400000) : null;
    if (days !== null && days < 7) return '';
    return `
        <div class="note info">
            ${ICON.shield}
            <span>${days === null ? 'Henüz hiç yedek almadın.' : `Son yedek ${days} gün önce.`} Veriler sadece bu telefonda duruyor.</span>
            <button class="link" data-act="backup">Yedekle</button>
        </div>`;
}

// ---------- İŞLEMLER ----------

function renderHistory(c) {
    const el = $('#view-history');
    if (!S.tx.length) {
        el.innerHTML = `<div class="empty"><div class="empty-art">🧾</div><h2>Henüz işlem yok</h2><p>Alım ve satımların burada tarih sırasıyla listelenir.</p><button class="btn btn-primary" data-act="add">${ICON.plus} İşlem ekle</button></div>`;
        return;
    }
    const f = S.settings.histFilter;
    const list = sortedTx().reverse().filter(t => f === 'all' || t.type === f);
    const groups = {};
    list.forEach(t => { (groups[t.date.slice(0, 7)] ||= []).push(t); });

    const totBuy = S.tx.filter(t => t.type === 'AL').reduce((s, t) => s + t.amount * t.price + (+t.fee || 0), 0);
    const totSell = S.tx.filter(t => t.type === 'SAT').reduce((s, t) => s + t.amount * t.price - (+t.fee || 0), 0);

    el.innerHTML = `
        <div class="mini-stats">
            <div><small>Toplam alış</small><b>${money(totBuy)}</b></div>
            <div><small>Toplam satış</small><b>${money(totSell)}</b></div>
            <div><small>İşlem</small><b>${S.tx.length}</b></div>
        </div>
        <div class="seg seg-wide" role="tablist">
            ${[['all', 'Tümü'], ['AL', 'Alışlar'], ['SAT', 'Satışlar']].map(([k, l]) =>
                `<button data-hist="${k}" class="${f === k ? 'on' : ''}">${l}</button>`).join('')}
        </div>
        ${Object.entries(groups).map(([m, txs]) => `
            <h3 class="group-title">${monthFmt(m + '-01')}</h3>
            <div class="list">${txs.map(txRow).join('')}</div>
        `).join('') || '<p class="muted pad">Bu filtrede işlem yok.</p>'}
    `;
}

function txRow(t) {
    const a = getAsset(t.asset) || { name: t.asset, cat: 'other', unit: '' };
    const total = t.amount * t.price + (t.type === 'AL' ? 1 : -1) * (+t.fee || 0);
    return `
        <button class="row tx" data-tx="${t.id}">
            ${assetBadge(a, 'sm')}
            <div class="row-main">
                <b>${esc(assetShort(a))} <span class="tag ${t.type === 'AL' ? 'buy' : 'sell'}">${t.type === 'AL' ? 'Alış' : 'Satış'}</span></b>
                <small>${dateFmt(t.date)} · ${qty(t.amount, a.unit)} × ${priceFmt(t.price)}</small>
                ${t.note ? `<small class="sub">“${esc(t.note)}”</small>` : ''}
            </div>
            <div class="row-end"><b class="${t.type === 'AL' ? '' : 'up'}">${t.type === 'AL' ? '' : '+'}${money(total)}</b></div>
        </button>`;
}

// ---------- ANALİZ ----------

function donut(parts) {
    const total = parts.reduce((s, p) => s + p.v, 0) || 1;
    let off = 0;
    const segs = parts.map(p => {
        const len = p.v / total * 100;
        const gap = parts.length > 1 ? Math.min(0.6, len / 3) : 0;
        const s = `<circle r="15.915" cx="18" cy="18" fill="none" stroke="${p.c}" stroke-width="4.2"
            stroke-dasharray="${Math.max(0, len - gap)} ${100 - Math.max(0, len - gap)}" stroke-dashoffset="${25 - off}"/>`;
        off += len;
        return s;
    }).join('');
    return `<svg viewBox="0 0 36 36" class="donut-svg">${segs}</svg>`;
}

function renderAnalysis(c) {
    const el = $('#view-analysis');
    const { open, all, sum } = c;
    if (!open.length && !all.length) {
        el.innerHTML = `<div class="empty"><div class="empty-art">📈</div><h2>Analiz için veri yok</h2><p>Yatırım ekledikçe dağılım ve performans grafikleri burada görünecek.</p></div>`;
        return;
    }

    const catTotals = {};
    open.forEach(p => { catTotals[p.asset.cat] = (catTotals[p.asset.cat] || 0) + p.value; });
    const cats = Object.entries(catTotals).sort((a, b) => b[1] - a[1]).map(([k, v]) => ({ k, v, c: CATS[k]?.color, l: CATS[k]?.label }));
    const perf = [...open].filter(p => p.hasPrice).sort((a, b) => b.plPct - a.plPct);
    const maxAbs = Math.max(1, ...perf.map(p => Math.abs(p.plPct)));
    const realizedList = all.filter(p => Math.abs(p.realized) > 0.005).sort((a, b) => b.realized - a.realized);

    el.innerHTML = `
        <div class="card">
            <h3 class="card-title">Varlık dağılımı</h3>
            <div class="donut">
                <div class="donut-wrap">${donut(cats)}<div class="donut-center"><small>Toplam</small><b>${money(sum.value)}</b></div></div>
                <div class="legend">
                    ${cats.map(x => `<div><i style="background:${x.c}"></i><span>${x.l}</span><b>${pct(x.v / sum.value * 100, { sign: false })}</b></div>`).join('')}
                </div>
            </div>
        </div>

        <div class="card">
            <h3 class="card-title">Portföy payları</h3>
            ${[...open].sort((a, b) => b.value - a.value).map(p => `
                <div class="bar-row" data-detail="${esc(p.id)}">
                    <div class="bar-top"><span>${esc(assetShort(p.asset))}</span><span>${money(p.value)} · <b>${pct(p.share, { sign: false })}</b></span></div>
                    <div class="bar"><i style="width:${p.share}%;background:${CATS[p.asset.cat]?.color}"></i></div>
                </div>`).join('')}
        </div>

        ${perf.length ? `
        <div class="card">
            <h3 class="card-title">Getiri sıralaması</h3>
            ${perf.map(p => `
                <div class="perf-row" data-detail="${esc(p.id)}">
                    <span class="perf-name">${esc(assetShort(p.asset))}</span>
                    <div class="perf-bar"><i class="${tone(p.plPct)}" style="width:${Math.abs(p.plPct) / maxAbs * 100}%"></i></div>
                    <b class="${tone(p.plPct)}">${pct(p.plPct)}</b>
                </div>`).join('')}
        </div>` : ''}

        <div class="card">
            <h3 class="card-title">Dolar bazında getiri</h3>
            ${sum.usdCost ? `
                <div class="kv"><span>Maliyet (alış günkü kurla)</span><b>${money(sum.usdCost, { cur: '$' })}</b></div>
                <div class="kv"><span>Bugünkü değer</span><b>${money(sum.usdValue, { cur: '$' })}</b></div>
                <div class="kv"><span>Dolar bazında K/Z</span><b class="${tone(sum.usdPl)}">${money(sum.usdPl, { sign: true, cur: '$' })} · ${pct(sum.usdPct)}</b></div>
                ${sum.usdCoverage.n < sum.usdCoverage.total ? `<p class="muted small">${sum.usdCoverage.total} varlığın ${sum.usdCoverage.n} tanesi hesaba katıldı. Diğerlerinde alış günkü dolar kuru girilmemiş.</p>` : ''}
            ` : `<p class="muted small">TL getirin enflasyonu yeniyor mu? Bunu görmek için işlem eklerken “Alış günü dolar kuru” alanını doldur (bugünkü işlemlerde otomatik dolar). Eski işlemleri düzenleyip kuru ekleyebilirsin.</p>`}
        </div>

        ${realizedList.length ? `
        <div class="card">
            <h3 class="card-title">Gerçekleşen kâr/zarar (satışlar)</h3>
            ${realizedList.map(p => `<div class="kv" data-detail="${esc(p.id)}"><span>${esc(assetShort(p.asset))}</span><b class="${tone(p.realized)}">${money(p.realized, { sign: true })}</b></div>`).join('')}
            <div class="kv total"><span>Toplam</span><b class="${tone(sum.realized)}">${money(sum.realized, { sign: true })}</b></div>
        </div>` : ''}
    `;
}

// ---------- AYARLAR ----------

function renderSettings() {
    const el = $('#view-settings');
    const lb = S.settings.lastBackup;
    el.innerHTML = `
        <div class="card">
            <h3 class="card-title">${ICON.shield} Yedekleme</h3>
            <p class="muted small">Verilerin sadece bu cihazda saklanır. Uygulamayı silersen, tarayıcı verilerini temizlersen veya telefon değiştirirsen kaybolur. Yedek dosyasını Drive, iCloud veya WhatsApp'ta kendine göndererek sakla.</p>
            <p class="small">Son yedek: <b>${lb ? `${dateFmt(new Date(lb).toISOString().slice(0, 10))} (${ago(lb)})` : 'hiç alınmadı'}</b></p>
            <div class="btn-col">
                <button class="btn btn-primary" data-act="backup">${ICON.download} Yedek al (dosya)</button>
                <button class="btn btn-ghost" data-act="import">${ICON.upload} Yedekten geri yükle</button>
                <button class="btn btn-ghost" data-act="csv">${ICON.file} Excel için dışa aktar (CSV)</button>
            </div>
        </div>

        <div class="card">
            <h3 class="card-title">Altın & döviz fiyat kaynağı</h3>
            <p class="muted small">Ziraat'ten aldıysan Ziraat'i seç; kâr/zarar bankanın gerçek alış-satış fiyatıyla hesaplanır. Ziraat'te olmayan altınlar (çeyrek, Cumhuriyet, bilezik…) kuyumcu fiyatıyla gösterilir.</p>
            <div class="seg seg-wide seg-3">
                ${Object.entries(FX_SOURCES).map(([k, v]) => `<button data-src="${k}" class="${S.settings.fxSource === k ? 'on' : ''}">${v.label}</button>`).join('')}
            </div>
            ${FX_SOURCES[S.settings.fxSource]?.table ? `<p class="muted small">Fiyatları yenileyince Ziraat'ten anlık çekilir. Son Ziraat verisi: <b>${S.settings.zrTime ? ago(S.settings.zrTime) : 'henüz alınmadı'}</b></p>` : ''}
        </div>

        <div class="card">
            <h3 class="card-title">Altın & döviz değerleme</h3>
            <p class="muted small">Banka/kuyumcu iki fiyat verir. “Alış” fiyatı, elindekini bugün bozdursan alacağın paradır; gerçekçi kâr/zarar için önerilir.</p>
            <div class="seg seg-wide">
                <button data-val="buy" class="${S.settings.valuation === 'buy' ? 'on' : ''}">Alış (bozdurma)</button>
                <button data-val="sell" class="${S.settings.valuation === 'sell' ? 'on' : ''}">Satış</button>
            </div>
        </div>

        <div class="card">
            <h3 class="card-title">Fiyat kaynakları</h3>
            <div class="kv"><span>Altın, gümüş, döviz</span><b>${FX_SOURCES[S.settings.fxSource]?.table ? `${FX_SOURCES[S.settings.fxSource].label} + Truncgil` : 'Truncgil Finans'}</b></div>
            <div class="kv"><span>Kripto</span><b>Binance (TRY)</b></div>
            <div class="kv"><span>BIST & ABD hisseleri</span><b>TradingView</b></div>
            <div class="kv"><span>Fonlar</span><b>Elle giriş</b></div>
            <p class="muted small">BIST fiyatları ~15 dk gecikmeli olabilir. Fiyatlar uygulama açıkken 5 dakikada bir yenilenir. Bilgi amaçlıdır, yatırım tavsiyesi değildir.</p>
        </div>

        <div class="card danger-zone">
            <h3 class="card-title">Tehlikeli bölge</h3>
            <button class="btn btn-danger" data-act="wipe">${ICON.trash} Tüm verileri sil</button>
        </div>

        <p class="version">InvestIQ v${VERSION}</p>
    `;
}

// ============================================================
// ALT PENCERE (BOTTOM SHEET) SİSTEMİ
// ============================================================

const sheetStack = [];
const popWaiters = [];

function openSheet({ title, body, cls = '', onMount, refresh }) {
    const wrap = document.createElement('div');
    wrap.className = 'sheet-wrap';
    wrap.innerHTML = `
        <div class="sheet-backdrop"></div>
        <div class="sheet ${cls}" role="dialog" aria-modal="true" aria-label="${esc(title)}">
            <div class="sheet-grip"></div>
            <div class="sheet-head"><h3>${title}</h3><button class="icon-btn" data-close aria-label="Kapat">${ICON.x}</button></div>
            <div class="sheet-body">${body}</div>
        </div>`;
    $('#sheets').appendChild(wrap);
    sheetStack.push(wrap);
    document.body.classList.add('noscroll');
    history.pushState({ sheet: sheetStack.length }, '');
    wrap.querySelector('.sheet-backdrop').addEventListener('click', closeSheet);
    wrap.querySelector('[data-close]').addEventListener('click', closeSheet);
    if (refresh) wrap._refresh = () => refresh(wrap.querySelector('.sheet'));
    requestAnimationFrame(() => requestAnimationFrame(() => wrap.classList.add('open')));
    onMount?.(wrap.querySelector('.sheet'));
    return wrap;
}

// history.back() ile kapatılır; böylece Android geri tuşu da pencereyi kapatır
function closeSheet() {
    if (!sheetStack.length) return Promise.resolve();
    return new Promise(res => { popWaiters.push(res); history.back(); });
}

window.addEventListener('popstate', () => {
    const w = sheetStack.pop();
    if (w) {
        w.classList.remove('open');
        setTimeout(() => w.remove(), 260);
    }
    if (!sheetStack.length) document.body.classList.remove('noscroll');
    popWaiters.shift()?.();
});

// ---------- İŞLEM FORMU ----------

function openTxForm({ assetId = null, type = 'AL', tx = null } = {}) {
    const editing = !!tx;
    const f = {
        type: tx?.type || type,
        asset: tx?.asset || assetId,
        date: tx?.date || today(),
        priceMode: 'unit'
    };

    const body = `
        <form class="form" novalidate>
            <div class="seg seg-wide seg-type">
                <button type="button" data-type="AL">Alış</button>
                <button type="button" data-type="SAT">Satış</button>
            </div>

            <div class="field">
                <span class="lbl">Varlık</span>
                <button type="button" class="asset-pick" id="fAsset"></button>
            </div>

            <div class="row2">
                <label class="field">
                    <span class="lbl">Miktar</span>
                    <div class="input-wrap"><input id="fAmount" inputmode="decimal" autocomplete="off" placeholder="0" value="${tx ? toInput(tx.amount) : ''}"><em id="fUnit" class="suffix"></em></div>
                </label>
                <label class="field">
                    <span class="lbl">Tarih</span>
                    <input id="fDate" type="date" value="${f.date}" max="${today()}">
                </label>
            </div>
            <div id="fHeld" class="hint"></div>

            <div class="field">
                <div class="lbl-row">
                    <span class="lbl">Fiyat</span>
                    <div class="seg seg-mini">
                        <button type="button" data-pm="unit" class="on">Birim</button>
                        <button type="button" data-pm="total">Toplam tutar</button>
                    </div>
                </div>
                <div class="input-wrap"><em class="prefix">₺</em><input id="fPrice" inputmode="decimal" autocomplete="off" placeholder="0" value="${tx ? toInput(tx.price) : ''}"></div>
                <div id="fCur" class="hint"></div>
            </div>

            <div id="fCalc" class="calc"></div>

            <details class="more" ${tx && (tx.fee || tx.usd || tx.note) ? 'open' : ''}>
                <summary>Komisyon, dolar kuru ve not ${ICON.chev}</summary>
                <div class="row2">
                    <label class="field">
                        <span class="lbl">Komisyon / masraf</span>
                        <div class="input-wrap"><em class="prefix">₺</em><input id="fFee" inputmode="decimal" placeholder="0" value="${tx?.fee ? toInput(tx.fee) : ''}"></div>
                    </label>
                    <label class="field">
                        <span class="lbl">O günkü dolar kuru</span>
                        <div class="input-wrap"><em class="prefix">₺</em><input id="fUsd" inputmode="decimal" placeholder="ör. 41,20" value="${tx?.usd ? toInput(tx.usd) : ''}"></div>
                    </label>
                </div>
                <label class="field">
                    <span class="lbl">Not</span>
                    <input id="fNote" maxlength="140" placeholder="ör. Kapalıçarşı, düğün hediyesi…" value="${esc(tx?.note || '')}">
                </label>
            </details>

            <p id="fErr" class="form-err"></p>
            <div class="sheet-actions">
                ${editing ? `<button type="button" class="btn btn-danger-ghost" id="fDelete">${ICON.trash}</button>` : ''}
                <button type="submit" class="btn btn-primary grow">${editing ? 'Değişiklikleri kaydet' : 'Kaydet'}</button>
            </div>
        </form>`;

    openSheet({
        title: editing ? 'İşlemi düzenle' : 'Yeni işlem',
        body,
        cls: 'tall',
        onMount(sheet) {
            const form = $('form', sheet);
            const amountEl = $('#fAmount', sheet), priceEl = $('#fPrice', sheet), dateEl = $('#fDate', sheet);
            const feeEl = $('#fFee', sheet), usdEl = $('#fUsd', sheet);

            const autoUsd = () => {
                // Bugünkü işlemlerde dolar kurunu otomatik doldur
                const r = usdRate();
                if (!usdEl.value && dateEl.value === today() && r) usdEl.value = toInput(+r.toFixed(4));
            };

            const sync = () => {
                $$('[data-type]', sheet).forEach(b => b.classList.toggle('on', b.dataset.type === f.type));
                $('.seg-type', sheet).dataset.t = f.type;
                $$('[data-pm]', sheet).forEach(b => b.classList.toggle('on', b.dataset.pm === f.priceMode));
                const a = f.asset && getAsset(f.asset);
                $('#fAsset', sheet).innerHTML = a
                    ? `${assetBadge(a, 'sm')}<span class="ap-main"><b>${esc(assetShort(a))}</b><small>${esc(a.ticker ? a.name : CATS[a.cat]?.label)}</small></span>${ICON.chev}`
                    : `<span class="ap-empty">${ICON.search} Varlık seç (altın, dolar, hisse…)</span>${ICON.chev}`;
                $('#fUnit', sheet).textContent = a?.unit || '';

                const pr = a && priceOf(a.id);
                $('#fCur', sheet).innerHTML = pr?.p
                    ? `Güncel: <b>${priceFmt(pr.p)}</b> <button type="button" class="link" id="fUseCur">Bu fiyatı kullan</button>`
                    : '';

                const held = a ? heldQty(a.id, tx?.id) : 0;
                $('#fHeld', sheet).innerHTML = a && f.type === 'SAT'
                    ? `Elindeki: <b>${qty(held, a.unit)}</b> ${held > 0 ? '<button type="button" class="link" id="fAll">Tümünü sat</button>' : ''}`
                    : '';
                calc();
            };

            const calc = () => {
                const amt = parseNum(amountEl.value), pv = parseNum(priceEl.value), fee = parseNum(feeEl.value) || 0;
                const el = $('#fCalc', sheet);
                if (!(amt > 0) || !(pv > 0)) { el.innerHTML = ''; return; }
                const unit = f.priceMode === 'unit' ? pv : pv / amt;
                const total = f.priceMode === 'unit' ? pv * amt : pv;
                const net = f.type === 'AL' ? total + fee : total - fee;
                el.innerHTML = f.priceMode === 'unit'
                    ? `<span>${f.type === 'AL' ? 'Ödenen' : 'Alınan'} toplam</span><b>${money(net, { force: true })}</b>`
                    : `<span>Birim fiyat</span><b>${priceFmt(unit)}</b>`;
            };

            sheet.addEventListener('click', e => {
                const t = e.target.closest('button');
                if (!t) return;
                if (t.dataset.type) { f.type = t.dataset.type; sync(); }
                else if (t.dataset.pm) {
                    // Birim ↔ toplam arasında geçerken mevcut değeri çevir
                    const amt = parseNum(amountEl.value), pv = parseNum(priceEl.value);
                    if (t.dataset.pm !== f.priceMode && amt > 0 && pv > 0) {
                        priceEl.value = toInput(+(t.dataset.pm === 'total' ? pv * amt : pv / amt).toFixed(6));
                    }
                    f.priceMode = t.dataset.pm; sync();
                }
                else if (t.id === 'fAsset') openPicker(id => { f.asset = id; sync(); if (!amountEl.value) amountEl.focus(); });
                else if (t.id === 'fUseCur') {
                    const pr = priceOf(f.asset);
                    if (!pr) return;
                    const amt = parseNum(amountEl.value);
                    priceEl.value = toInput(+(f.priceMode === 'total' && amt > 0 ? pr.p * amt : pr.p).toFixed(4));
                    calc();
                }
                else if (t.id === 'fAll') { amountEl.value = toInput(heldQty(f.asset, tx?.id)); calc(); }
                else if (t.id === 'fDelete') {
                    if (confirm('Bu işlem silinsin mi?')) {
                        S.tx = S.tx.filter(x => x.id !== tx.id);
                        saveTx();
                        closeSheet().then(() => { renderAll(); toast('İşlem silindi'); });
                    }
                }
            });
            [amountEl, priceEl, feeEl].forEach(i => i.addEventListener('input', calc));
            dateEl.addEventListener('change', autoUsd);

            form.addEventListener('submit', e => {
                e.preventDefault();
                const err = m => { $('#fErr', sheet).textContent = m; };
                const amt = parseNum(amountEl.value), pv = parseNum(priceEl.value);
                const fee = parseNum(feeEl.value) || 0, usd = parseNum(usdEl.value);
                if (!f.asset) return err('Lütfen bir varlık seç.');
                if (!(amt > 0)) return err('Geçerli bir miktar gir.');
                if (!(pv > 0)) return err('Geçerli bir fiyat gir.');
                if (!dateEl.value) return err('Tarih seç.');
                if (dateEl.value > today()) return err('Gelecek tarihli işlem girilemez.');
                if (f.type === 'SAT') {
                    const held = heldQty(f.asset, tx?.id);
                    if (amt > held + 1e-9) return err(`Elinde sadece ${qty(held, getAsset(f.asset)?.unit)} var.`);
                }
                const rec = {
                    id: tx?.id || Date.now(),
                    asset: f.asset,
                    type: f.type,
                    date: dateEl.value,
                    amount: amt,
                    price: f.priceMode === 'unit' ? pv : pv / amt,
                    fee: fee > 0 ? fee : 0,
                    usd: usd > 0 ? usd : undefined,
                    note: $('#fNote', sheet).value.trim()
                };
                if (editing) S.tx = S.tx.map(x => x.id === tx.id ? rec : x);
                else S.tx.push(rec);
                saveTx();
                const isNewAsset = !S.prices[f.asset] && getAsset(f.asset)?.src !== 'manual';
                closeSheet().then(() => {
                    renderAll();
                    toast(editing ? 'İşlem güncellendi ✓' : 'İşlem kaydedildi ✓', 'ok');
                    if (isNewAsset) refreshPrices({ silent: true });
                });
            });

            autoUsd();
            sync();
            if (!f.asset) setTimeout(() => openPicker(id => { f.asset = id; sync(); amountEl.focus(); }), 280);
        }
    });
}

// ---------- VARLIK SEÇİCİ ----------

function openPicker(onPick) {
    const used = new Set(S.tx.map(t => t.asset));
    let cat = 'gold';
    let q = '';
    let searchSeq = 0;
    let remote = [];   // TradingView / Binance sonuçları

    const body = `
        <div class="search-box">${ICON.search}<input id="pQ" type="search" placeholder="Ara: çeyrek, dolar, THYAO, AAPL, BTC…" autocomplete="off" enterkeyhint="search"></div>
        <div class="chips-scroll">
            ${Object.entries(CATS).map(([k, c]) => `<button class="chip" data-cat="${k}" style="--c:${c.color}">${c.label}</button>`).join('')}
        </div>
        <div id="pList" class="pick-list"></div>`;

    openSheet({
        title: 'Varlık seç',
        body,
        cls: 'tall',
        onMount(sheet) {
            const listEl = $('#pList', sheet);
            const input = $('#pQ', sheet);

            const item = (id, a, extra = '') => {
                const pr = priceOf(id);
                return `
                    <button class="row pick" data-pick="${esc(id)}">
                        ${assetBadge(a, 'sm')}
                        <div class="row-main"><b>${esc(assetShort(a))}</b><small>${esc(a.ticker ? a.name : (CATS[a.cat]?.label || ''))}${used.has(id) ? ' · portföyde' : ''}</small></div>
                        <div class="row-end">${pr?.p ? `<b>${priceFmt(pr.p)}</b>` : ''}${extra}</div>
                    </button>`;
            };

            const localMatches = () => {
                const all = [
                    ...Object.entries(CATALOG).map(([id, a]) => [id, { id, ...a }]),
                    ...Object.entries(S.assets).map(([id, a]) => [id, { id, ...a }])
                ];
                if (!q) return all.filter(([, a]) => a.cat === cat);
                const n = q.toLocaleLowerCase('tr');
                return all.filter(([id, a]) =>
                    a.name.toLocaleLowerCase('tr').includes(n) ||
                    (a.ticker || '').toLocaleLowerCase('tr').includes(n) ||
                    id.toLocaleLowerCase('tr').includes(n));
            };

            const render = () => {
                $$('[data-cat]', sheet).forEach(b => b.classList.toggle('on', !q && b.dataset.cat === cat));
                const local = localMatches();
                const localIds = new Set(local.map(([id]) => id));
                const rem = remote.filter(r => !localIds.has(r.id));
                let html = local.map(([id, a]) => item(id, a)).join('');
                if (rem.length) html += `${q ? '<h4 class="pick-h">Borsa / kripto sonuçları</h4>' : ''}${rem.map(r => item(r.id, r)).join('')}`;

                if (!q && cat === 'fund') html += fundForm();
                if (!q && cat === 'other') html += otherForm();
                if (!q && (cat === 'bist' || cat === 'us') && !rem.length && !local.length) html += '<p class="muted pad small">Yükleniyor…</p>';
                if (q && !html) html = `<p class="muted pad small">Sonuç yok. Hisse için kodunu (ör. THYAO, AAPL) yaz. Fonlar için “Fon” sekmesinden ekleyebilirsin.</p>`;
                listEl.innerHTML = html;
            };

            const fundForm = () => `
                <div class="inline-form">
                    <h4>Yeni fon ekle</h4>
                    <p class="muted small">TEFAS fon fiyatları otomatik çekilemiyor; fiyatı varlık detayından elle güncelleyebilirsin.</p>
                    <input id="nfCode" placeholder="Fon kodu (ör. TTE, AFT)" maxlength="8" autocapitalize="characters">
                    <input id="nfName" placeholder="Fon adı (opsiyonel)" maxlength="60">
                    <input id="nfPrice" inputmode="decimal" placeholder="Güncel birim fiyat (₺)">
                    <button class="btn btn-ghost" data-new="fund">${ICON.plus} Fonu ekle</button>
                </div>`;
            const otherForm = () => `
                <div class="inline-form">
                    <h4>Özel varlık ekle</h4>
                    <p class="muted small">Listede olmayan her şey için (arsa, araba, mevduat, eurobond…). Fiyatı elle güncellenir.</p>
                    <input id="noName" placeholder="Varlık adı" maxlength="40">
                    <input id="noUnit" placeholder="Birim (ör. adet, m², lot)" maxlength="10">
                    <input id="noPrice" inputmode="decimal" placeholder="Güncel birim değer (₺)">
                    <button class="btn btn-ghost" data-new="other">${ICON.plus} Varlığı ekle</button>
                </div>`;

            // Popüler BIST / ABD hisselerini fiyatlarıyla getir
            const loadPopular = async (c) => {
                const seq = ++searchSeq;
                remote = [];
                try {
                    const market = c === 'bist' ? 'turkey' : 'america';
                    const rows = await tvScan(market, {
                        filter: [{ left: 'name', operation: 'in_range', right: POPULAR[c] }, ...(c === 'us' ? [{ left: 'is_primary', operation: 'equal', right: true }] : [])],
                        columns: ['name', 'close', 'change', 'currency', 'description'],
                        sort: { sortBy: 'market_cap_basic', sortOrder: 'desc' },
                        range: [0, 30]
                    });
                    if (seq !== searchSeq) return;
                    remote = rows.map(tvRowToAsset);
                } catch { if (seq === searchSeq) remote = []; }
                if (seq === searchSeq) render();
            };

            const remoteSearch = async () => {
                const seq = ++searchSeq;
                const term = q.toUpperCase().replace(/[^A-Z0-9.]/g, '');
                remote = [];
                if (term.length < 2) {
                    if (!q && (cat === 'bist' || cat === 'us')) return loadPopular(cat);
                    return render();
                }
                const results = [];
                const jobs = [
                    tvScan('turkey', { filter: [{ left: 'name', operation: 'match', right: term }], columns: ['name', 'close', 'change', 'currency', 'description'], sort: { sortBy: 'market_cap_basic', sortOrder: 'desc' }, range: [0, 8] })
                        .then(r => results.push(...r.map(tvRowToAsset))).catch(() => {}),
                    tvScan('america', { filter: [{ left: 'name', operation: 'match', right: term }, { left: 'is_primary', operation: 'equal', right: true }], columns: ['name', 'close', 'change', 'currency', 'description'], sort: { sortBy: 'market_cap_basic', sortOrder: 'desc' }, range: [0, 6] })
                        .then(r => results.push(...r.map(tvRowToAsset))).catch(() => {})
                ];
                if (!CATALOG[term] && /^[A-Z0-9]{2,10}$/.test(term)) {
                    jobs.push(fetchJSON('https://api.binance.com/api/v3/ticker/24hr?symbol=' + term + 'TRY', {}, 6000)
                        .then(r => {
                            const id = 'CR:' + term;
                            const a = { id, name: term, ticker: term, cat: 'crypto', src: 'bn', sym: term + 'TRY', unit: term, ic: term.slice(0, 3) };
                            S.prices[id] = { p: +r.lastPrice, chg: +r.priceChangePercent || 0, t: Date.now() };
                            results.unshift(a);
                        }).catch(() => {}));
                }
                await Promise.all(jobs);
                if (seq !== searchSeq) return;
                // Tam eşleşenleri öne al
                remote = results.sort((a, b) => (b.ticker === term) - (a.ticker === term));
                render();
            };

            let debounce;
            const loadCryptoPrices = () => {
                const list = Object.entries(CATALOG).filter(([id, a]) => a.src === 'bn' && !S.prices[id]).map(([id, a]) => ({ id, ...a }));
                if (list.length) fetchBinance(list).then(() => { savePrices(); render(); }).catch(() => {});
            };
            input.addEventListener('input', () => {
                q = input.value.trim();
                render();
                clearTimeout(debounce);
                debounce = setTimeout(remoteSearch, 350);
            });

            sheet.addEventListener('click', e => {
                const b = e.target.closest('button');
                if (!b) return;
                if (b.dataset.cat) {
                    clearTimeout(debounce);
                    cat = b.dataset.cat; q = ''; input.value = ''; remote = [];
                    render();
                    if (cat === 'bist' || cat === 'us') loadPopular(cat);
                    if (cat === 'crypto') loadCryptoPrices();
                    b.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });
                } else if (b.dataset.pick) {
                    const id = b.dataset.pick;
                    const r = remote.find(x => x.id === id);
                    if (r && !CATALOG[id] && !S.assets[id]) {
                        const { id: _, ...rest } = r;
                        S.assets[id] = rest;
                        saveAssets();
                        savePrices();
                    }
                    closeSheet().then(() => onPick(id));
                } else if (b.dataset.new === 'fund') {
                    const code = $('#nfCode', sheet).value.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
                    if (!code) return toast('Fon kodu gir', 'err');
                    const id = 'FUND:' + code;
                    S.assets[id] ||= { name: $('#nfName', sheet).value.trim() || code + ' Fonu', ticker: code, cat: 'fund', src: 'manual', unit: 'pay' };
                    const p = parseNum($('#nfPrice', sheet).value);
                    if (p > 0) { S.manual[id] = { p, t: Date.now() }; saveManual(); }
                    saveAssets();
                    closeSheet().then(() => onPick(id));
                } else if (b.dataset.new === 'other') {
                    const name = $('#noName', sheet).value.trim();
                    if (!name) return toast('Varlık adı gir', 'err');
                    const id = 'OTH:' + Date.now().toString(36);
                    S.assets[id] = { name, cat: 'other', src: 'manual', unit: $('#noUnit', sheet).value.trim() || 'adet', ic: name.slice(0, 2).toUpperCase() };
                    const p = parseNum($('#noPrice', sheet).value);
                    if (p > 0) { S.manual[id] = { p, t: Date.now() }; saveManual(); }
                    saveAssets();
                    closeSheet().then(() => onPick(id));
                }
            });

            render();
            // Elle girilen fiyatlar varsa katalog fiyatlarını da göstermek için (ilk açılışta) truncgil'i tazele
            if (!S.prices.GRA) fetchFxGold().catch(() => {}).then(() => { savePrices(); render(); });
        }
    });
}

function tvRowToAsset(r) {
    const [ex, tk] = r.s.split(':');
    const isTR = ex === 'BIST';
    const p = toTRY(+r.d[1], r.d[3]);
    if (p != null) S.prices[r.s] ??= { p, chg: +r.d[2] || 0, t: Date.now(), ccy: r.d[3], raw: +r.d[1] };
    return {
        id: r.s, name: shortDesc(r.d[4]) || tk, ticker: tk,
        cat: isTR ? 'bist' : 'us', src: 'tv', sym: r.s, unit: 'adet'
    };
}

// ---------- VARLIK DETAYI ----------

function openDetail(id) {
    const content = () => {
        const c = computePositions();
        const p = c.all.find(x => x.id === id);
        const a = getAsset(id) || { id, name: id, cat: 'other', unit: '' };
        if (!p) return '<p class="muted pad">Bu varlığa ait işlem kalmadı.</p>';
        const pr = p.priceInfo;
        const src = pr ? (pr.manual ? `elle girildi · ${ago(pr.t)}` : `${pr.src === 'zr' ? FX_SOURCES[S.settings.fxSource]?.label || 'Ziraat' : 'otomatik'} · ${ago(pr.t)}`) : 'fiyat yok';
        const txs = sortedTx(S.tx.filter(t => t.asset === id)).reverse();
        const usdNow = usdRate();

        return `
            <div class="d-hero">
                ${assetBadge(a, 'lg')}
                <div>
                    <h2>${esc(assetShort(a))}</h2>
                    <small>${esc(a.ticker ? a.name + ' · ' : '')}${CATS[a.cat]?.label || ''}</small>
                </div>
            </div>
            ${p.qty > 0 ? `
            <div class="d-value">
                <div><small>Güncel değer</small><b>${money(p.value)}</b></div>
                <div class="${tone(p.pl)}"><small>Kâr / Zarar</small><b>${money(p.pl, { sign: true })}</b><span>${arrow(p.pl)} ${pct(Math.abs(p.plPct), { sign: false })}</span></div>
            </div>` : ''}
            <div class="stat-grid">
                <div><small>Miktar</small><b>${qty(p.qty, a.unit)}</b></div>
                <div><small>Ortalama maliyet</small><b>${p.qty > 0 ? priceFmt(p.avg) : '—'}</b></div>
                <button class="stat-btn" data-act="price"><small>Güncel fiyat ${ICON.edit}</small><b>${p.hasPrice ? priceFmt(p.price) : 'Gir'}</b><em>${src}</em></button>
                <div><small>Bugünkü değişim</small><b class="${tone(p.chg)}">${p.chg ? pct(p.chg) : '—'}</b></div>
                <div><small>Toplam maliyet</small><b>${money(p.cost)}</b></div>
                <div><small>Gerçekleşen K/Z</small><b class="${tone(p.realized)}">${money(p.realized, { sign: true })}</b></div>
                ${p.qty > 0 ? `<div><small>Portföy payı</small><b>${pct(p.share, { sign: false })}</b></div>
                <div><small>Elde tutma</small><b>${holdFmt(p.first)}</b></div>` : ''}
                ${p.qty > 0 && p.usdOk && p.costUsd > 0 && usdNow ? `
                <div class="wide"><small>Dolar bazında</small><b class="${tone(p.value / usdNow - p.costUsd)}">${money(p.costUsd, { cur: '$' })} → ${money(p.value / usdNow, { cur: '$' })} · ${pct((p.value / usdNow - p.costUsd) / p.costUsd * 100)}</b></div>` : ''}
            </div>
            <div class="d-actions">
                <button class="btn btn-buy" data-act="buy">${ICON.plus} Alış ekle</button>
                <button class="btn btn-sell" data-act="sell" ${p.qty > 0 ? '' : 'disabled'}>Satış ekle</button>
            </div>
            <h4 class="group-title">İşlem geçmişi <span class="count">${txs.length}</span></h4>
            <div class="list">${txs.map(txRow).join('')}</div>
        `;
    };

    openSheet({
        title: 'Varlık detayı',
        body: `<div class="detail">${content()}</div>`,
        cls: 'tall',
        refresh(sheet) { $('.detail', sheet).innerHTML = content(); },
        onMount(sheet) {
            sheet.addEventListener('click', e => {
                const b = e.target.closest('button');
                if (!b) return;
                if (b.dataset.act === 'buy') openTxForm({ assetId: id, type: 'AL' });
                else if (b.dataset.act === 'sell') openTxForm({ assetId: id, type: 'SAT' });
                else if (b.dataset.act === 'price') openPriceSheet(id);
                else if (b.dataset.tx) openTxForm({ tx: S.tx.find(t => t.id === +b.dataset.tx) });
            });
        }
    });
}

function openPriceSheet(id) {
    const a = getAsset(id);
    const pr = priceOf(id);
    const isAuto = a && a.src !== 'manual';
    openSheet({
        title: 'Fiyatı güncelle',
        body: `
            <form class="form">
                <p class="muted small">${esc(assetShort(a))} için 1 ${esc(a.unit || 'birim')} güncel fiyatı.${isAuto ? ' Elle girdiğin fiyat, bir sonraki otomatik güncellemeye kadar kullanılır.' : ''}</p>
                <div class="input-wrap"><em class="prefix">₺</em><input id="mpVal" inputmode="decimal" value="${pr ? toInput(+pr.p.toFixed(4)) : ''}" placeholder="0"></div>
                <div class="sheet-actions">
                    ${isAuto && S.manual[id] ? '<button type="button" class="btn btn-ghost" id="mpClear">Otomatiğe dön</button>' : ''}
                    <button class="btn btn-primary grow">Kaydet</button>
                </div>
            </form>`,
        onMount(sheet) {
            const inp = $('#mpVal', sheet);
            setTimeout(() => inp.focus(), 250);
            $('form', sheet).addEventListener('submit', e => {
                e.preventDefault();
                const v = parseNum(inp.value);
                if (!(v > 0)) return toast('Geçerli bir fiyat gir', 'err');
                S.manual[id] = { p: v, t: Date.now() };
                saveManual();
                closeSheet().then(() => { renderAll(); toast('Fiyat güncellendi ✓', 'ok'); });
            });
            $('#mpClear', sheet)?.addEventListener('click', () => {
                delete S.manual[id];
                saveManual();
                closeSheet().then(() => { renderAll(); refreshPrices({ silent: true }); });
            });
        }
    });
}

// ============================================================
// YEDEKLEME
// ============================================================

async function doBackup() {
    const data = {
        app: 'InvestIQ', version: VERSION, exportedAt: new Date().toISOString(),
        transactions: S.tx, assets: S.assets, manualPrices: S.manual,
        settings: { valuation: S.settings.valuation, fxSource: S.settings.fxSource }
    };
    const name = `investiq-yedek-${today()}.json`;
    const file = new File([JSON.stringify(data, null, 2)], name, { type: 'application/json' });
    const ok = await shareOrDownload(file, 'InvestIQ yedeği');
    if (ok) {
        S.settings.lastBackup = Date.now();
        saveSettings();
        renderAll();
        toast('Yedek hazırlandı ✓', 'ok');
    }
}

async function shareOrDownload(file, title) {
    // Mobilde paylaşım menüsü (Drive, WhatsApp, Dosyalar…) en güvenilir yol
    if (navigator.canShare?.({ files: [file] })) {
        try { await navigator.share({ files: [file], title }); return true; }
        catch (e) { if (e.name === 'AbortError') return false; }
    }
    const url = URL.createObjectURL(file);
    const a = document.createElement('a');
    a.href = url; a.download = file.name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    return true;
}

function exportCSV() {
    const head = ['Tarih', 'Varlık', 'Kod', 'İşlem', 'Miktar', 'Birim', 'Birim Fiyat (TL)', 'Tutar (TL)', 'Komisyon (TL)', 'Dolar Kuru', 'Not'];
    const n = v => v == null || v === '' ? '' : String(v).replace('.', ',');
    const q = s => `"${String(s ?? '').replace(/"/g, '""')}"`;
    const rows = sortedTx().map(t => {
        const a = getAsset(t.asset) || { name: t.asset, unit: '' };
        return [t.date, q(a.name), q(a.ticker || t.asset), t.type === 'AL' ? 'Alış' : 'Satış', n(t.amount), q(a.unit), n(t.price), n(+(t.amount * t.price).toFixed(2)), n(t.fee || ''), n(t.usd || ''), q(t.note)].join(';');
    });
    const csv = '﻿' + [head.join(';'), ...rows].join('\r\n');
    shareOrDownload(new File([csv], `investiq-islemler-${today()}.csv`, { type: 'text/csv' }), 'InvestIQ işlemleri');
}

async function importFromText(text) {
    let d;
    try { d = JSON.parse(text); } catch { return toast('Dosya okunamadı — geçerli bir yedek değil', 'err'); }

    let tx, assets = {}, manual = {};
    if (Array.isArray(d)) {
        // Eski sürümden alınmış yedek
        tx = convertLegacyTx(d);
    } else if (d && Array.isArray(d.transactions)) {
        tx = d.transactions.filter(t => t && t.asset && +t.amount > 0 && +t.price >= 0);
        assets = d.assets || {};
        manual = d.manualPrices || {};
    } else return toast('Bu dosya bir InvestIQ yedeği değil', 'err');

    const msg = S.tx.length
        ? `Yedekte ${tx.length} işlem var. Mevcut ${S.tx.length} işlemin yerine geçsin mi?\n(Mevcut veriler güvenlik için ayrıca saklanır.)`
        : `Yedekten ${tx.length} işlem yüklensin mi?`;
    if (!confirm(msg)) return;

    if (S.tx.length) store(LS.prev, { savedAt: Date.now(), transactions: S.tx, assets: S.assets, manualPrices: S.manual });
    S.tx = tx;
    S.assets = { ...S.assets, ...assets };
    S.manual = { ...S.manual, ...manual };
    if (d.settings?.valuation) S.settings.valuation = d.settings.valuation;
    if (FX_SOURCES[d.settings?.fxSource]) S.settings.fxSource = d.settings.fxSource;
    S.settings.lastBackup = Date.now();
    saveTx(); saveAssets(); saveManual(); saveSettings();
    setView('portfolio');
    toast(`${tx.length} işlem yüklendi ✓`, 'ok');
    refreshPrices({ silent: true });
}

// ============================================================
// OLAYLAR & BAŞLATMA
// ============================================================

function bindEvents() {
    $('#fab').innerHTML = ICON.plus;
    $('#btnRefresh').innerHTML = ICON.refresh;
    $$('[data-icon]').forEach(el => { el.innerHTML = ICON[el.dataset.icon]; });

    $('#fab').addEventListener('click', () => openTxForm());
    $('#btnRefresh').addEventListener('click', () => refreshPrices());
    $('#btnPrivacy').addEventListener('click', () => {
        S.settings.hide = !S.settings.hide;
        saveSettings();
        renderAll();
    });
    $('#tabbar').addEventListener('click', e => {
        const b = e.target.closest('button[data-view]');
        if (b) setView(b.dataset.view);
    });

    $('#main').addEventListener('click', e => {
        const t = e.target.closest('[data-act],[data-detail],[data-tx],[data-hist],[data-val],[data-src]');
        if (!t) return;
        if (t.dataset.detail) return openDetail(t.dataset.detail);
        if (t.dataset.tx) return openTxForm({ tx: S.tx.find(x => x.id === +t.dataset.tx) });
        if (t.dataset.hist) { S.settings.histFilter = t.dataset.hist; saveSettings(); return renderView(); }
        if (t.dataset.val) { S.settings.valuation = t.dataset.val; saveSettings(); return renderAll(); }
        if (t.dataset.src) {
            if (S.settings.fxSource === t.dataset.src) return;
            S.settings.fxSource = t.dataset.src; saveSettings(); renderAll();
            return refreshPrices();
        }
        switch (t.dataset.act) {
            case 'add': return openTxForm();
            case 'import': return $('#importFile').click();
            case 'backup': return doBackup();
            case 'csv': return exportCSV();
            case 'sort': {
                const order = ['value', 'pl', 'day', 'name'];
                S.settings.sort = order[(order.indexOf(S.settings.sort) + 1) % order.length];
                saveSettings();
                return renderView();
            }
            case 'wipe':
                if (confirm('Tüm işlemler ve ayarlar silinecek. Emin misin?') && confirm('Bu işlem geri alınamaz. Önce yedek almadıysan iptal et. Silinsin mi?')) {
                    S.tx = []; S.assets = {}; S.manual = {};
                    saveTx(); saveAssets(); saveManual();
                    setView('portfolio');
                    toast('Tüm veriler silindi');
                }
        }
    });

    $('#importFile').addEventListener('change', async e => {
        const file = e.target.files[0];
        e.target.value = '';
        if (file) importFromText(await file.text());
    });

    window.addEventListener('online', () => { S.online = true; refreshPrices({ silent: true }); });
    window.addEventListener('offline', () => { S.online = false; renderStatus(); });
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible' && Date.now() - S.lastFetch > 2 * 60 * 1000) refreshPrices({ silent: true });
    });
    setInterval(() => {
        if (document.visibilityState === 'visible') refreshPrices({ silent: true });
        else renderStatus();
    }, 5 * 60 * 1000);
}

function registerSW() {
    if (!('serviceWorker' in navigator)) return;
    const hadController = !!navigator.serviceWorker.controller;
    let reloaded = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
        // Yeni sürüm yüklendi → sayfayı bir kez yenile
        if (hadController && !reloaded && !sheetStack.length) { reloaded = true; location.reload(); }
    });
    navigator.serviceWorker.register('./sw.js').then(reg => reg.update()).catch(() => {});
}

function init() {
    migrate();
    bindEvents();
    renderAll();
    registerSW();
    navigator.storage?.persist?.().catch(() => {});
    refreshPrices({ silent: true });
}

init();
