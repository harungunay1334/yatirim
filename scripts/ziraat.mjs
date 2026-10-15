// Ziraat Bankası döviz ve altın fiyatlarını çekip InvestIQ'nun okuyacağı JSON'a çevirir.
// GitHub Actions'ta çalışır (.github/workflows/ziraat.yml). Ziraat'in sitesi tarayıcıdan
// başka sitelerin okumasına izin vermediği (CORS) için fiyatlar bu yolla aktarılır.
//
// Kullanım: node scripts/ziraat.mjs <çıktı.json>
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

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
        body: JSON.stringify({ date })
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

async function main() {
    const outFile = process.argv[2] || 'ziraat.json';
    const now = new Date();
    const today = ymd(now);
    const cur = await pricesFor(today);
    if (!cur.internet?.USD || !cur.gise?.USD) throw new Error('Dolar kuru bulunamadı — Ziraat sayfa yapısı değişmiş olabilir');

    // Günlük değişim için önceki iş gününün fiyatları (hafta sonu/tatilde geriye git)
    let prev = null;
    for (let i = 1; i <= 6 && !prev; i++) {
        try {
            const p = await pricesFor(ymd(new Date(now - i * 86400000)));
            if (p.internet?.USD) prev = p;
        } catch { /* o gün veri yok */ }
    }
    // Şube tablosunda satış fiyatı bazı günler 0 geliyor — değişimi alış fiyatından hesapla
    for (const key of Object.keys(cur)) {
        for (const [id, x] of Object.entries(cur[key])) {
            const y = prev?.[key]?.[id];
            const side = x.b > 0 && y?.b > 0 ? 'b' : 's';
            x.chg = y?.[side] > 0 && x[side] > 0 ? +((x[side] / y[side] - 1) * 100).toFixed(2) : 0;
        }
    }

    const data = { t: now.getTime(), date: today, ...cur };
    mkdirSync(dirname(outFile), { recursive: true });
    writeFileSync(outFile, JSON.stringify(data, null, 1));
    console.log(`Ziraat ${today}: internet USD ${cur.internet.USD.b}/${cur.internet.USD.s}, GRA ${cur.internet.GRA?.b}/${cur.internet.GRA?.s}`);
}

main().catch(e => { console.error(e.message); process.exit(1); });
