# SkyWeave — Tasarım Belgesi (v0.7)

> Türkiye'de küçük bir bölgesel havayolu olarak başla, dünyanın dört bir yanına uçan bir dev ol.

## Temel fikir
3B dünya küresi üzerinde oynanan, gerçekçi bir havayolu yönetim oyunu.
Oyuncu üs havaalanından rotalar açar, gerçek uçak modellerinden filo kurar, bilet fiyatlarını belirler.
Kâr ettikçe lisans alıp büyür: **Bölgesel → Ulusal → Kıtasal → Uluslararası**.

v0.1'deki Metro tarzı "yolcu birikir, taşarsa kaybedersin" mantığı kaldırıldı (eski sürüm `arsiv/v0.1` içinde).

## Alınan kararlar (anket sonuçları)
| Konu | Karar |
|---|---|
| Yolcu sistemi | **Talep sistemi**: şehir çiftleri arasında günlük talep; fiyat, sefer ve koltuğa göre doluluk ve kâr |
| 3B | **Kesintisiz yakınlaşma**: uzaktan dünya küresi, yakınlaştıkça gerçek harita; havalimanında OpenStreetMap'ten gerçek pistler, taksi yolları ve 3B binalar. Ayrı ekran yok, ekstra tıklama yok. |
| Başlangıç | **Türkiye** |
| Ek özellikler | Gerçek uçak modelleri, rakip havayolları, olaylar, gün-gece ve sezonlar |
| Havaalanları | Hepsi baştan haritada; lisansın yetmediği yerler kilitli görünür |
| Harita | Zoom yapılabilir, döndürülebilir |

## Sistemler

### Zaman
- 1 oyun saati = 1 gerçek saniye (1× hızda). Hız seçenekleri: 1×, 4×, 16×.
- Her gün sonunda gelir ve gider hesaplanır, oyun otomatik kaydedilir.
- Başlangıç tarihi: 1 Nisan 2027.

### Talep (yolcu)
- Her havaalanı çifti için günlük, yön başına talep vardır (çekim modeli):
  `talep ≈ 150 × √(nüfusA × nüfusB) × mesafe etkisi × uluslararası katsayı × sezon × fiyat etkisi`
- Çok kısa mesafede (<400 km) insanlar karayolunu seçtiği için talep düşer. Çok uzun mesafede de azalır.
- Yeni açılan rota talebin %40'ıyla başlar, 30 günde tam talebe ulaşır.
- Sezon: yazın genel talep biraz artar. Turistik yerlerde (Antalya, Bodrum, Dalaman...) yaz talebi çok artar, kış talebi düşer.
- Fiyat: varsayılan bilet = 35 $ + 0,075 $/km. Oyuncu rota başına %60–%160 arası ayarlar. Pahalılaştıkça talep düşer.

### Uçaklar (gerçek modeller)
| Model | Koltuk | Menzil | Lisans |
|---|---|---|---|
| ATR 72-600 | 70 | 1.500 km | Bölgesel |
| De Havilland Dash 8-400 | 78 | 2.000 km | Bölgesel |
| Embraer E195-E2 | 132 | 4.800 km | Ulusal |
| Airbus A220-300 | 145 | 6.200 km | Ulusal |
| Airbus A320neo | 180 | 6.300 km | Ulusal |
| Boeing 737-8 | 178 | 6.500 km | Ulusal |
| Airbus A321neo | 220 | 7.400 km | Kıtasal |
| Boeing 787-9 | 290 | 14.000 km | Uluslararası |
| Airbus A350-900 | 315 | 15.000 km | Uluslararası |
| Boeing 777-300ER | 396 | 13.600 km | Uluslararası |

- **Kiralama:** Düşük başlangıç ücreti (1 aylık kira), günlük kira öder. İstediğin zaman iade edersin.
- **Satın alma:** Yüksek peşin fiyat, sadece küçük bakım gideri. Satarken fiyatın %70'ini geri alırsın.
- Sefer başına giderler: yakıt (km × yakıt tüketimi), ekip ve bakım (blok saat başına), havalimanı ücreti, yolcu başına ücret.

### Büyüme (lisanslar)
| Seviye | Nereye uçabilirsin | Şart |
|---|---|---|
| 1. Bölgesel | Türkiye içi, 600 km'ye kadar | Başlangıç |
| 2. Ulusal | Tüm Türkiye | 40 bin yolcu + 3 M$ |
| 3. Kıtasal | Avrupa, Orta Doğu, Kuzey Afrika, Kafkasya, Orta Asya | 400 bin yolcu + 20 M$ |
| 4. Uluslararası | Tüm dünya | 2,5 milyon yolcu + 80 M$ |

