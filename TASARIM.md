# SkyWeave — Tasarım Belgesi (v1.1)

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
- Fiyat: varsayılan bilet = 35 $ + 0,075 $/km (2.000 km'den sonra km başı 0,05 $; uzun hatlar daha ucuz). Oyuncu rota başına %60–%160 arası ayarlar. Pahalılaştıkça talep düşer.

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
| 2. Ulusal | Tüm Türkiye | 60 bin yolcu + 3 M$ |
| 3. Kıtasal | Avrupa, Orta Doğu, Kuzey Afrika, Kafkasya, Orta Asya | 400 bin yolcu + 20 M$ |
| 4. Uluslararası | Tüm dünya | 2,5 milyon yolcu + 80 M$ |

### Üsler
- Her rotanın bir ucu senin üssün olmalı. Başlangıçta 1 üs seçersin.
- İkinci üs 1,5 M$; her yeni üs bir öncekinin 1,8 katı (3. üs 2,7 M$, 5. üs 8,7 M$, 8. üs 51 M$). Lisansının izin verdiği bölgede.
- Genel gider: merkez 3.000 $ + üs başına 1.500 $ + 60 $ × nüfus (milyon) + uçak başına yönetim payı. Yönetim payı filo büyüdükçe artar: uçak başına 300 $ + 40 $ × filo büyüklüğü (10 uçak → 700 $, 100 uçak → 4.300 $).

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
- **Otomasyon (müdürler):** Gelir müdürü (haftalık fiyat ayarı), Filo müdürü (boştaki uçağı talebi yüksek hatta atar), Ağ planlayıcı (boşta uçak kalırsa yeni hat açar, Ulusal lisans), Teknik müdür (bakım). İşe alma ücreti ve günlük maaş var, açılıp kapatılabilir.
- **Holding (prestij):** Kıtasal lisans ve en az 25 M$ şirket değeriyle açılır. Yıldız = ⌊√(şirket değeri / 25 M$)⌋. Her yıldız kalıcı olarak gelir +%5 ve başlangıç kasası +1 M$ verir. Her şey sıfırlanır; yıldızlar ve havayolu adı kalır.

### Aktarmalı yolcu (hub)
- Bir üssüne bağlı iki hattın uçları arasında (örneğin Kars → İstanbul → Londra) yolcular üssünde aktarma yapar. Sadece üslerde olur; üs kurmanın stratejik anlamı budur.
- Aktarma talebi = iki uç arasındaki talep × 0,45 × dolambaç etkisi (iki bacak toplamı direkt mesafenin 1,3 katını aşarsa düşer) × fiyat etkisi × itibar. Rakibin o iki şehir arasında direkt uçuşu varsa talep %70 düşer. Oyuncunun direkt hattı varsa aktarma hesaplanmaz.
- Aktarma yolcusu yalnızca boş ekonomi koltuklarını kullanır (yerel yolcunun yerini almaz). Bilet: direkt mesafenin normal biletinin %85'i, gelir hatlara mesafeye göre bölünür.
- **Aktarma merkezi** yükseltmesi (Ulusal lisans): aktarma talebi +%15/sv.
- Görünüm: üs ekranında "Aktarma merkezi" kutusu, hat ekranında aktarmalı yolcu / talep, Rapor özetinde en çok aktarma yapılan yollar.

### Kabin sınıfları ve hizmet
- Hat başına kabin düzeni: Tek sınıf, Karma (kabinin %15'i business), Premium (%30). Bir business koltuğu 2,5 ekonomi koltuğu yer kaplar, bileti ekonominin 3,2 katıdır.
- Business talebi: pazar talebi × business eğilimi (uluslararası, uzun ve büyük şehirler arası hatlarda yüksek, %5–21) × hizmet etkisi × VIP salon. Fiyata daha az duyarlı.
- Hizmet seviyesi (Rapor → Hizmet): Ekonomik (−3 $/yolcu, itibar −%8), Standart, Konforlu (+6 $, +%7), Premium (+14 $, +%13). Business talebini de etkiler.

### Uçak yaşı, durumu ve bakım
- Her uçağın yaşı ve durumu (%) var. Uçan uçak her gün yıpranır (yaşlı uçak daha hızlı). Durum %65'in altına inerse arıza riski başlar: uçak 2–4 gün yerde kalır, onarım parası ödenir, itibar biraz düşer.
- Yaş etkisi: yılda yakıt +%0,6, sahipli uçak bakım gideri +%4. Filonun ortalama yaşı 8'i ya da durumu %70'in altına düşerse itibar azalır.
- Ağır bakım: fiyatın %1'i (yaşla artar), 4 gün yerde kalır, durumu yeniler (yaşlı uçak tam yenilenmez).
- Satış değeri yaşa ve duruma göre: sıfır uçak %75'ten başlar, yılda %6 düşer.
- **İkinci el pazarı:** 14 günde bir yenilenen 5 uçak (3–22 yaş). Daha ucuz alınır ve kiralanır.
- **Teknik müdür:** durumu %60'ın altına düşen uçakları sırayla bakıma alır.

### Finans (Rapor → Finans)
- **Şirket değeri** = kasa + sahipli uçakların değeri + son 7 günün ortalama kârı × 180 − borç.
- **Banka kredisi:** limit şirket değerinin (borç dahil) %60'ı, en az 4 M$. Vade 180/360/720 gün; faiz borç oranına ve lisansa göre (yaklaşık %4–19). Eşit günlük taksit, istediğin zaman kapatılabilir. Kredi notu AAA–CCC.
- **Hisse:** Ulusal lisans ve en az 20 M$ şirket değeriyle halka arz. %10'luk dilimler, en fazla %40. Ortaklar günlük kârın %35'i × payları kadar temettü alır. Holding yıldızları senin payına göre hesaplanır. Hisseler %10 primle geri alınabilir.

### Slotlar (havalimanı kapasitesi)
- Büyük havalimanlarında (nüfus ≥ 3 milyon ya da büyük turistik) günlük kalkış hakkı sınırlı: üsse 40, diğerlerine 10 ücretsiz. Her paket +5 kalkış; fiyat nüfus ve bölgeyle artar, her pakette ×1,25.
- Slot aşılırsa o havalimanındaki seferler orantılı olarak azalır. Hat açarken ve hat ekranında uyarı çıkar. Filo müdürü ve ağ planlayıcı slotu dolu havalimanına uçak koymaz.

### İflas
- Kasa eksiye düşebilir (günlük faiz işler). −10 M$'ın altına inerse iflas edersin ve oyun biter.

### Cila ve deneyim (v0.9)
- **Ses:** Tüm sesler Web Audio ile üretilir (dosya yok): kalkış, para, satın alma, rekor, lisans fanfarı, bildirim, hata, düğme tıkı. Sakin, kendi kendine akan ambient müzik. Telefonda (Android) kısa titreşimler.
- **Görsel geri bildirim:** Gün sonunda kasanın yanından günün kârı uçar ve kasa parlar. Lisans ve holding için konfetili kutlama kartı (açılan uçaklar, yükseltmeler, müdürler). Rekorlar (en kârlı gün, en çok yolcu) ve yolcu kilometre taşları (10 bin, 100 bin, 1 milyon...) bildirim, ses ve konfetiyle kutlanır.
- **Grafikler (Rapor → Grafikler):** 30 gün / 90 gün / 1 yıl; günlük kâr, kasa, gelir-gider, yolcu (aktarmalı dahil), toplam pazar payı; en iyi ve en kötü günler; tüm zamanların rekorları; hatların 30 günlük ortalama kârı ve eğilim çizgisi. Hat ekranında son 60 günün kârı, doluluk ve pazar payı. Grafiğe dokununca o günün değeri görünür. Günlük geçmiş 400 gün tutulur.
- **Ayarlar (⚙):** Ses efektleri, müzik, ses düzeyi, titreşim, açılış hızı, ipuçları, "Nasıl oynanır" rehberi, oyunu sıfırlama. Dil şimdilik yalnızca Türkçe. Klavye: boşluk duraklatır, 1–3 hız, Esc kapatır.
- **Kayıt taşıma:** Ayarlar'dan kayıt dosyası indirilir ya da kayıt kodu kopyalanır (gzip + base64, "SW1." ile başlar). Öbür cihazda Ayarlar → İçe aktar ya da açılış ekranındaki "Başka cihazdan kayıt yükle".
- **Uygulama (PWA):** Uygulama tanımı (manifest), simgeler ve service worker. Ana ekrana eklenince tam ekran açılır. Oyun dosyaları ve MapLibre önbellekte durduğu için internetsiz açılır; gezilen harita karoları da (en fazla 2.500) önbelleğe alınır.
- **Eğitim:** İlk adımlar üstteki ipucu çubuğunda. Sonra oyun ilerledikçe 17 bağlamsal ipucu kartı bir kez çıkar: gün sonu ve rapor, yakınlaşma, dolu ve boş hatlar, görevler, rakipler, olaylar, yükseltmeler, lisanslar, ikinci üs, aktarma, bakım, slotlar, müdürler, kredi, çevrimdışı kazanç, holding. Karttaki düğme ilgili menüyü açar.

### v1.0: Oyunun ortası tekrara düşmesin
Benzer oyunların incelemelerinde en sık şikâyet, oyunun ortasında ve sonunda her şeyin "sayı büyüsün" döngüsüne dönmesi. Bu yüzden v1.0'da çekirdek döngüyü (hat aç, uçak koy, fiyat ayarla) kullanan ama her seferinde farklı bir karar isteyen sistemler eklendi, ekonomi de büyüdükçe yavaşlayacak şekilde dengelendi.

- **Denge (testlerle):** Bot oyuncuyla yapılan testlerde eski ekonomi üstel büyüyordu (240. günde 368 uçak, günde 41 M$ kâr; bir 777 günde 220 bin $ kazanıyordu). Uzun hat bileti, üs fiyatlarının artışı ve büyük filonun yönetim gideri ile şimdi: v1.1'deki yeni havalimanlarıyla: Ulusal ~11–24. gün, Kıtasal ~170–230. gün, Uluslararası ~365. gün, 1. yıl sonunda günde 5–12 M$ kâr.
- **Kargo:** Yolcu uçaklarının alt bölmesinde kargo taşınır (ATR 0,8 t, A320 3,5 t, 777 24 t). Talep şehir büyüklüğüne ve mesafeye bağlı, uluslararası hatlarda %30 fazla. Ücret: 200 $ + 0,35 $/km (2.000 km'den sonra 0,12 $/km) ton başına, elleçleme 60 $/t. Rakipli hatta kargo payı yolcu payına göre. **Kargo terminali** yükseltmesi (Ulusal): talep +%20/sv.
- **Sözleşmeler (Gelişim → Sözleşmeler):** Birkaç günde bir teklif gelir, 7 günde düşer, aynı anda en fazla 3 sözleşme.
  - *Koltuk anlaşması* (tur şirketleri): süre boyunca (20–45 gün) bir hatta her gün yön başına en az N koltuk. 3 aksamada iptal, ceza ve itibar kaybı.
  - *Kargo anlaşması* (Ulusal lisanstan sonra): müşteri hatta günlük ek yük getirir; süre içinde toplam tonajı taşı. Darboğaz uçakların bölme kapasitesi.
  - *Tanıtım kampanyası* (şehirler): kampanya boyunca şehrin talebi %25 artar; süre içinde belirtilen yolcuyu taşırsan ödül ve itibar, ceza yok.
  - Ödüller şirket büyüdükçe artar (en az, son günlerin ortalama kârının belli bir katı), böylece oyunun sonunda da anlamlı kalır.
- **Rakip satın alma (Rakipler menüsü):** Ulusal lisanstan sonra, merkezi lisans bölgende olan rakibi satın alabilirsin. Fiyat: kiralık uçaklarının değeri (liste fiyatının %5'i) + ortalama günlük kâr × 120 + kasasının %10'u − borcu, × 1,35 (borçlu rakip %20 ucuz). Şirket değerin fiyatın 1,5 katı olmalı. Merkezi senin üssün olur; hatları ve uçakları (kiralık, 4 yaşında, %85 durumda) sana geçer. Lisansının izin vermediği uçak tipleri izinli en büyük tiple değişir. Oyunun sonundaki büyük para için anlamlı bir hedef.
- **Rozetler (Rapor → Rozetler):** 29 kalıcı başarım (ilk kalkış, kapalı gişe, kargocu, şirket avcısı, unicorn, fırtınaya rağmen...). Holding kurunca da kalır.
- **Testler:** `node tests/run.mjs` bot oyuncuyla 3 oyunu 365 gün oynatır; iflas, NaN, lisans zamanları, kâr ve filo sınırları, sözleşmeler, uçak–hat tutarlılığı, rakip satın alma ve kayıt gidiş-dönüşünü denetler. `node tests/balance.mjs [gün] [tohum]` ayrıntılı denge raporu basar.
- **Hata düzeltme:** Başlangıç ekranındayken sekme kapanır ya da gizlenirse kayıt boş değerle eziliyordu. Artık oyun yokken kayıt yazılmıyor.

### v1.1: Senaryolar, daha çok havalimanı
- **Havalimanları:** 99'dan 174'e çıktı. Türkiye'ye 18 (Bursa, Eskişehir, Çanakkale, Sivas, Ordu-Giresun, Rize-Artvin, Muş, Ağrı, Hakkari, Sinop...), Kıtasal bölgeye 37 (Dublin, Manchester, Hamburg, Düsseldorf, Köln, Prag, Belgrad, Saraybosna, Batum, Erivan, Erbil, Bağdat, Medine, Hurghada, Şarm El-Şeyh, Marakeş...), Dünyaya 25 (Boston, Atlanta, San Francisco, Rio, Lima, Cape Town, Karaçi, Dakka, Maldivler, Bali, Osaka, Auckland...).
- **Senaryolar (açılış ekranında "Oyun türü"):** Hazır başlangıç, hedef ve süre. Sürenin yarısında bitirirsen ★★★, dörtte üçünde ★★, süre içinde ★. En iyi sonuç cihazda saklanır ve listede görünür. Süre dolarsa serbest oyun olarak devam edilir. İlerleme Gelişim → Görevler'in başında.
  | Senaryo | Zorluk | Başlangıç | Hedef |
  |---|---|---|---|
  | Tatil cenneti | Kolay | Antalya | 365 günde 3 milyon yolcu |
  | Doğu'nun kanatları | Zor | Erzurum | 150 günde Ulusal lisans + 15 hat |
  | Kriz yılı | Orta | Ankara, 6 M$, ilk 150 gün yakıt +%35 | 365 günde 60 M$ şirket değeri |
  | Kargo kralı | Orta | İstanbul | 300 günde 30.000 ton kargo |
  | Şirket avcısı | Zor | Sabiha Gökçen | 450 günde iki rakip satın al |
  | Dünya turu | Orta | İstanbul | 600 günde Uluslararası lisans + 9.000 km'den uzun hat |
  Zorluklar bot oyuncuyla ölçüldü: `node tests/scenarios.mjs`.
- **Renk körü dostu renkler (Ayarlar):** Kâr/zarar yeşil/kırmızı yerine mavi/turuncu.
- Rakip satın alma fiyatı artık son günlerin ortalama kârına bakıyor (haftadan haftaya zıplamıyor).

### Gün-gece
- Küre üzerinde güneş, oyun saatine ve tarihe göre gerçek konumunda. Gece tarafı karanlık.

## Yol haritası
- **v0.2 (tamam):** 3B küre ve zoom, tüm havaalanları, talep ekonomisi, gerçek uçaklar, lisanslar, üsler, gün-gece, sezonlar, kayıt.
- **v0.3 (şimdi):** Harita MapLibre küre görünümüne geçti. Yakınlaştıkça gerçek harita ve havalimanında OpenStreetMap verisiyle gerçek pistler, taksi yolları, apronlar ve 3B binalar (terminal, kule, hangar). Yakınlaşınca kamera otomatik eğilir. Gece bölgesi harita üzerinde gölge olarak görünür. Ayrı yakın plan ekranı kaldırıldı (kodu `arsiv/v0.3` içinde).
- **v0.3.1 (tamam):** Havalimanına yakınlaşınca 3B uçaklar: OpenStreetMap'teki gerçek kapılara park eder (kapı yoksa apron üzerine), gerçek pistlere iner ve kalkar, taksi yollarından geçer, geri itilir (pushback). Senin uçakların sarı kuyruklu, sayıları o havalimanındaki sefer payına göre.
- **v0.6 (tamam):** Olaylar ve haberler. Bkz. "Olaylar" bölümü.
- **v1.1 (şimdi):** Senaryolar, 174 havalimanı, renk körü modu.
- **v1.0 (tamam):** Denge testleri, kargo, sözleşmeler, rakip satın alma, rozetler.
- **v0.9 (tamam):** Cila ve deneyim: ses ve müzik, görsel geri bildirim, grafikler, ayarlar, kayıt taşıma, PWA, bağlamsal eğitim.
- **v0.8 (tamam):** Derinlik: aktarmalı yolcu, kabin sınıfları ve hizmet, uçak yaşı ve bakım, ikinci el pazarı, kredi ve hisse, slotlar.
- **v0.7 (tamam):** İdle çekirdeği: çevrimdışı kazanç, yükseltmeler, görevler, otomasyon (müdürler), Holding (prestij). Bkz. "İlerleme" bölümü.
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
js/depth.js        uçak yaşlanması ve bakım, ikinci el pazarı, kredi ve hisse
js/settings.js     cihaz ayarları, kayıt kodu (dışa/içe aktarma)
js/audio.js        ses efektleri, müzik, titreşim (Web Audio)
js/fx.js           uçan para yazısı, konfeti, kutlama kartı
js/charts.js       SVG çizgi ve sütun grafikler
js/tutorial.js     bağlamsal ipuçları ve "Nasıl oynanır" rehberi
js/game.js         arayüzden bağımsız çekirdek: yeni oyun, hat açma, gün sonu akışı
js/extra.js        sözleşmeler, rakip satın alma, rozetler
js/scenarios.js    senaryolar: başlangıç, hedef, süre, yıldız
tests/             Node testleri: bot oyuncu, denge raporu (node tests/run.mjs)
js/main.js         oyun döngüsü, arayüz, kayıt
sw.js              service worker (internetsiz çalışma)
manifest.webmanifest, icons/   uygulama tanımı ve simgeler
arsiv/v0.1         ilk prototip
```
