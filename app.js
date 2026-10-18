/* Sky — weather in plain HTML, CSS and JS. No build step, no API keys, no tracking. */
(() => {
'use strict';

/* ------------------------------------------------------------------ helpers */
const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad = n => String(n).padStart(2, '0');
const lang = navigator.language || 'en';
const store = {
  get(k, d) { try { const v = localStorage.getItem('sky.' + k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('sky.' + k, JSON.stringify(v)); } catch { /* storage blocked */ } }
};

async function getJSON(url, signal, ms = 9000) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), ms);
  const onAbort = () => ctl.abort();
  signal?.addEventListener('abort', onAbort);
  try {
    const r = await fetch(url, { signal: ctl.signal, headers: { Accept: 'application/json' } });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return await r.json();
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

/* "YYYY-MM-DDTHH:MM" local-time strings are used everywhere, so no time-zone maths is needed. */
const mins = s => +s.slice(11, 13) * 60 + +s.slice(14, 16);
const fmtHour = s => new Date(s).toLocaleTimeString(lang, { hour: 'numeric' });
const fmtTime = s => new Date(s).toLocaleTimeString(lang, { hour: 'numeric', minute: '2-digit' });
const fmtDay = (s, i) => i === 0 ? 'Today' : new Date(s + 'T12:00').toLocaleDateString(lang, { weekday: 'short' });

/* ------------------------------------------------------------------- state */
const GEO_IDS = ['openmeteo', 'nominatim', 'photon'];
const state = {
  theme: document.documentElement.dataset.theme || 'light',
  units: store.get('units', /^en-US/i.test(lang) ? 'imperial' : 'metric'),
  place: null,
  geocoders: (store.get('geocoders', GEO_IDS) || []).filter(k => GEO_IDS.includes(k)),
  provider: store.get('provider', 'openmeteo'),
  data: null,
  air: null,
  loadId: 0
};
if (!state.geocoders.length) state.geocoders = GEO_IDS.slice();

/* -------------------------------------------------------------------- theme */
function applyTheme(t, persist) {
  state.theme = t;
  document.documentElement.dataset.theme = t;
  $('#btn-light').setAttribute('aria-pressed', String(t === 'light'));
  $('#btn-dark').setAttribute('aria-pressed', String(t === 'dark'));
  $('meta[name="theme-color"]').setAttribute('content', t === 'dark' ? '#0c1117' : '#eef3f9');
  if (persist) store.set('theme', t);
}
$('#btn-light').addEventListener('click', () => applyTheme('light', true));
$('#btn-dark').addEventListener('click', () => applyTheme('dark', true));
if (window.matchMedia) {
  matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', e => {
    if (!store.get('theme', null)) applyTheme(e.matches ? 'dark' : 'light', false);
  });
}

/* -------------------------------------------------------------------- icons */
const RAYS = [...Array(8)].map((_, i) => {
  const a = i * Math.PI / 4, c = Math.cos(a), s = Math.sin(a);
  return `<line x1="${(24 + c * 12).toFixed(1)}" y1="${(24 + s * 12).toFixed(1)}" x2="${(24 + c * 16).toFixed(1)}" y2="${(24 + s * 16).toFixed(1)}"/>`;
}).join('');
const SUN = `<circle cx="24" cy="24" r="8" style="fill:var(--sun)"/><g style="stroke:var(--sun)" stroke-width="3" stroke-linecap="round">${RAYS}</g>`;
const MOON = `<path transform="scale(2)" d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" style="fill:var(--moon)"/>`;
const CLOUD_D = 'M15 36h19a8 8 0 0 0 .8-15.97A11 11 0 0 0 13.6 22.4 7 7 0 0 0 15 36z';
const cloud = (dark, tr = '') => `<path d="${CLOUD_D}" transform="${tr}" style="fill:var(--${dark ? 'cloud-dark' : 'cloud'})"/>`;
const DROPS = '<g style="stroke:#58a6ff" stroke-width="3" stroke-linecap="round"><line x1="18" y1="36" x2="16" y2="42"/><line x1="25" y1="36" x2="23" y2="42"/><line x1="32" y1="36" x2="30" y2="42"/></g>';
const DRIZZLE = '<g style="stroke:#8fc2ff" stroke-width="2.5" stroke-linecap="round"><line x1="19" y1="37" x2="18" y2="41"/><line x1="27" y1="37" x2="26" y2="41"/></g>';
const FLAKES = '<g fill="#cfe6ff"><circle cx="18" cy="38" r="2"/><circle cx="25" cy="42" r="2"/><circle cx="32" cy="38" r="2"/></g>';
const BOLT = '<path d="M26 27l-7 10h5l-2 8 9-12h-5z" fill="#ffc83d"/>';