### Üsler
- Her rotanın bir ucu senin üssün olmalı. Başlangıçta 1 üs seçersin.
- Yeni üs: 1,5 M$ (lisansının izin verdiği bölgede).

### Rakipler
- Rakip isimleri hayalidir. Gerçek havayollarını taklit etmez.
- **Yerli (oyun başından):** Boğaziçi Hava (İstanbul, saldırgan), Ege Kanatları (İzmir), Anka Air (Ankara, 20. gün).
- **Kıtasal (Kıtasal lisans ya da ~220. gün):** EuroLink (Frankfurt), Gulf Star (Dubai).
- **Dünya (Uluslararası lisans ya da ~450. gün):** Atlantic Wings (New York), Orient Pacific (Singapur).
- **Pazar paylaşımı:** Aynı hattaki havayolları yolcuyu kapasite (√koltuk), bilet fiyatı ve itibara göre paylaşır. Rekabet pazarı en fazla %15 büyütür. Dolu olanın taşan yolcusunun %60'ı boş koltuğu olana geçer.
- **Haftalık kararlar:** Boş koltuk çoksa fiyat düşürür, doluysa artırır. Oyuncu daha ucuzsa (saldırganlığa bağlı olasılıkla) fiyat kırar. Dolu ve kârlı hatta uçak ekler (hat yaşına göre sınırlı). İki hafta üst üste zarar eden hattan çekilir. Merkezinden en az hizmet alan, yüksek talepli hatları açar ve oyuncunun hatlarına saldırmayı tercih eder.
- **İflas:** Kasası −20 M$ altına inen rakip pazardan çekilir.
- **Görünüm:** Haritada kesikli, kendi renginde hatlar. Hat ekranında rakipler, koltukları, fiyatları ve senin pazar payın. "Rakipler" menüsünde sıralama ve haber akışı. Havalimanına yakınlaşınca 3B trafikte rakiplerin renkleri.

### Olaylar
- **Hava (mevsime göre):** Kışın kar ve sis (Doğu Anadolu, İstanbul, Ankara, Kuzey Avrupa, Kuzey Amerika), yazın fırtına, Körfez'de kum fırtınası, Doğu Asya'da tayfun, Miami'de kasırga. Etkilenen havalimanında kapasite düşer (%10–60), bazen talep de düşer. Çoğunlukla oyuncunun ağındaki havalimanlarını seçer.
- **Takvim:** Ramazan ve Kurban Bayramı (yaklaşık tarihler, Türkiye talebi +%35, 7 gün), Hac dönemi (Cidde +%80), yılbaşı, İzmir Fuarı, Antalya Film Festivali, Kapadokya balon sezonu, Oktoberfest, Dubai Alışveriş Festivali, okul tatili.
- **Genel:** Yakıt fiyatı artışı ya da düşüşü (25–45 gün), kur dalgalanması (Türkiye talebi −%12), turizm patlaması (turistik yerler +%20).
- **Aksaklıklar:** Havalimanında yer hizmetleri grevi, bir uçak tipinin teknik incelemeye girip birkaç gün yerde kalması (rakipleri de etkiler).
- **Basın:** Olumlu ya da olumsuz haberle oyuncunun itibarı (pazar payı ağırlığı) değişir.
- **Kararlar (oyun durur, oyuncu seçer):** Sendika zammı (kalıcı ekip maliyeti +%8 ya da grev riski), reklam kampanyası (itibar +%12, 30 gün), ucuz bakım (genel gider −%20 ama daha sık teknik inceleme), yakıt fiyat sabitleme (60 gün). Aynı karar 150 gün içinde tekrar sorulmaz.
- **Görünüm:** Üst çubukta "Haberler" düğmesi (okunmamış sayısı), haber panelinde süren olaylar ve kalan günleri, haritada etkilenen havalimanında renkli işaret, hat ekranında o hattı etkileyen olaylar.

