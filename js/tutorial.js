// Eğitim: oyun ilerledikçe bir kez çıkan bağlamsal ipuçları ve "Nasıl oynanır" rehberi.
import * as sim from './sim.js';
import { TIERS } from './data.js';
import * as P from './progress.js';
import * as X from './extra.js';

const { AP } = sim;
const lastPax = S => S.history.length ? S.history[S.history.length - 1].pax : 0;

// open: ipucu kartındaki düğmenin açacağı panel (main.js yorumlar)
export const TIPS = [
  { id: 'day1', when: S => S.day >= 1 && S.history.length,
    title: 'İlk gün kapandı',
    text: 'Her gece yarısı gelir ve giderler hesaplanır. Kasanın yanında günün kârı uçar. Ayrıntılar ve grafikler <b>Rapor</b> menüsünde.', open: ['report', 'sum'], btn: 'Raporu aç' },
  { id: 'brand', when: S => S.day >= 2 && !S.brand,
    title: 'Havayolunun kimliği',
    text: 'Havayolunun rengini, logosunu ve uçak boyasını <b>Ayarlar → Havayolu</b>\'ndan seçebilirsin. Yakınlaşınca 3B uçakların senin boyanla uçar.', open: ['settings'], btn: 'Ayarlar' },
  { id: 'zoom', when: S => S.day >= 3,
    title: 'Havalimanına yakınlaş',
    text: 'Bir havalimanına iki parmakla (ya da fare tekerleğiyle) iyice yakınlaşırsan gerçek pistleri, binaları ve uçaklarını 3B görürsün.' },
  { id: 'loadHigh', when: S => S.routes.some(r => r.last && r.last.load > 0.97 && r.age > 5),
    title: 'Uçaklar tıklım tıklım',
    text: 'Bir hattın doluluğu %97\'yi geçti. Yolcu kaçırıyorsun: hatta bir uçak daha ekle ya da bilet fiyatını artır. Hat ekranında fiyat kaydırıcısı var.', open: ['routes'], btn: 'Rotaları aç' },
  { id: 'loadLow', when: S => S.routes.some(r => r.last && r.last.load < 0.5 && r.age > 10),
    title: 'Boş koltuklar',
    text: 'Bir hattın doluluğu %50\'nin altında. Fiyatı indir, daha küçük bir uçak koy ya da uçağı daha kalabalık bir hatta taşı.', open: ['routes'], btn: 'Rotaları aç' },
  { id: 'goal', when: S => P.goalState(S).claimable > 0,
    title: 'Görev ödülü hazır',
    text: '<b>Gelişim → Görevler</b>\'de tamamlanan görevin ödülünü alabilirsin. Aynı anda 3 görev açık olur; bitirdikçe yenileri gelir.', open: ['license', 'goals'], btn: 'Görevlere git' },
  { id: 'rival', when: S => (S.rivals || []).some(rv => rv.active && rv.routes.some(rr => S.routes.some(r => (r.a === rr.a && r.b === rr.b) || (r.a === rr.b && r.b === rr.a)))),
    title: 'Rakip hattına girdi',
    text: 'Aynı hatta uçan havayolları yolcuyu paylaşır: koltuk sayısı, bilet fiyatı ve itibar belirler. Rakipler her hafta fiyat ve uçak kararı verir. Zarar eden rakip hattan çekilir. <b>Rakipler</b> menüsünde sıralamayı gör.', open: ['rivals'], btn: 'Rakipleri aç' },
  { id: 'event', when: S => sim.activeEvents(S).length > 0,
    title: 'Olaylar ve haberler',
    text: 'Hava durumu, bayramlar, grevler ve yakıt fiyatı talebi ve giderleri değiştirir. Etkilenen havalimanı haritada renkli işaretlenir. Üstteki <b>Haberler</b> düğmesinden süren olayları ve kalan günleri gör.', open: ['news'], btn: 'Haberleri aç' },
  { id: 'upgrade', when: S => S.cash > 2e6 && !P.totalUpgrades(S) && S.day > 5,
    title: 'Kalıcı yükseltmeler',
    text: '<b>Gelişim → Yükseltmeler</b>\'de yakıt, bakım ve ekip giderlerini kalıcı olarak düşürebilir, talebi artırabilirsin. Erken alınan yükseltme kendini çabuk öder.', open: ['license', 'upgrades'], btn: 'Yükseltmeler' },
  { id: 'license', when: S => S.tier < 4 && S.totalPax >= TIERS[S.tier].pax * 0.4,
    title: 'Lisanslar',
    text: S => `Bir sonraki lisans <b>${TIERS[S.tier].name}</b>: ${num(TIERS[S.tier].pax)} toplam yolcu ve ${money(TIERS[S.tier].fee)} gerekir. Yeni lisans daha uzak havalimanları ve daha büyük uçaklar açar.`, open: ['license', 'license'], btn: 'Lisanslara bak' },
  { id: 'base2', when: S => S.cash > sim.baseCost(S) * 2 && S.bases.length === 1 && S.routes.length >= 3,
    title: 'İkinci üs',
    text: 'Rotalar yalnızca üslerinden başlar. Kalabalık bir havalimanına dokunup <b>Üs kur</b> dersen yeni bir merkez açılır ve oradan da hat açabilirsin.' },
  { id: 'hub', when: S => S.bases.some(b => S.routes.filter(r => r.a === b || r.b === b).length >= 2) && S.day > 4,
    title: 'Aktarmalı yolcu',
    text: 'Bir üssüne bağlı iki hattın uçları arasında seyahat edenler üssünde aktarma yapar ve boş koltuklarını doldurur. Üssüne dokununca <b>Aktarma merkezi</b> kutusunu görürsün.' },
  { id: 'maint', when: S => S.fleet.some(f => sim.condOf(f) < 72),
    title: 'Uçak bakımı',
    text: 'Uçan uçaklar yıpranır. Durumu %65\'in altına düşen uçak arıza yapıp günlerce yerde kalabilir. <b>Filo</b> menüsünden ağır bakım yaptır ya da <b>Teknik müdür</b> işe al.', open: ['fleet'], btn: 'Filoyu aç' },
  { id: 'slot', when: S => S.routes.some(r => sim.slotControlled(AP[r.a]) && sim.slotUsed(S, r.a) > sim.slotCap(S, r.a) * 0.85),
    title: 'Slotlar doluyor',
    text: 'Büyük havalimanlarında günlük kalkış hakkı sınırlı. Sınır aşılırsa seferlerin bir kısmı yapılamaz. Havalimanına dokunup slot paketi satın alabilirsin.' },
  { id: 'managers', when: S => S.routes.length >= 4 && !Object.keys(S.managers || {}).length,
    title: 'Müdürler',
    text: 'Ağın büyüdükçe her şeyi elle yönetmek zorlaşır. <b>Gelişim → Otomasyon</b>\'dan fiyatları, filoyu ve bakımı yöneten müdürler işe alabilirsin.', open: ['license', 'auto'], btn: 'Otomasyon' },
  { id: 'loan', when: S => S.cash < 1.5e6 && S.day > 10 && !(S.loans || []).length,
    title: 'Banka kredisi',
    text: 'Paran azaldıysa <b>Rapor → Finans</b>\'tan kredi çekebilirsin. Taksitler her gün kasadan düşer; borcun arttıkça faiz yükselir.', open: ['report', 'fin'], btn: 'Finans' },
  { id: 'deal', when: S => (S.offers || []).length > 0,
    title: 'Sözleşme teklifi geldi',
    text: 'Tur şirketleri, kargo firmaları ve şehirler sana anlaşma teklif eder: bir hatta koltuk garantisi, ek kargo ya da tanıtım kampanyası. Kabul edersen süre içinde şartı sağlaman gerekir. Teklif 7 gün sonra düşer.', open: ['license', 'deals'], btn: 'Sözleşmeler' },
  { id: 'cargo', when: S => S.tier >= 2 && S.history.length && (S.history[S.history.length - 1].cargo || 0) > 5,
    title: 'Kargo da taşıyorsun',
    text: 'Yolcu uçaklarının alt bölmesinde kargo taşınır. Büyük uçaklar ve uluslararası hatlar daha çok kargo getirir. Hat ekranında ton ve geliri görürsün. <b>Kargo terminali</b> yükseltmesi talebi artırır.' },
  { id: 'acquire', when: S => (S.rivals || []).some(rv => rv.active && !X.canAcquire(S, rv)),
    title: 'Rakibi satın alabilirsin',
    text: 'Şirketin bir rakibi satın alacak kadar büyüdü. Satın alınca merkezi senin üssün olur, hatları ve uçakları sana geçer. <b>Rakipler</b> menüsünün altında.', open: ['rivals'], btn: 'Rakipler' },
  { id: 'offline', when: S => S.day >= 6,
    title: 'Sen yokken de uçarlar',
    text: 'Oyunu kapatınca ya da telefonu bıraktığında uçakların çalışmaya devam eder. Döndüğünde son günlerin ortalamasına göre kazancını toplarsın.' },
  { id: 'holding', when: S => P.canPrestige(S),
    title: 'Holding kurabilirsin',
    text: 'Şirketini holdinge çevirip sıfırdan başlarsan kalıcı yıldızlar kazanırsın: her yıldız gelirini %5 ve başlangıç kasanı 1 M$ artırır.', open: ['license', 'holding'], btn: 'Holding' },
];