function icon(key, day = true, size = 48) {
  const lum = day ? SUN : MOON;
  const small = day ? `<g transform="translate(-2 -6) scale(.8)">${SUN}</g>` : `<g transform="translate(-4 -6) scale(.8)">${MOON}</g>`;
  const up = 'translate(0 -4)';
  let body;
  switch (key) {
    case 'clear': body = lum; break;
    case 'partly': body = small + cloud(false, 'translate(4 4)'); break;
    case 'cloudy': body = cloud(true, 'translate(7 -3) scale(.85)') + cloud(false, 'translate(-2 3)'); break;
    case 'fog': body = cloud(false, up) + `<g style="stroke:var(--cloud-dark)" stroke-width="3" stroke-linecap="round"><line x1="10" y1="37" x2="38" y2="37"/><line x1="14" y1="43" x2="34" y2="43"/></g>`; break;
    case 'drizzle': body = cloud(true, up) + DRIZZLE; break;
    case 'rain': body = cloud(true, up) + DROPS; break;
    case 'snow': body = cloud(false, up) + FLAKES; break;
    case 'sleet': body = cloud(true, up) + '<g style="stroke:#58a6ff" stroke-width="3" stroke-linecap="round"><line x1="18" y1="36" x2="16" y2="42"/></g><g fill="#cfe6ff"><circle cx="25" cy="40" r="2"/><circle cx="32" cy="37" r="2"/></g>'; break;
    case 'thunder': body = cloud(true, up) + BOLT; break;
    default: body = cloud(false, 'translate(-2 3)');
  }
  return `<svg viewBox="0 0 48 48" width="${size}" height="${size}" role="img" aria-label="${esc(label(key, day))}">${body}</svg>`;
}

const LABELS = {
  clear: ['Clear sky', 'Clear night'], partly: ['Partly cloudy', 'Partly cloudy'], cloudy: ['Cloudy', 'Cloudy'],
  fog: ['Fog', 'Fog'], drizzle: ['Drizzle', 'Drizzle'], rain: ['Rain', 'Rain'], snow: ['Snow', 'Snow'],
  sleet: ['Sleet', 'Sleet'], thunder: ['Thunderstorm', 'Thunderstorm']
};
const label = (key, day) => (LABELS[key] || LABELS.cloudy)[day ? 0 : 1];

/* hero gradients: [top-left, bottom-right] */
const SKY = {
  day: {
    clear: ['#2d7fe6', '#6bbcf5'], partly: ['#4b86c8', '#8db4d8'], cloudy: ['#6f8399', '#a2b1c1'],
    fog: ['#8a9aa8', '#b9c3cc'], drizzle: ['#4d6580', '#7b95ad'], rain: ['#3e5671', '#6c869f'],
    snow: ['#7c93ad', '#c0cfdf'], sleet: ['#66798f', '#9fb0c2'], thunder: ['#2f3a52', '#5a5f80']
  },
  night: {
    clear: ['#0b1636', '#233b73'], partly: ['#16223f', '#3a4e78'], cloudy: ['#202b3b', '#3e4c60'],
    fog: ['#2b3440', '#4c5866'], drizzle: ['#18232f', '#34495f'], rain: ['#151f2e', '#2e4157'],
    snow: ['#2a3649', '#566a85'], sleet: ['#202b3a', '#42536a'], thunder: ['#120f22', '#2d2a4d']
  }
};

/* -------------------------------------------------------------- unit helpers */
const imp = () => state.units === 'imperial';
const T = c => c == null ? '–' : Math.round(imp() ? c * 9 / 5 + 32 : c) + '°';
const speed = kmh => kmh == null ? '–' : imp() ? Math.round(kmh * 0.621371) + ' mph' : Math.round(kmh) + ' km/h';
const dist = m => m == null ? '–' : imp() ? (m / 1609.34).toFixed(1) + ' mi' : (m / 1000).toFixed(m >= 10000 ? 0 : 1) + ' km';
const pres = h => h == null ? '–' : imp() ? (h * 0.02953).toFixed(2) + ' inHg' : Math.round(h) + ' hPa';
const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
const compass = d => d == null ? '' : COMPASS[Math.round(d / 45) % 8];

/* --------------------------------------------------- condition code mappers */
function wmo(c) {
  if (c === 0 || c === 1) return 'clear';
  if (c === 2) return 'partly';
  if (c === 3) return 'cloudy';
  if (c === 45 || c === 48) return 'fog';
  if (c >= 51 && c <= 57) return 'drizzle';
  if (c === 66 || c === 67) return 'sleet';
  if ((c >= 61 && c <= 65) || (c >= 80 && c <= 82)) return 'rain';
  if ((c >= 71 && c <= 77) || c === 85 || c === 86) return 'snow';
  if (c >= 95) return 'thunder';
  return 'cloudy';
}
function metKey(s) {
  const b = (s || '').replace(/_(day|night|polartwilight)$/, '');
  if (b.includes('thunder')) return 'thunder';
  if (b.includes('sleet')) return 'sleet';
  if (b.includes('snow')) return 'snow';
  if (b.includes('rain') || b.includes('showers')) return b.includes('light') ? 'drizzle' : 'rain';
  if (b === 'fog') return 'fog';
  if (b === 'clearsky' || b === 'fair') return 'clear';
  if (b === 'partlycloudy') return 'partly';
  return 'cloudy';
}
function wwo(c) {
  c = +c;
  if (c === 113) return 'clear';
  if (c === 116) return 'partly';
  if (c === 119 || c === 122) return 'cloudy';
  if ([143, 248, 260].includes(c)) return 'fog';
  if ([200, 386, 389, 392, 395].includes(c)) return 'thunder';
  if ([179, 227, 230, 323, 326, 329, 332, 335, 338, 368, 371].includes(c)) return 'snow';
  if ([182, 185, 281, 284, 311, 314, 317, 320, 350, 362, 365, 374, 377].includes(c)) return 'sleet';
  if ([263, 266, 293, 296].includes(c)) return 'drizzle';
  if ([176, 299, 302, 305, 308, 353, 356, 359].includes(c)) return 'rain';
  return 'cloudy';
}

