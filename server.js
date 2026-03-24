require('dotenv').config();
const express = require('express');
const axios   = require('axios');
const cors    = require('cors');
const path    = require('path');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const REST_KEY = process.env.KAKAO_REST_KEY;
const kakaoHeaders = { Authorization: `KakaoAK ${REST_KEY}` };

/* ── 주소 검색 (키워드) ─────────────────────────────────── */
app.get('/api/search/keyword', async (req, res) => {
  try {
    const { query, x, y, radius = 20000 } = req.query;
    const params = { query, size: 7 };
    if (x && y) { params.x = x; params.y = y; params.radius = radius; params.sort = 'distance'; }
    const r = await axios.get('https://dapi.kakao.com/v2/local/search/keyword.json', { params, headers: kakaoHeaders });
    res.json(r.data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* ── 주소 검색 (주소 자동완성) ──────────────────────────── */
app.get('/api/search/address', async (req, res) => {
  try {
    const { query } = req.query;
    const r = await axios.get('https://dapi.kakao.com/v2/local/search/address.json', { params: { query, size: 5 }, headers: kakaoHeaders });
    res.json(r.data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* ── 좌표 → 행정구역명 ──────────────────────────────────── */
app.get('/api/geo/coord2region', async (req, res) => {
  try {
    const { x, y } = req.query;
    const r = await axios.get('https://dapi.kakao.com/v2/local/geo/coord2regioncode.json', { params: { x, y }, headers: kakaoHeaders });
    res.json(r.data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* ── 좌표 → 도로명 주소 ─────────────────────────────────── */
app.get('/api/geo/coord2address', async (req, res) => {
  try {
    const { x, y } = req.query;
    const r = await axios.get('https://dapi.kakao.com/v2/local/geo/coord2address.json', { params: { x, y }, headers: kakaoHeaders });
    res.json(r.data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* ── 카테고리 장소 검색 ─────────────────────────────────── */
// category_group_code: FD6=음식점, CE7=카페, AT4=관광명소, CT1=문화시설, SW8=지하철역
app.get('/api/search/category', async (req, res) => {
  try {
    const { category_group_code, x, y, radius = 3000 } = req.query;
    const r = await axios.get('https://dapi.kakao.com/v2/local/search/category.json', {
      params: { category_group_code, x, y, radius, size: 5, sort: 'distance' },
      headers: kakaoHeaders,
    });
    res.json(r.data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* ── 중간 지점 계산 ─────────────────────────────────────── */
app.post('/api/midpoint', (req, res) => {
  const { locations } = req.body;
  if (!locations || locations.length < 2) return res.status(400).json({ error: '최소 2개 위치' });

  // 1) 단순 좌표 평균
  const simpleLat = locations.reduce((s, l) => s + l.lat, 0) / locations.length;
  const simpleLng = locations.reduce((s, l) => s + l.lng, 0) / locations.length;

  // 2) 이동시간 기반 — 최대 이동시간 최소화 (minimax)
  const candidates = buildGrid(locations, 25);
  let best = candidates[0], minScore = Infinity;
  for (const c of candidates) {
    const times = locations.map(l => haverKm(l.lat, l.lng, c.lat, c.lng));
    const maxT   = Math.max(...times);
    const sdT    = sd(times);
    const score  = maxT * 0.7 + sdT * 0.3;
    if (score < minScore) { minScore = score; best = c; }
  }

  res.json({
    simple:    { lat: simpleLat, lng: simpleLng, type: 'simple' },
    timeBased: { lat: best.lat,  lng: best.lng,  type: 'timeBased' },
  });
});

/* ── 유틸 ─────────────────────────────────────────────── */
function haverKm(la1, lo1, la2, lo2) {
  const R = 6371, d2r = Math.PI / 180;
  const dLa = (la2 - la1) * d2r, dLo = (lo2 - lo1) * d2r;
  const a = Math.sin(dLa/2)**2 + Math.cos(la1*d2r)*Math.cos(la2*d2r)*Math.sin(dLo/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}
function sd(arr) {
  const m = arr.reduce((a,b) => a+b, 0) / arr.length;
  return Math.sqrt(arr.reduce((s,v) => s+(v-m)**2, 0) / arr.length);
}
function buildGrid(locs, steps) {
  const lats = locs.map(l => l.lat), lngs = locs.map(l => l.lng);
  const [minLa, maxLa] = [Math.min(...lats), Math.max(...lats)];
  const [minLo, maxLo] = [Math.min(...lngs), Math.max(...lngs)];
  const pts = [];
  for (let i = 0; i <= steps; i++)
    for (let j = 0; j <= steps; j++)
      pts.push({ lat: minLa + (maxLa-minLa)*i/steps, lng: minLo + (maxLo-minLo)*j/steps });
  return pts;
}

/* ── JS 키 주입 엔드포인트 ──────────────────────────────── */
// 프론트가 JS 키를 직접 노출하지 않도록 서버에서 내려줌
app.get('/api/config', (_, res) => {
  res.json({ jsKey: process.env.KAKAO_JS_KEY });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅  http://localhost:${PORT}`);
  if (!REST_KEY || REST_KEY.includes('여기에')) console.warn('⚠️  .env 파일에 KAKAO_REST_KEY를 설정하세요!');
});
