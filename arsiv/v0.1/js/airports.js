// Bölgeler: yolcular gitmek istedikleri bölgenin rengiyle gösterilir.
const REGIONS = {
  EU: { name: 'Avrupa',        color: '#4f8cff' },
  ME: { name: 'Orta Doğu',     color: '#f5a524' },
  AF: { name: 'Afrika',        color: '#2fbf71' },
  AS: { name: 'Asya',          color: '#ff5a5f' },
  NA: { name: 'Kuzey Amerika', color: '#a970ff' },
  SA: { name: 'Güney Amerika', color: '#ff7ac6' },
  OC: { name: 'Okyanusya',     color: '#22c3c3' },
};

// Büyük havaalanları (yaklaşık koordinatlar).
const AIRPORTS = [
  // Avrupa
  { code: 'IST', city: 'İstanbul',     r: 'EU', lat: 41.26, lon: 28.74 },
  { code: 'LHR', city: 'Londra',       r: 'EU', lat: 51.47, lon: -0.45 },
  { code: 'CDG', city: 'Paris',        r: 'EU', lat: 49.01, lon: 2.55 },
  { code: 'FRA', city: 'Frankfurt',    r: 'EU', lat: 50.03, lon: 8.57 },
  { code: 'AMS', city: 'Amsterdam',    r: 'EU', lat: 52.31, lon: 4.76 },
  { code: 'MAD', city: 'Madrid',       r: 'EU', lat: 40.47, lon: -3.56 },
  { code: 'FCO', city: 'Roma',         r: 'EU', lat: 41.80, lon: 12.25 },
  { code: 'ATH', city: 'Atina',        r: 'EU', lat: 37.94, lon: 23.94 },
  { code: 'SVO', city: 'Moskova',      r: 'EU', lat: 55.97, lon: 37.41 },
  { code: 'CPH', city: 'Kopenhag',     r: 'EU', lat: 55.62, lon: 12.65 },
  // Orta Doğu
  { code: 'DXB', city: 'Dubai',        r: 'ME', lat: 25.25, lon: 55.36 },
  { code: 'DOH', city: 'Doha',         r: 'ME', lat: 25.27, lon: 51.61 },
  { code: 'RUH', city: 'Riyad',        r: 'ME', lat: 24.96, lon: 46.70 },
  { code: 'TLV', city: 'Tel Aviv',     r: 'ME', lat: 32.01, lon: 34.88 },
  { code: 'JED', city: 'Cidde',        r: 'ME', lat: 21.68, lon: 39.16 },
  // Afrika
  { code: 'CAI', city: 'Kahire',       r: 'AF', lat: 30.12, lon: 31.41 },
  { code: 'CMN', city: 'Kazablanka',   r: 'AF', lat: 33.37, lon: -7.59 },
  { code: 'ADD', city: 'Addis Ababa',  r: 'AF', lat: 8.98,  lon: 38.80 },
  { code: 'NBO', city: 'Nairobi',      r: 'AF', lat: -1.32, lon: 36.93 },
  { code: 'LOS', city: 'Lagos',        r: 'AF', lat: 6.58,  lon: 3.32 },
  { code: 'JNB', city: 'Johannesburg', r: 'AF', lat: -26.13, lon: 28.24 },
  { code: 'CPT', city: 'Cape Town',    r: 'AF', lat: -33.97, lon: 18.60 },
  // Asya
  { code: 'DEL', city: 'Delhi',        r: 'AS', lat: 28.56, lon: 77.10 },
  { code: 'BOM', city: 'Mumbai',       r: 'AS', lat: 19.09, lon: 72.87 },
  { code: 'BKK', city: 'Bangkok',      r: 'AS', lat: 13.69, lon: 100.75 },
  { code: 'SIN', city: 'Singapur',     r: 'AS', lat: 1.36,  lon: 103.99 },
  { code: 'KUL', city: 'Kuala Lumpur', r: 'AS', lat: 2.75,  lon: 101.71 },
  { code: 'CGK', city: 'Cakarta',      r: 'AS', lat: -6.13, lon: 106.66 },
  { code: 'HKG', city: 'Hong Kong',    r: 'AS', lat: 22.31, lon: 113.92 },
  { code: 'PVG', city: 'Şanghay',      r: 'AS', lat: 31.14, lon: 121.81 },
  { code: 'PEK', city: 'Pekin',        r: 'AS', lat: 40.08, lon: 116.58 },
  { code: 'ICN', city: 'Seul',         r: 'AS', lat: 37.46, lon: 126.44 },
  { code: 'HND', city: 'Tokyo',        r: 'AS', lat: 35.55, lon: 139.78 },
  // Kuzey Amerika
  { code: 'JFK', city: 'New York',     r: 'NA', lat: 40.64, lon: -73.78 },
  { code: 'YYZ', city: 'Toronto',      r: 'NA', lat: 43.68, lon: -79.63 },
  { code: 'ORD', city: 'Chicago',      r: 'NA', lat: 41.98, lon: -87.90 },
  { code: 'ATL', city: 'Atlanta',      r: 'NA', lat: 33.64, lon: -84.43 },
  { code: 'MIA', city: 'Miami',        r: 'NA', lat: 25.79, lon: -80.29 },
  { code: 'MEX', city: 'Meksiko',      r: 'NA', lat: 19.44, lon: -99.07 },
  { code: 'LAX', city: 'Los Angeles',  r: 'NA', lat: 33.94, lon: -118.41 },
  { code: 'SFO', city: 'San Francisco',r: 'NA', lat: 37.62, lon: -122.38 },
  { code: 'YVR', city: 'Vancouver',    r: 'NA', lat: 49.19, lon: -123.18 },
  // Güney Amerika
  { code: 'BOG', city: 'Bogota',       r: 'SA', lat: 4.70,  lon: -74.15 },
  { code: 'LIM', city: 'Lima',         r: 'SA', lat: -12.02, lon: -77.11 },
  { code: 'GRU', city: 'São Paulo',    r: 'SA', lat: -23.43, lon: -46.47 },
  { code: 'EZE', city: 'Buenos Aires', r: 'SA', lat: -34.82, lon: -58.54 },
  { code: 'SCL', city: 'Santiago',     r: 'SA', lat: -33.39, lon: -70.79 },
  // Okyanusya
  { code: 'PER', city: 'Perth',        r: 'OC', lat: -31.94, lon: 115.97 },
  { code: 'SYD', city: 'Sidney',       r: 'OC', lat: -33.94, lon: 151.18 },
  { code: 'MEL', city: 'Melbourne',    r: 'OC', lat: -37.67, lon: 144.84 },
  { code: 'AKL', city: 'Auckland',     r: 'OC', lat: -37.01, lon: 174.79 },
];

const START_AIRPORTS = ['IST', 'LHR', 'DXB', 'CAI'];
