// Ziraat Bankası döviz ve altın fiyatlarını çekip InvestIQ'nun okuduğu biçime çevirir.
// İki yerden kullanılır:
//  - api/ziraat.mjs        : Vercel fonksiyonu, uygulama "fiyatları yenile"ye basınca anlık çağırır
//  - scripts/ziraat.mjs    : GitHub Actions, Vercel'e ulaşılamazsa diye yedek JSON üretir
// Ziraat'in sitesi tarayıcıdan başka sitelerin okumasına izin vermediği (CORS) için
// fiyatlar sunucu tarafında çekilir.

const BASE = 'https://www.ziraatbank.com.tr/tr/_layouts/15/Ziraat/FaizOranlari/Ajax.aspx/';

// Ziraat tablo kodu → InvestIQ varlık kodu
const FX = ['USD', 'EUR', 'GBP', 'CHF', 'CAD', 'AUD', 'SAR', 'JPY'];
const METAL = { A01: 'GRA', A02: 'HAS', G02: 'GUMUS' };
const PER = { JPY: 100 };   // Ziraat yeni 100 birim üzerinden veriyor

// Tablolar: "rdBranch…" şube (gişe), "rdIntBranch…" internet/mobil
const TABLES = { gise: 'rdBranch', internet: 'rdIntBranch' };

async function call(method, date) {
    const r = await fetch(BASE + method, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json; charset=utf-8', 'User-Agent': 'Mozilla/5.0' },
        body: JSON.stringify({ date }),
        signal: AbortSignal.timeout(8000)
    });
    if (!r.ok) throw new Error(`${method} HTTP ${r.status}`);
    const j = await r.json();
    if (j?.d?.StatusCode !== 200 || !j.d.Data) throw new Error(`${method} ${date}: ${j?.d?.Message || 'boş cevap'}`);
    return j.d.Data;
}

const num = s => +s.replace(/\./g, '').replace(',', '.');
const text = s => s.replace(/<[^>]+>/g, '').trim();

// HTML'deki her tabloyu { gise: [[hücreler]], internet: [[hücreler]] } olarak ayıkla
function parse(html, suffix) {
    const out = {};
    for (const [key, prefix] of Object.entries(TABLES)) {
        const start = html.indexOf(`data-id="${prefix}${suffix}"`);
        if (start < 0) continue;
        const end = html.indexOf('</table>', start);
        const rows = html.slice(start, end).split(/<tr[^>]*>/).slice(1);
        out[key] = rows
            .map(r => [...r.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map(m => text(m[1])))
            .filter(cells => cells.length >= 4);
    }
    return out;
}

async function pricesFor(date) {
    const [fxHtml, metalHtml] = await Promise.all([call('GetDovizKurlari', date), call('GetAltinFiyatlari', date)]);
    const fx = parse(fxHtml, 'Doviz'), metal = parse(metalHtml, 'Altin');
    const res = {};
    for (const key of Object.keys(TABLES)) {
        const t = (res[key] = {});
        for (const c of fx[key] || []) {
            if (!FX.includes(c[0])) continue;
            const div = PER[c[0]] || 1;
            t[c[0]] = { b: num(c[2]) / div, s: num(c[3]) / div };
        }
        for (const c of metal[key] || []) {
            const id = METAL[c[0].replace(/\*/g, '')];
            if (id) t[id] = { b: num(c[2]), s: num(c[3]) };
        }
    }
    return res;
}

const ymd = d => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Istanbul' }).format(d);

export async function getZiraat(now = new Date()) {
    const today = ymd(now);
    // Günlük değişim için önceki günler de lazım (hafta sonu/tatilde geriye git) — hepsini birlikte iste
    const [cur, ...older] = await Promise.all(
        [0, 1, 2, 3, 4].map(i => pricesFor(ymd(new Date(now - i * 86400000))).catch(e => (i ? null : Promise.reject(e))))
    );
    if (!cur.internet?.USD || !cur.gise?.USD) throw new Error('Dolar kuru bulunamadı — Ziraat sayfa yapısı değişmiş olabilir');
    const prev = older.find(p => p?.internet?.USD);

    // Günlük değişim şube fiyatlarının alış-satış ortalamasından, iki tabloya da aynısı yazılır:
    // Ziraat piyasa kapalıyken internet fiyatlarında farkı (tek taraflı) açtığı için oradan
    // hesaplanan değişim yanıltıcı olur. Şube satışı bazı günler 0 geliyor — o zaman alıştan.
    const ref = x => (x.b > 0 && x.s > 0 ? (x.b + x.s) / 2 : 0);
    const chg = {};
    for (const [id, x] of Object.entries(cur.gise)) {
        const y = prev?.gise?.[id];
        if (!y) continue;
        const [a, b] = ref(x) && ref(y) ? [ref(x), ref(y)] : [x.b, y.b];
        if (a > 0 && b > 0) chg[id] = +((a / b - 1) * 100).toFixed(2);
    }
    for (const key of Object.keys(cur)) {
        for (const [id, x] of Object.entries(cur[key])) x.chg = chg[id] ?? 0;
    }
    return { t: now.getTime(), date: today, ...cur };
}