/* ====================================================== GEOCODERS (metasearch) */
const GEOCODERS = {
  openmeteo: {
    label: 'Open-Meteo', note: 'Fast, weather-focused place index',
    async search(q, signal) {
      const j = await getJSON(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=6&language=${encodeURIComponent(lang.slice(0, 2))}&format=json`, signal);
      return (j.results || []).map(r => ({ name: r.name, admin: r.admin1 || '', country: r.country || '', lat: r.latitude, lon: r.longitude, src: 'openmeteo' }));
    }
  },
  nominatim: {
    label: 'OpenStreetMap', note: 'Nominatim — streets, villages, landmarks',
    async search(q, signal) {
      const j = await getJSON(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=jsonv2&limit=6&addressdetails=1&accept-language=${encodeURIComponent(lang)}`, signal);
      return j.map(r => {
        const a = r.address || {};
        return { name: r.name || a.city || a.town || a.village || r.display_name.split(',')[0], admin: a.state || a.county || '', country: a.country || '', lat: +r.lat, lon: +r.lon, src: 'nominatim' };
      });
    }
  },
  photon: {
    label: 'Photon', note: 'Komoot — typo-tolerant OSM search',
    async search(q, signal) {
      const j = await getJSON(`https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&limit=6&lang=en`, signal);
      return (j.features || []).filter(f => f.properties?.name).map(f => ({ name: f.properties.name, admin: f.properties.state || '', country: f.properties.country || '', lat: f.geometry.coordinates[1], lon: f.geometry.coordinates[0], src: 'photon' }));
    }
  }
};

const norm = s => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
function mergeResults(lists) {
  const out = new Map();
  const max = Math.max(0, ...lists.map(l => l.length));
  for (let i = 0; i < max; i++) {
    for (const l of lists) {
      const r = l[i];
      if (!r || !isFinite(r.lat) || !isFinite(r.lon)) continue;
      const key = norm(r.name) + '|' + r.lat.toFixed(1) + ',' + r.lon.toFixed(1);
      const ex = out.get(key);
      if (ex) { if (!ex.srcs.includes(r.src)) ex.srcs.push(r.src); }
      else out.set(key, { ...r, srcs: [r.src] });
    }
  }
  /* places confirmed by several sources float to the top, order is otherwise kept */
  return [...out.values()].map((v, i) => [v, i]).sort((a, b) => b[0].srcs.length - a[0].srcs.length || a[1] - b[1]).map(x => x[0]).slice(0, 8);
}

/* ================================================== WEATHER PROVIDERS (all → one shape) */
async function wxOpenMeteo(lat, lon, signal) {
  const p = new URLSearchParams({
    latitude: lat, longitude: lon, timezone: 'auto', forecast_days: '7', wind_speed_unit: 'kmh',
    current: 'temperature_2m,apparent_temperature,relative_humidity_2m,is_day,weather_code,pressure_msl,wind_speed_10m,wind_direction_10m,visibility,uv_index',
    hourly: 'temperature_2m,weather_code,precipitation_probability,is_day',
    daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,sunrise,sunset,uv_index_max'
  });
  const j = await getJSON('https://api.open-meteo.com/v1/forecast?' + p, signal);
  const c = j.current, h = j.hourly, d = j.daily;
  let start = h.time.findIndex(t => t >= c.time.slice(0, 13) + ':00');
  if (start < 0) start = 0;
  const hourly = [];
  for (let i = start; i < Math.min(start + 24, h.time.length); i++) {
    hourly.push({ time: h.time[i], temp: h.temperature_2m[i], key: wmo(h.weather_code[i]), day: !!h.is_day[i], pop: h.precipitation_probability[i] });
  }
  const daily = d.time.map((t, i) => ({ date: t, max: d.temperature_2m_max[i], min: d.temperature_2m_min[i], key: wmo(d.weather_code[i]), pop: d.precipitation_probability_max[i], sunrise: d.sunrise[i], sunset: d.sunset[i], uv: d.uv_index_max[i] }));
  return {
    now: c.time, hourly, daily,
    current: { temp: c.temperature_2m, feels: c.apparent_temperature, hum: c.relative_humidity_2m, day: !!c.is_day, key: wmo(c.weather_code), pressure: c.pressure_msl, wind: c.wind_speed_10m, windDir: c.wind_direction_10m, vis: c.visibility, uv: c.uv_index }
  };
}

