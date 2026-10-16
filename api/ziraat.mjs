// Vercel fonksiyonu: GET /api/ziraat → Ziraat internet/şube fiyatları (JSON)
// Uygulama GitHub Pages'te çalıştığı için başka siteden okunmasına izin verilir (CORS).
// Vercel önbelleği 60 sn tutar; böylece Ziraat'e her basışta değil, en fazla dakikada bir gidilir.
import { getZiraat } from '../lib/ziraat.mjs';

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    try {
        const data = await getZiraat();
        res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=300');
        res.status(200).json(data);
    } catch (e) {
        res.setHeader('Cache-Control', 'no-store');
        res.status(502).json({ error: e.message });
    }
}
