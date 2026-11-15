# SkyWeave

Türkiye'de küçük bir bölgesel havayolu kur, dünyaya açıl. Tarayıcıda çalışan, telefona uygun bir havayolu yönetim oyunu.

**Oyna:** https://enesfamous-hub.github.io/skyweave/

- Dünya küresinden havalimanına kadar kesintisiz yakınlaşma; havalimanlarında OpenStreetMap verisiyle gerçek pistler, 3B binalar ve 3B uçak trafiği
- Gerçek uçak modelleri, talep ekonomisi, lisanslarla büyüme (Bölgesel → Ulusal → Kıtasal → Uluslararası)
- Rakip havayolları (satın alınabilir), olaylar ve haberler
- Kargo, sözleşme teklifleri, rozetler
- Senaryolar: hedefli, süreli başlangıçlar (1–3 yıldız); 174 havalimanı
- Günün görevi, havayolu rengi/logosu/uçak boyası, Holding yolları
- Ses ve müzik, grafikler, kayıt taşıma; ana ekrana eklenip internetsiz oynanabilir (PWA)

Tasarım ayrıntıları: [TASARIM.md](TASARIM.md)

## Yerelde çalıştırma

```bash
python -m http.server 8417
```

Sonra tarayıcıda `http://localhost:8417` adresini aç.

## Testler

```bash
node tests/run.mjs
```

Bot oyuncuyla oyunu 365 gün oynatıp dengeyi ve tutarlılığı denetler (Node 22+). Ayrıntılı denge raporu: `node tests/balance.mjs 720 4`.

## Kaynaklar

Harita: © OpenStreetMap katkıcıları, OpenFreeMap, OpenMapTiles. Harita motoru: MapLibre GL JS.