async function wxMet(lat, lon, signal) {
  const j = await getJSON(`https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=${lat.toFixed(4)}&lon=${lon.toFixed(4)}`, signal, 12000);
  const off = Math.round(lon / 15) * 3600000;            /* approximate local time from longitude */
  const loc = t => new Date(Date.parse(t) + off).toISOString().slice(0, 16);
  const ts = j.properties.timeseries;
  const sym = e => (e.data.next_1_hours || e.data.next_6_hours || e.data.next_12_hours)?.summary?.symbol_code || '';
  const first = ts[0], det = first.data.instant.details;
  const s0 = sym(first);
  const t = det.air_temperature, rh = det.relative_humidity, ws = det.wind_speed;
  const e = rh / 100 * 6.105 * Math.exp(17.27 * t / (237.7 + t));
  const feels = t + 0.33 * e - 0.70 * ws - 4.0;          /* Steadman apparent temperature */
  const nowStr = loc(first.time);
  const hourly = ts.filter(x => x.data.next_1_hours).slice(0, 24).map(x => {
    const s = sym(x);
    return { time: loc(x.time), temp: x.data.instant.details.air_temperature, key: metKey(s), day: s ? !s.endsWith('_night') : true, pop: null, mm: x.data.next_1_hours.details?.precipitation_amount || 0 };
  });
  const days = new Map();
  for (const x of ts) {
    const lt = loc(x.time), date = lt.slice(0, 10), hr = +lt.slice(11, 13);
    const dd = days.get(date) || { date, temps: [], keys: [], all: [], mm: 0, n: 0 };
    const tt = x.data.instant.details.air_temperature;
    if (tt != null) dd.temps.push(tt);
    const s = sym(x);
    if (s) { dd.all.push(metKey(s)); if (hr >= 8 && hr <= 20) dd.keys.push(metKey(s)); }
    const mm = (x.data.next_1_hours || x.data.next_6_hours)?.details?.precipitation_amount;
    if (mm) dd.mm += mm;
    dd.n++;
    days.set(date, dd);
  }
  const common = arr => { const m = {}; let best = 'cloudy', n = 0; for (const k of arr) { m[k] = (m[k] || 0) + 1; if (m[k] > n) { n = m[k]; best = k; } } return best; };
  const daily = [...days.values()].filter(d => d.n >= 2).slice(0, 7).map(d => ({
    date: d.date, max: Math.max(...d.temps), min: Math.min(...d.temps),
    key: common(d.keys.length ? d.keys : d.all), pop: null, mm: d.mm, sunrise: null, sunset: null, uv: null
  }));
  return {
    now: nowStr, hourly, daily,
    current: { temp: t, feels, hum: rh, day: s0 ? !s0.endsWith('_night') : true, key: metKey(s0), pressure: det.air_pressure_at_sea_level, wind: ws * 3.6, windDir: det.wind_from_direction, vis: null, uv: null }
  };
}

async function wxWttr(lat, lon, signal) {
  const j = await getJSON(`https://wttr.in/${lat.toFixed(3)},${lon.toFixed(3)}?format=j1`, signal, 14000);
  const t12 = s => { const m = /(\d+):(\d+)\s*(AM|PM)/i.exec(s || ''); if (!m) return null; let h = +m[1] % 12; if (/pm/i.test(m[3])) h += 12; return `${pad(h)}:${m[2]}`; };
  const cur = j.current_condition[0];
  const o = /(\d{4}-\d\d-\d\d)\s+(\d+:\d+\s*[AP]M)/i.exec(cur.localObsDateTime || '');
  const nowStr = o && t12(o[2]) ? `${o[1]}T${t12(o[2])}` : `${j.weather[0].date}T12:00`;
  const daily = j.weather.map(d => {
    const hrs = d.hourly || [];
    const noon = hrs[4] || hrs[Math.floor(hrs.length / 2)] || {};
    const sr = t12(d.astronomy?.[0]?.sunrise), ss = t12(d.astronomy?.[0]?.sunset);
    return {
      date: d.date, max: +d.maxtempC, min: +d.mintempC, key: wwo(noon.weatherCode),
      pop: Math.max(0, ...hrs.map(h => Math.max(+h.chanceofrain || 0, +h.chanceofsnow || 0))),
      sunrise: sr ? `${d.date}T${sr}` : null, sunset: ss ? `${d.date}T${ss}` : null, uv: +d.uvIndex || null
    };
  });
  const lower = new Date(Date.parse(nowStr + ':00Z') - 90 * 60000).toISOString().slice(0, 16);
  const hourly = [];
  for (const d of j.weather) {
    const sr = t12(d.astronomy?.[0]?.sunrise), ss = t12(d.astronomy?.[0]?.sunset);
    for (const h of d.hourly || []) {
      const time = `${d.date}T${pad(Math.floor(+h.time / 100))}:00`;
      if (time < lower) continue;
      const hh = time.slice(11, 16);
      hourly.push({ time, temp: +h.tempC, key: wwo(h.weatherCode), day: sr && ss ? hh >= sr && hh < ss : (+h.time >= 600 && +h.time < 2000), pop: Math.max(+h.chanceofrain || 0, +h.chanceofsnow || 0) });
    }
  }
  const today = daily[0];
  const isDay = today.sunrise && today.sunset ? (mins(nowStr) >= mins(today.sunrise) && mins(nowStr) < mins(today.sunset)) : true;
  return {
    now: nowStr, hourly: hourly.slice(0, 16), daily,
    current: { temp: +cur.temp_C, feels: +cur.FeelsLikeC, hum: +cur.humidity, day: isDay, key: wwo(cur.weatherCode), pressure: +cur.pressure, wind: +cur.windspeedKmph, windDir: +cur.winddirDegree, vis: (+cur.visibility || 0) * 1000, uv: +cur.uvIndex }
  };
}

