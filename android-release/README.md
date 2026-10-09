# MolaVolt — Android 16 (API 36) yayın hazırlığı

Bu dizin, mevcut **MolaVolt** web uygulamasının Trusted Web Activity (TWA) Android sarmalayıcısının kaynak projesidir. Canlı `index.html` değiştirilmez.

- Android paket adı: `com.molavolt.app` (Play Console ile aynı).
- Web adresi: `https://molavolt.com/`
- `compileSdk=36` / `targetSdk=36`; minSdk 24.
- Android Browser Helper: 2.7.3.
- `versionCode=10003` / `versionName=1.0.0.3`. **Play Console'daki önceki tüm sürümlerden daha yüksek olduğuna emin olun.**
- Logo, depo kökündeki `icon-192.png` dosyasından derlemede otomatik alınır.
- Doğrulama: `https://molavolt.com/.well-known/assetlinks.json` içinde mevcut Play **uygulama imzalama** SHA-256 kaydı.

## Derleme

GitHub > Actions > **Build MolaVolt Android API 36** > Run workflow. Build yalnızca kaynak paketini üretir; otomatik olarak Google Play'e göndermez.

İmzasız `app-release.aab` doğrulama amaçlıdır ve Play Console'a yüklenemez. *Mevcut* Google Play **yükleme anahtarınızı (upload key)** kullanarak imzalamanız şarttır. YENİ anahtar oluşturmak uygulama güncellemesi için uygun olmayabilir.

Daha sonra GitHub Repository Settings > Secrets and variables > Actions içine (depolanan değerler kesinlikle kaynak dosyalara veya sohbet mesajlarına eklenmeden) şunlar eklenebilir:

- `MOLAVOLT_UPLOAD_KEYSTORE_BASE64`: mevcut upload keystore dosyasının base64'ü
- `MOLAVOLT_UPLOAD_KEYSTORE_PASSWORD`
- `MOLAVOLT_UPLOAD_KEY_ALIAS`
- `MOLAVOLT_UPLOAD_KEY_PASSWORD`

Bunlar tamamsa workflow **imzalı** release AAB üretir. İmza sertifikasının SHA-256 özeti Play Console'daki **yükleme anahtarı sertifikası** ile mutlaka eşleşmelidir. Play uygulama imzalama sertifikası, yükleme sertifikasından farklı olabilir.

## Yayından önce

1. Google'ın üretim erişimi başvurusunun onaylanmasını bekleyin.
2. Android 16 cihazda konum, harita, rota, şarj istasyonları, geri tuşu, alt gezinme ve offline/online davranışını gerçek kurulumla test edin.
3. Play Console'da mevcut en büyük versionCode'u kontrol edin, gerekirse artırın.
4. Uygulama imza/yükleme anahtarı uyuşmasını doğrulayın. Private keystore'u asla herkese açık GitHub deposuna yüklemeyin.
5. Verilerin güvenliği, gizlilik politikası, mağaza açıklaması ve ekran görüntülerini kontrol edin.
6. Önce **Dahili test** kanalında imzalı AAB ile deneme yapın, ardından üretime gönderin.

Bu kaynak, önceki PWABuilder ZIP'inin birebir devamı değildir; güncel API hedefine uygun yeni ve sade bir TWA iskeletidir. Mevcut Play uygulamasıyla uyumluluk, yeni AAB'nin Play Console'da onaylanmasıyla kesinleşir.