### İlerleme (Gelişim menüsü)
- **Çevrimdışı kazanç:** Oyun kapalıyken ya da telefonda arka plandayken oyun saati durur. Dönüşte son 7 günün ortalama kârı ve yolcusu üzerinden hesaplanır: her gerçek dakika = 0,25 oyun günü, verim %50 (yükseltmeyle %100'e çıkar), en fazla 8 saat (yükseltmeyle 18 saate çıkar).
- **Yükseltmeler (kalıcı, seviyeli, fiyat ×2,3):** Yakıt verimliliği (−%4/sv), Hızlı yer hizmeti (yerde bekleme −%8/sv), Ekip eğitimi (−%4/sv), Bakım hangarı (kira ve bakım −%6/sv), VIP salon (itibar +%3/sv), Açılış kampanyaları (yeni hat daha hızlı dolar), Gece vardiyası müdürü (çevrimdışı kazanç), Sadakat programı (talep +%3/sv, Ulusal lisans).
- **Görevler:** 25 ödüllü görev, aynı anda 3 aktif. Tamamlanınca bildirim ve menüde kırmızı nokta çıkar, ödül elle alınır.
- **Otomasyon (müdürler):** Gelir müdürü (haftalık fiyat ayarı), Filo müdürü (boştaki uçağı talebi yüksek hatta atar), Ağ planlayıcı (boşta uçak kalırsa yeni hat açar, Ulusal lisans). İşe alma ücreti ve günlük maaş var, açılıp kapatılabilir.
- **Holding (prestij):** Kıtasal lisans ve en az 25 M$ şirket değeriyle açılır. Yıldız = ⌊√(şirket değeri / 25 M$)⌋. Her yıldız kalıcı olarak gelir +%5 ve başlangıç kasası +1 M$ verir. Her şey sıfırlanır; yıldızlar ve havayolu adı kalır.

### İflas
- Kasa eksiye düşebilir (günlük faiz işler). −10 M$'ın altına inerse iflas edersin ve oyun biter.

### Gün-gece
- Küre üzerinde güneş, oyun saatine ve tarihe göre gerçek konumunda. Gece tarafı karanlık.

## Yol haritası
- **v0.2 (tamam):** 3B küre ve zoom, tüm havaalanları, talep ekonomisi, gerçek uçaklar, lisanslar, üsler, gün-gece, sezonlar, kayıt.
- **v0.3 (şimdi):** Harita MapLibre küre görünümüne geçti. Yakınlaştıkça gerçek harita ve havalimanında OpenStreetMap verisiyle gerçek pistler, taksi yolları, apronlar ve 3B binalar (terminal, kule, hangar). Yakınlaşınca kamera otomatik eğilir. Gece bölgesi harita üzerinde gölge olarak görünür. Ayrı yakın plan ekranı kaldırıldı (kodu `arsiv/v0.3` içinde).
- **v0.3.1 (tamam):** Havalimanına yakınlaşınca 3B uçaklar: OpenStreetMap'teki gerçek kapılara park eder (kapı yoksa apron üzerine), gerçek pistlere iner ve kalkar, taksi yollarından geçer, geri itilir (pushback). Senin uçakların sarı kuyruklu, sayıları o havalimanındaki sefer payına göre.
- **v0.6 (tamam):** Olaylar ve haberler. Bkz. "Olaylar" bölümü.
- **v0.7 (şimdi):** İdle çekirdeği: çevrimdışı kazanç, yükseltmeler, görevler, otomasyon (müdürler), Holding (prestij). Bkz. "İlerleme" bölümü.
- **v0.5 (tamam):** Rakip havayolları. Bkz. "Rakipler" bölümü.
- **v0.6:** Daha fazla havaalanı (OurAirports verisi), itibar ve hizmet kalitesi, ses.
- **Sonra:** İnternete yayın, isteğe bağlı yapay zekâ ile haber metinleri (Haiku).

## Teknik
- Saf JavaScript (ES modülleri), derleme yok. Harita için MapLibre GL JS 5 (CDN).
- Harita verisi: OpenStreetMap katkıcıları, OpenFreeMap (ücretsiz, anahtarsız) vektör karoları. Ekranda kaynak gösterimi zorunlu, haritanın köşesinde duruyor.

```
index.html         sayfa
css/style.css      arayüz
js/data.js         havaalanları, uçaklar, lisanslar
js/sim.js          talep ve ekonomi hesapları (arayüzden bağımsız)
js/globe.js        MapLibre küre/harita, havalimanı katmanları, 3B binalar, rotalar, uçaklar, gece gölgesi
js/traffic3d.js    havalimanında 3B uçaklar: kapılarda park, iniş, taksi, kalkış
js/rivals.js       rakip havayolları ve haftalık yapay zekâ kararları
js/events.js       olaylar, haberler ve oyuncu kararları
js/progress.js     yükseltmeler, görevler, müdürler, çevrimdışı kazanç, holding
js/main.js         oyun döngüsü, arayüz, kayıt
arsiv/v0.1         ilk prototip
```