const PROVIDERS = {
  openmeteo: { label: 'Open-Meteo', fn: wxOpenMeteo },
  met: { label: 'MET Norway', fn: wxMet },
  wttr: { label: 'wttr.in', fn: wxWttr }
};
if (!PROVIDERS[state.provider]) state.provider = 'openmeteo';

async function fetchAir(lat, lon) {
  const j = await getJSON(`https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${lat}&longitude=${lon}&current=european_aqi,pm2_5`, null, 8000);
  return { aqi: j.current?.european_aqi ?? null, pm25: j.current?.pm2_5 ?? null };
}

/* ------------------------------------------------------------- moon + labels */
function moonPhase(date = new Date()) {
  const syn = 29.530588853;
  const jd = date.getTime() / 86400000 + 2440587.5;
  let ph = ((jd - 2451550.1) / syn) % 1;
  if (ph < 0) ph += 1;
  const names = ['New moon', 'Waxing crescent', 'First quarter', 'Waxing gibbous', 'Full moon', 'Waning gibbous', 'Last quarter', 'Waning crescent'];
  return { name: names[Math.round(ph * 8) % 8], illum: (1 - Math.cos(2 * Math.PI * ph)) / 2 };
}
const uvLabel = u => u == null ? '' : u < 3 ? 'Low' : u < 6 ? 'Moderate' : u < 8 ? 'High' : u < 11 ? 'Very high' : 'Extreme';
const aqiLabel = a => a == null ? '' : a <= 20 ? 'Good' : a <= 40 ? 'Fair' : a <= 60 ? 'Moderate' : a <= 80 ? 'Poor' : a <= 100 ? 'Very poor' : 'Extremely poor';

/* ------------------------------------------------------------------- render */
const el = { hero: $('#hero'), prov: $('#providers'), hourly: $('#hourly'), daily: $('#daily'), details: $('#details'), sun: $('#sun'), sunBody: $('#sun-body') };

function placeSub(p) { return [p.admin, p.country].filter(Boolean).join(', '); }

function buildFx(host, key, day) {
  host.textContent = '';
  const add = (cls, n, fn) => {
    for (let i = 0; i < n; i++) {
      const d = document.createElement('i');
      d.className = cls;
      fn(d);
      host.appendChild(d);
    }
  };
  const rnd = (a, b) => a + Math.random() * (b - a);
  if (key === 'rain' || key === 'thunder' || key === 'drizzle' || key === 'sleet') {
    const n = key === 'drizzle' ? 22 : 46;
    add('drop', n, d => { d.style.left = rnd(0, 100) + '%'; d.style.animationDuration = rnd(.7, 1.3) + 's'; d.style.animationDelay = -rnd(0, 1.5) + 's'; if (key === 'drizzle') d.style.height = '10px'; });
  }
  if (key === 'snow' || key === 'sleet') {
    add('flake', 34, d => { const s = rnd(2, 5); d.style.width = d.style.height = s + 'px'; d.style.left = rnd(0, 100) + '%'; d.style.animationDuration = rnd(4, 8) + 's'; d.style.animationDelay = -rnd(0, 8) + 's'; });
  }
  if (!day && (key === 'clear' || key === 'partly')) {
    add('star', 40, d => { d.style.left = rnd(0, 100) + '%'; d.style.top = rnd(0, 70) + '%'; d.style.animationDelay = -rnd(0, 3) + 's'; });
  }
}

