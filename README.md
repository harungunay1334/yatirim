# 📈 InvestIQ — Kişisel Yatırım Takip

Altın, döviz, hisse ve kripto yatırımlarını telefonda takip etmek için hafif bir PWA. Aldığın varlıkları girersin; uygulama güncel fiyatları çeker ve kâr/zarar durumunu gösterir.

## Özellikler
- **Portföy özeti:** toplam değer, toplam ve günlük kâr/zarar, maliyet, gerçekleşen kâr/zarar, dolar karşılığı
- **Türk yatırımcıya göre varlıklar:** gram, çeyrek, yarım, tam, Cumhuriyet, Ata, Reşat, beşli altın, 22 ayar bilezik, 14/18 ayar, gümüş, platin, dövizler
- **Hisseler:** tüm BIST ve ABD hisseleri/ETF'leri (isimle arama)
- **Kripto:** Binance TRY pariteleri
- **Fon ve özel varlıklar:** fiyatı elle girilir (TEFAS fonları, arsa, mevduat…)
- **İşlem geçmişi:** alış/satış ekle, düzenle, sil; komisyon ve not alanı
- **Ortalama maliyet** yöntemiyle kâr/zarar, kısmi satışlarda gerçekleşen kâr
- **Dolar bazında getiri:** TL getirinin dolar karşısındaki durumu
- **Analiz:** kategori dağılımı, portföy payları, getiri sıralaması
- **Gizleme modu:** tutarları tek dokunuşla gizle
- **Yedekleme:** JSON yedek dosyası (paylaş menüsüyle Drive/WhatsApp'a), geri yükleme, Excel için CSV
- Çevrimdışı açılır, yeni sürümler otomatik gelir

## Fiyat kaynakları
| Varlık | Kaynak |
|---|---|
| Döviz, gram/has altın, gümüş | **Ziraat Bankası** internet veya şube kurları (Ayarlar'dan seçilir, varsayılan: internet) |
| Diğer altınlar (çeyrek, Cumhuriyet, bilezik…) | [Truncgil Finans](https://finans.truncgil.com) (kuyumcu alış/satış) |
| Kripto | Binance |
| BIST & ABD hisseleri | TradingView (BIST ~15 dk gecikmeli) |
| Fon / diğer | Elle giriş |

Truncgil, Binance ve TradingView doğrudan tarayıcıdan çağrılır.

Ziraat'in sitesi başka sitelerin tarayıcıdan okumasına izin vermediği için fiyatlar sunucu tarafında çekilir (kod: `lib/ziraat.mjs`):
- **Anlık:** Vercel'deki `api/ziraat` fonksiyonu. Uygulama fiyatları yenilerken önce bunu çağırır (Vercel önbelleği en fazla 1 dk).
- **Yedek:** `.github/workflows/ziraat.yml`, `scripts/ziraat.mjs` ile fiyatları `ziraat-data` dalına `ziraat.json` olarak yazar. GitHub bu görevi pratikte birkaç saatte bir çalıştırır.
- İkisi de alınamazsa Truncgil fiyatları kullanılır.

## Telefona kurulum
1. GitHub Pages adresini aç: `https://harungunay1334.github.io/yatirim/`
2. **iPhone (Safari):** Paylaş → *Ana Ekrana Ekle*
3. **Android (Chrome):** ⋮ menü → *Uygulamayı yükle*

> Eski sürüm yüklüyse uygulamayı **iki kez kapatıp açman** gerekebilir: ilk açılışta yeni sürüm indirilir, ikincisinde görünür. Eski verilerin otomatik taşınır.

## Veriler
Tüm veriler sadece cihazında (localStorage) saklanır, hiçbir sunucuya gönderilmez. Uygulamayı silmeden veya telefon değiştirmeden önce **Ayarlar → Yedek al** ile yedeğini al.

*Bilgi amaçlıdır, yatırım tavsiyesi değildir.*
