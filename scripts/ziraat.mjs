// GitHub Actions'ta çalışır (.github/workflows/ziraat.yml): Ziraat fiyatlarını JSON dosyasına yazar.
// Uygulama önce Vercel'deki anlık API'yi dener; ulaşamazsa bu dosyayı okur.
//
// Kullanım: node scripts/ziraat.mjs <çıktı.json>
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { getZiraat } from '../lib/ziraat.mjs';

const outFile = process.argv[2] || 'ziraat.json';
getZiraat()
    .then(data => {
        mkdirSync(dirname(outFile), { recursive: true });
        writeFileSync(outFile, JSON.stringify(data, null, 1));
        const i = data.internet;
        console.log(`Ziraat ${data.date}: internet USD ${i.USD.b}/${i.USD.s}, GRA ${i.GRA?.b}/${i.GRA?.s}`);
    })
    .catch(e => { console.error(e.message); process.exit(1); });