function render() {
  const d = state.data, c = d.current, p = state.place;
  const day = c.day, key = c.key;
  const today = d.daily[0];
  document.title = `Weather in ${p.name} – Sky`;

  const sky = (SKY[day ? 'day' : 'night'][key]) || SKY.day.cloudy;
  el.hero.classList.remove('loading');
  el.hero.style.setProperty('--sky-a', sky[0]);
  el.hero.style.setProperty('--sky-b', sky[1]);
  el.hero.innerHTML = `
    <div class="fx" aria-hidden="true"></div>
    <div class="hero-body">
      <div class="hero-loc"><h2>${esc(p.name)}</h2><p>${esc(placeSub(p))}</p></div>
      <div class="hero-main">
        <div>
          <div class="hero-temp"><span class="big">${esc(String(Math.round(imp() ? c.temp * 9 / 5 + 32 : c.temp)))}</span><span class="deg">°</span></div>
          <div class="hero-cond">${esc(label(key, day))}</div>
        </div>
        <div class="hero-ico">${icon(key, day, 150)}</div>
      </div>
      <div class="hero-meta">
        <span>Feels like ${T(c.feels)}</span>
        <span>High ${T(today.max)} · Low ${T(today.min)}</span>
        <span>${esc(speed(c.wind))} ${esc(compass(c.windDir))}</span>
      </div>
      ${d.failed.length ? `<p class="hero-note">${esc(d.failed.map(k => PROVIDERS[k].label).join(', '))} did not respond — showing ${esc(PROVIDERS[d.used].label)} instead.</p>` : ''}
    </div>`;
  buildFx($('.fx', el.hero), key, day);

  /* provider chips */
  el.prov.innerHTML = '<span>Data from</span>' + Object.entries(PROVIDERS).map(([k, v]) =>
    `<button class="chip" type="button" data-p="${k}" aria-pressed="${k === d.used}">${esc(v.label)}</button>`).join('');

  /* hourly */
  el.hourly.innerHTML = d.hourly.map((h, i) => {
    const pop = h.pop != null ? (h.pop >= 10 ? h.pop + '%' : '') : (h.mm > 0 ? (imp() ? (h.mm / 25.4).toFixed(2) + ' in' : h.mm.toFixed(1) + ' mm') : '');
    return `<li class="hr"><span class="hr-t">${i === 0 ? 'Now' : esc(fmtHour(h.time))}</span>${icon(h.key, h.day, 36)}<b>${T(h.temp)}</b><span class="hr-p">${esc(pop)}</span></li>`;
  }).join('');

  /* daily */
  const gmin = Math.min(...d.daily.map(x => x.min)), gmax = Math.max(...d.daily.map(x => x.max));
  const span = Math.max(1, gmax - gmin);
  el.daily.innerHTML = d.daily.map((x, i) => {
    const left = ((x.min - gmin) / span * 100).toFixed(1), width = Math.max(6, (x.max - x.min) / span * 100).toFixed(1);
    const pop = x.pop != null ? (x.pop >= 10 ? x.pop + '%' : '') : (x.mm > 0.2 ? (imp() ? (x.mm / 25.4).toFixed(1) + ' in' : Math.round(x.mm) + ' mm') : '');
    return `<li><span class="d-day">${esc(fmtDay(x.date, i))}</span>${icon(x.key, true, 32)}<span class="d-pop">${esc(pop)}</span><span class="bar"><i style="left:${left}%;width:${width}%"></i></span><span class="d-hi">${T(x.max)}</span></li>`;
  }).join('');
  /* low temperature shown next to the bar via title for a clean grid */
  [...el.daily.children].forEach((li, i) => { li.querySelector('.bar').title = `Low ${T(d.daily[i].min)} · High ${T(d.daily[i].max)}`; });

  renderDetails();
  renderSun();
}

function renderDetails() {
  const d = state.data, c = d.current;
  const uv = c.uv ?? d.daily[0].uv;
  const moon = moonPhase();
  const arrow = c.windDir == null ? '' : `<svg class="arrow" viewBox="0 0 24 24" style="transform:rotate(${(c.windDir + 180) % 360}deg)" aria-hidden="true"><path d="M12 3l6 16-6-4-6 4z" fill="currentColor"/></svg>`;
  const tiles = [
    ['Feels like', T(c.feels), c.feels != null && c.temp != null ? (Math.abs(c.feels - c.temp) < 1.5 ? 'Close to the actual temperature' : c.feels < c.temp ? 'Colder than the air temperature' : 'Warmer than the air temperature') : ''],
    ['Wind', arrow + esc(speed(c.wind)), c.windDir != null ? `From ${compass(c.windDir)} (${Math.round(c.windDir)}°)` : ''],
    ['Humidity', c.hum != null ? Math.round(c.hum) + '%' : '–', ''],
    ['Pressure', esc(pres(c.pressure)), ''],
    ['UV index', uv != null ? String(Math.round(uv * 10) / 10) : '–', uvLabel(uv)],
    ['Visibility', esc(dist(c.vis)), ''],
    ['Air quality', state.air && state.air.aqi != null ? String(Math.round(state.air.aqi)) : '–', state.air && state.air.aqi != null ? `${aqiLabel(state.air.aqi)} · PM2.5 ${state.air.pm25 != null ? Math.round(state.air.pm25) : '–'} µg/m³` : 'European AQI'],
    ['Moon', esc(moon.name), Math.round(moon.illum * 100) + '% illuminated']
  ].filter(t => !(t[1] === '–' && !t[2] && ['UV index', 'Visibility'].includes(t[0])));
  el.details.innerHTML = tiles.map(([l, v, s]) => `<div class="tile"><span class="t-label">${esc(l)}</span><span class="t-val">${v}</span><span class="t-sub">${esc(s)}</span></div>`).join('');
}