const money = n => n >= 1e6 ? `$${(n / 1e6).toFixed(n >= 1e8 ? 0 : 1)}M` : `$${Math.round(n / 1e3)}K`;
const num = n => Math.round(n).toLocaleString('tr-TR');

export function nextTip(S, seen) {
  for (const t of TIPS) {
    if (seen.includes(t.id)) continue;
    try { if (t.when(S)) return { ...t, text: typeof t.text === 'function' ? t.text(S) : t.text }; } catch (_) { /* eski kayıt */ }
  }
  return null;
}

// "Nasıl oynanır" rehberi
export const GUIDE = [
  ['Amaç', 'Türkiye\'de küçük bir bölgesel havayolu olarak başla. Kâr ettikçe lisans alıp büyü: Bölgesel → Ulusal → Kıtasal → Uluslararası. Kasan −10 M$\'ın altına inerse iflas edersin.'],
  ['İlk adımlar', '1) <b>Filo → Uçak pazarı</b>\'ndan bir uçak kirala. 2) Haritada üssüne (★) dokun, <b>Buradan rota aç</b> de. 3) Hedef havalimanına dokun, uçağı seç, fiyatı ayarla ve rotayı aç. Gece yarısı gün kapanır ve kâr hesaplanır.'],
  ['Talep ve fiyat', 'Her şehir çifti arasında günlük talep vardır: nüfus, mesafe ve mevsime bağlıdır. 400 km\'den kısa hatlarda insanlar karayolunu seçer. Bilet pahalılaştıkça talep düşer. Yeni hat talebin %40\'ıyla başlar, 30 günde dolar.'],
  ['Uçaklar', 'Kiralık uçak az peşin para ister ama günlük kira ödersin. Satın alınan uçak pahalıdır ama gideri düşüktür. Uçaklar yaşlanır ve yıpranır; ağır bakım durumlarını yeniler. İkinci el uçaklar ucuzdur ama daha çok yakıt yakar.'],
  ['Rakipler', 'Rakip havayolları aynı hatlarda yolcuyu seninle paylaşır. Kapasite, fiyat ve itibar payı belirler. Haftada bir fiyat ve filo kararı verirler; zarar eden hattan çekilirler, borcu çok artan rakip iflas eder.'],
  ['Olaylar', 'Kar, sis, fırtına, bayramlar, festivaller, grevler ve yakıt fiyatı oyunu etkiler. Bazen oyun durur ve bir karar vermen istenir. Süren olaylar <b>Haberler</b>\'de.'],
  ['Aktarma ve üsler', 'Rotalar üslerinden başlar. Bir üsse bağlı iki hattın uçları arasındaki yolcular orada aktarma yapar ve boş koltukları doldurur. İkinci üs 1,5 M$; her yeni üs bir öncekinden %80 pahalıdır.'],
  ['Kargo', 'Yolcu uçaklarının alt bölmesinde kargo taşınır: ATR yaklaşık 0,8 ton, A320 3,5 ton, 777 24 ton. Kargo talebi şehirlerin büyüklüğüne ve mesafeye bağlıdır, uluslararası hatlarda daha yüksektir. Kargo terminali yükseltmesi talebi artırır.'],
  ['Sözleşmeler', 'Birkaç günde bir teklif gelir. Koltuk anlaşması: süre boyunca her gün bir hatta en az belirtilen kadar koltuk sun (3 aksamada iptal ve ceza). Kargo anlaşması: müşteri hatta ek yük getirir, süre içinde toplam tonajı taşı. Tanıtım kampanyası: şehrin talebi %25 artar, süre içinde belirtilen yolcuyu taşı. Aynı anda en fazla 3 sözleşme.'],
  ['Büyük şirket olmak', 'Filo büyüdükçe uçak başına yönetim gideri artar: 10 uçaklık şirket uçak başına günde $700, 100 uçaklık şirket $4.300 öder. Ulusal lisanstan sonra zayıflayan ya da senden küçük kalan rakipleri satın alabilirsin. Rozetler Rapor → Rozetler sekmesinde.'],
  ['Slotlar', 'Büyük havalimanlarında günlük kalkış hakkı sınırlıdır. Fazlası için havalimanı ekranından slot paketi al.'],
  ['Gelişim', 'Görevler para ödülü verir. Yükseltmeler kalıcıdır. Müdürler fiyat, filo, yeni hat ve bakımı otomatik yönetir. Holding kurunca her şey sıfırlanır ama kalıcı yıldızlar kazanırsın.'],
  ['Finans', 'Şirket değeri kasa, uçaklar, kârlılık ve borçtan oluşur. Banka kredisi alabilir, Ulusal lisanstan sonra halka arz edip hisse satabilirsin.'],
  ['Kontroller', 'Sürükle: döndür. İki parmak ya da tekerlek: yakınlaş. Sağ üst: oyun hızı (duraklat, 1×, 4×, 16×). Oyun her gün sonunda kendiliğinden kaydedilir.'],
];