function renderSun() {
  const d = state.data, t = d.daily[0];
  if (!t.sunrise || !t.sunset) { el.sun.hidden = true; return; }
  el.sun.hidden = false;
  const sr = mins(t.sunrise), ss = mins(t.sunset), now = mins(d.now);
  const f = (now - sr) / (ss - sr);
  const up = f >= 0 && f <= 1;
  const x = 150 - 130 * Math.cos(Math.PI * Math.min(1, Math.max(0, f)));
  const y = 100 - 80 * Math.sin(Math.PI * Math.min(1, Math.max(0, f)));
  const len = ss - sr, hh = Math.floor(len / 60), mm = len % 60;
  el.sunBody.innerHTML = `
    <svg class="sun-svg" viewBox="0 0 300 116" role="img" aria-label="Sun position today">
      <line x1="8" y1="100" x2="292" y2="100" style="stroke:var(--line)" stroke-width="2"/>
      <path d="M20 100A130 80 0 0 1 280 100" fill="none" style="stroke:var(--line)" stroke-width="3" stroke-dasharray="2 6" stroke-linecap="round"/>
      ${up ? `<path d="M20 100A130 80 0 0 1 280 100" fill="none" style="stroke:var(--sun)" stroke-width="3" stroke-linecap="round" pathLength="1" stroke-dasharray="${f.toFixed(3)} 1"/>
      <circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="8" style="fill:var(--sun)"/>` : ''}
    </svg>
    <div class="sun-row"><span><b>${esc(fmtTime(t.sunrise))}</b>Sunrise</span><span style="text-align:center"><b>${hh} h ${mm} min</b>${up ? 'Daylight today' : 'Sun is down'}</span><span style="text-align:right"><b>${esc(fmtTime(t.sunset))}</b>Sunset</span></div>`;
}

function showError(msg) {
  el.hero.classList.remove('loading');
  el.hero.style.setProperty('--sky-a', '#4b5b70');
  el.hero.style.setProperty('--sky-b', '#76879b');
  el.hero.innerHTML = `<div class="hero-body err"><h2>Could not load the forecast</h2><p>${esc(msg)}</p></div>`;
  el.prov.innerHTML = '<span>Try another source:</span>' + Object.entries(PROVIDERS).map(([k, v]) => `<button class="chip" type="button" data-p="${k}" aria-pressed="false">${esc(v.label)}</button>`).join('');
}

/* ------------------------------------------------------------------- loading */
async function loadWeather() {
  const id = ++state.loadId;
  const { lat, lon } = state.place;
  el.hero.classList.add('loading');
  if (!state.data) el.hero.innerHTML = '<p class="loading-msg">Loading forecast…</p>';
  const order = [state.provider, ...Object.keys(PROVIDERS).filter(k => k !== state.provider)];
  const failed = [];
  let data = null, used = null;
  for (const k of order) {
    try { data = await PROVIDERS[k].fn(lat, lon); used = k; break; }
    catch { failed.push(k); if (id !== state.loadId) return; }
  }
  if (id !== state.loadId) return;
  if (!data) { showError('All weather sources failed. Check your connection and try again.'); return; }
  data.used = used; data.failed = failed;
  state.data = data; state.air = null;
  render();
  fetchAir(lat, lon).then(a => { if (id === state.loadId) { state.air = a; renderDetails(); } }).catch(() => {});
}

function setPlace(p, { push = true } = {}) {
  state.place = { name: p.name, admin: p.admin || '', country: p.country || '', lat: +p.lat, lon: +p.lon };
  store.set('place', state.place);
  if (push) {
    const u = new URL(location.href);
    u.search = '';
    u.searchParams.set('lat', state.place.lat.toFixed(3));
    u.searchParams.set('lon', state.place.lon.toFixed(3));
    u.searchParams.set('name', state.place.name);
    try { history.replaceState(null, '', u); } catch { /* sandboxed */ }
  }
  state.data = null;
  loadWeather();
}

/* -------------------------------------------------------------------- search */
const input = $('#q'), list = $('#results'), form = $('#search');
let sTimer = 0, sCtl = null, results = [], active = -1, lastQ = '';

async function runSearch(q) {
  sCtl?.abort();
  const ctl = sCtl = new AbortController();
  lastQ = q;
  list.hidden = false;
  list.innerHTML = '<li class="res-msg">Searching…</li>';
  const ids = state.geocoders;
  const settled = await Promise.allSettled(ids.map(id => GEOCODERS[id].search(q, ctl.signal)));
  if (ctl !== sCtl) return null;                          /* a newer search replaced this one */
  const lists = settled.map(s => s.status === 'fulfilled' ? s.value : []);
  const ok = ids.filter((_, i) => settled[i].status === 'fulfilled');
  results = mergeResults(lists);
  active = -1;
  if (!results.length) {
    list.innerHTML = `<li class="res-msg">${ok.length ? 'No places found.' : 'None of the selected sources answered.'}</li>`;
    return results;
  }
  list.innerHTML = results.map((r, i) => `
    <li role="option" id="res-${i}" data-i="${i}" aria-selected="false">
      <span class="r-name">${esc(r.name)}</span>
      <span class="r-sub">${esc(placeSub(r)) || esc(r.lat.toFixed(2) + ', ' + r.lon.toFixed(2))}</span>
      <span class="r-src">${r.srcs.map(s => `<span class="badge">${esc(GEOCODERS[s].label)}</span>`).join('')}</span>
    </li>`).join('') + `<li class="res-foot">Asked ${esc(ids.map(i => GEOCODERS[i].label).join(', '))}${ok.length < ids.length ? ' · some did not answer' : ''}</li>`;
  return results;
}

function highlight(i) {
  const items = [...list.querySelectorAll('[role="option"]')];
  items.forEach((n, k) => n.setAttribute('aria-selected', String(k === i)));
  active = i;
  if (items[i]) { items[i].scrollIntoView({ block: 'nearest' }); input.setAttribute('aria-activedescendant', items[i].id); }
}
function closeResults() { list.hidden = true; active = -1; input.removeAttribute('aria-activedescendant'); }
function pick(r) { closeResults(); input.value = ''; input.blur(); setPlace(r); }

input.addEventListener('input', () => {
  clearTimeout(sTimer);
  const q = input.value.trim();
  if (q.length < 2) { sCtl?.abort(); closeResults(); return; }
  sTimer = setTimeout(() => runSearch(q), 380);
});
input.addEventListener('keydown', e => {
  const n = results.length;
  if (list.hidden || !n) return;
  if (e.key === 'ArrowDown') { e.preventDefault(); highlight((active + 1) % n); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); highlight((active - 1 + n) % n); }
  else if (e.key === 'Escape') closeResults();
});
form.addEventListener('submit', async e => {
  e.preventDefault();
  const q = input.value.trim();
  if (!q) return;
  clearTimeout(sTimer);
  if (active >= 0 && results[active]) return pick(results[active]);
  const r = (results.length && lastQ === q && !list.hidden) ? results : await runSearch(q);
  if (r && r[0]) pick(r[0]);
});
document.addEventListener('click', e => {
  if (!form.contains(e.target)) closeResults();
  const src = $('#sources');
  if (src.open && !src.contains(e.target)) src.open = false;
});
list.addEventListener('click', e => {
  const li = e.target.closest('[data-i]');
  if (li) pick(results[+li.dataset.i]);
});

/* search-source picker */
function buildSources() {
  $('#src-list').innerHTML = GEO_IDS.map(id => `
    <label class="src-row"><input type="checkbox" value="${id}" ${state.geocoders.includes(id) ? 'checked' : ''}>
    <span>${esc(GEOCODERS[id].label)}<small>${esc(GEOCODERS[id].note)}</small></span></label>`).join('');
}
$('#src-list').addEventListener('change', e => {
  const boxes = [...$('#src-list').querySelectorAll('input')];
  let sel = boxes.filter(b => b.checked).map(b => b.value);
  if (!sel.length) { e.target.checked = true; sel = [e.target.value]; }   /* keep at least one source */
  state.geocoders = sel;
  store.set('geocoders', sel);
  const q = input.value.trim();
  if (q.length >= 2) runSearch(q);
});

/* -------------------------------------------------------- other controls */
$('#providers').addEventListener('click', e => {
  const b = e.target.closest('[data-p]');
  if (!b || !state.place) return;
  state.provider = b.dataset.p;
  store.set('provider', state.provider);
  loadWeather();
});

function syncUnits() { $('#units').textContent = imp() ? '°F' : '°C'; }
$('#units').addEventListener('click', () => {
  state.units = imp() ? 'metric' : 'imperial';
  store.set('units', state.units);
  syncUnits();
  if (state.data) render();
});

async function reverse(lat, lon) {
  try {
    const j = await getJSON(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=10&lat=${lat}&lon=${lon}&accept-language=${encodeURIComponent(lang)}`);
    const a = j.address || {};
    return { name: a.city || a.town || a.village || a.municipality || j.name || 'Your location', admin: a.state || '', country: a.country || '' };
  } catch { return { name: 'Your location', admin: '', country: '' }; }
}
function locate() {
  if (!navigator.geolocation) return;
  navigator.geolocation.getCurrentPosition(async pos => {
    const { latitude: lat, longitude: lon } = pos.coords;
    setPlace({ ...(await reverse(lat, lon)), lat, lon });
  }, () => { /* denied: keep current place */ }, { timeout: 10000, maximumAge: 600000 });
}
$('#locate').addEventListener('click', locate);

/* ---------------------------------------------------------------------- init */
async function init() {
  applyTheme(state.theme, false);
  syncUnits();
  buildSources();

  const q = new URLSearchParams(location.search);
  const lat = parseFloat(q.get('lat')), lon = parseFloat(q.get('lon'));
  if (isFinite(lat) && isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180) {
    setPlace({ name: (q.get('name') || 'Selected place').slice(0, 80), lat, lon }, { push: false });
  } else if (q.get('q')) {
    const r = await runSearch(q.get('q').slice(0, 100));
    closeResults();
    if (r && r[0]) { setPlace(r[0]); return; }
  }
  if (!state.place) {
    const saved = store.get('place', null);
    if (saved && isFinite(saved.lat) && isFinite(saved.lon)) setPlace(saved, { push: false });
    else setPlace({ name: 'London', admin: 'England', country: 'United Kingdom', lat: 51.5072, lon: -0.1276 }, { push: false });
  }
  /* only use the device position silently if the user already granted it */
  try {
    const perm = await navigator.permissions?.query({ name: 'geolocation' });
    if (perm && perm.state === 'granted' && !q.get('lat') && !q.get('q')) locate();
  } catch { /* permissions API unavailable */ }

  setInterval(() => { if (state.place && !document.hidden) loadWeather(); }, 15 * 60 * 1000);
}
init();
})();
