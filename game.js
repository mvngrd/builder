// ============================================================
// КОНФИГ
// ============================================================
const COLLECT_RADIUS_M = 28;
const MIN_MOVE_M = 5;
const GRID_SIZE_DEG = 30 / 111320;
const SPAWN_VIEW_RADIUS_M = 300;
const SEED_RESET_MS = 60 * 60 * 1000;

const RESOURCE_TYPES = [
  { key: 'wood',  icon: '🪵', weight: 40, name: 'Дерево' },
  { key: 'metal', icon: '⚙️', weight: 30, name: 'Металл' },
  { key: 'chip',  icon: '🔌', weight: 20, name: 'Микросхема' },
  { key: 'fuel',  icon: '⛽', weight: 10, name: 'Топливо' },
];

const BUILDINGS = [
  { id: 'shelter',   name: '🏕️ Укрытие',   maxLevel: 5, cost: (lvl) => ({ wood: 10 * lvl, metal: 5 * lvl }) },
  { id: 'workshop',  name: '🔧 Мастерская', maxLevel: 5, cost: (lvl) => ({ wood: 15 * lvl, metal: 20 * lvl, chip: 2 * lvl }) },
  { id: 'generator', name: '⚡ Генератор',  maxLevel: 5, cost: (lvl) => ({ metal: 25 * lvl, fuel: 5 * lvl }) },
];

// ============================================================
// СОСТОЯНИЕ
// ============================================================
const state = {
  playerPos: null,
  totalDistance: 0,
  inventory: { wood: 0, metal: 0, chip: 0, fuel: 0 },
  buildings: {},
  score: 0,
  seed: 0,
};

function loadState() {
  try {
    const raw = localStorage.getItem('base-builder-save');
    if (raw) {
      const saved = JSON.parse(raw);
      Object.assign(state.inventory, saved.inventory || {});
      Object.assign(state.buildings, saved.buildings || {});
      state.totalDistance = saved.totalDistance || 0;
      state.score = saved.score || 0;
    }
  } catch (e) { console.warn('Save load failed', e); }
  for (const b of BUILDINGS) {
    if (state.buildings[b.id] === undefined) state.buildings[b.id] = 0;
  }

  // Seed для генерации мира — стабилен в течение часа
  try {
    const savedSeed = localStorage.getItem('base-builder-seed');
    if (savedSeed) {
      const { value, born } = JSON.parse(savedSeed);
      if (Date.now() - born < SEED_RESET_MS) {
        state.seed = value;
        return;
      }
    }
  } catch (e) {}
  state.seed = Math.floor(Math.random() * 1000000);
  localStorage.setItem('base-builder-seed', JSON.stringify({
    value: state.seed, born: Date.now()
  }));
}

function saveState() {
  localStorage.setItem('base-builder-save', JSON.stringify({
    inventory: state.inventory,
    buildings: state.buildings,
    totalDistance: Math.round(state.totalDistance),
    score: state.score,
  }));
}

// ============================================================
// КАРТА (MapLibre)
// ============================================================
const map = new maplibregl.Map({
  container: 'map',
  style: 'https://tiles.openfreemap.org/styles/liberty',
  center: [37.61, 55.75],
  zoom: 16,
  attributionControl: false
});

const markers = { player: null, base: null };

// ============================================================
// УТИЛИТЫ
// ============================================================
function distanceM(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const toRad = d => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 +
            Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function hashCoord(lat, lng, seed) {
  const s = Math.sin(lat * 12.9898 + lng * 78.233 + seed * 37.719 + state.seed * 1234.5678) * 43758.5453;
  return s - Math.floor(s);
}

function gridPointsAround(lat, lng) {
  const points = [];
  const latGrid = Math.floor(lat / GRID_SIZE_DEG);
  const lngGrid = Math.floor(lng / GRID_SIZE_DEG);
  // 5x5 ячеек вокруг игрока (запас на движение)
  for (let dy = -2; dy <= 2; dy++) {
    for (let dx = -2; dx <= 2; dx++) {
      const cellLat = latGrid + dy;
      const cellLng = lngGrid + dx;
      if (hashCoord(cellLat, cellLng, 1) > 0.5) {
        const offsetLat = (hashCoord(cellLat, cellLng, 2) - 0.5) * GRID_SIZE_DEG * 0.8;
        const offsetLng = (hashCoord(cellLat, cellLng, 3) - 0.5) * GRID_SIZE_DEG * 0.8;
        const pLat = cellLat * GRID_SIZE_DEG + offsetLat;
        const pLng = cellLng * GRID_SIZE_DEG + offsetLng;
        const roll = hashCoord(cellLat, cellLng, 4) * 100;
        let acc = 0;
        let type = RESOURCE_TYPES[0];
        for (const t of RESOURCE_TYPES) {
          acc += t.weight;
          if (roll < acc) { type = t; break; }
        }
        points.push({ lat: pLat, lng: pLng, type });
      }
    }
  }
  return points;
}

function emojiEl(emoji, size = 30) {
  const el = document.createElement('div');
  el.style.fontSize = (size - 6) + 'px';
  el.style.lineHeight = size + 'px';
  el.style.textAlign = 'center';
  el.style.width = size + 'px';
  el.style.height = size + 'px';
  el.style.filter = 'drop-shadow(0 0 4px #fff)';
  el.textContent = emoji;
  return el;
}

// ============================================================
// ИГРОК
// ============================================================
function updatePlayer(lat, lng) {
  if (state.playerPos) {
    const d = distanceM(state.playerPos.lat, state.playerPos.lng, lat, lng);
    if (d > MIN_MOVE_M) {
      state.totalDistance += d;
      document.getElementById('distance').textContent = Math.round(state.totalDistance);
    }
  }
  state.playerPos = { lat, lng };

  if (!markers.player) {
    const el = document.createElement('div');
    el.style.width = '18px';
    el.style.height = '18px';
    el.style.borderRadius = '50%';
    el.style.background = '#3b82f6';
    el.style.border = '3px solid #fff';
    el.style.boxShadow = '0 0 6px rgba(0,0,0,0.4)';

    markers.player = new maplibregl.Marker({ element: el })
      .setLngLat([lng, lat])
      .addTo(map);

    map.setCenter([lng, lat]);
    map.setZoom(17);

    if (!markers.base) {
      markers.base = new maplibregl.Marker({ element: emojiEl('🏠') })
        .setLngLat([lng, lat])
        .addTo(map);
    }

    map.on('load', () => {
      map.addSource('player-circle', {
        type: 'geojson',
        data: { type: 'Feature', geometry: { type: 'Point', coordinates: [lng, lat] }, properties: {} }
      });
      map.addLayer({
        id: 'player-circle-layer',
        type: 'circle',
        source: 'player-circle',
        paint: {
          'circle-color': '#3b82f6',
          'circle-opacity': 0.12,
          'circle-stroke-color': '#3b82f6',
          'circle-stroke-width': 1,
          map.on('load', () => {
  map.addSource('player-circle', {
    type: 'geojson',
    data: { type: 'Feature', geometry: { type: 'Point', coordinates: [lng, lat] }, properties: {} }
  });
  map.addLayer({
    id: 'player-circle-layer',
    type: 'circle',
    source: 'player-circle',
    paint: {
      'circle-color': '#3b82f6',
      'circle-opacity': 0.12,
      'circle-stroke-color': '#3b82f6',
      'circle-stroke-width': 1,
      'circle-radius': 10  // значение переопределяется ниже
    }
  });

  // Точный пересчёт метров в пиксели
  function updateCircleRadius() {
    const zoom = map.getZoom();
    const center = map.getCenter();
    const metersPerPixel =
      156543.03392 * Math.cos(center.lat * Math.PI / 180) / Math.pow(2, zoom);
    const radiusPx = COLLECT_RADIUS_M / metersPerPixel;
    if (map.getLayer('player-circle-layer')) {
      map.setPaintProperty('player-circle-layer', 'circle-radius', radiusPx);
    }
  }

  updateCircleRadius();
  map.on('zoom', updateCircleRadius);
  map.on('move', updateCircleRadius);
});
        }
      });
    });
  } else {
    markers.player.setLngLat([lng, lat]);
    const src = map.getSource('player-circle');
    if (src) {
      src.setData({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [lng, lat] },
        properties: {}
      });
    }
  }

  spawnFromGrid();
}

// ============================================================
// РЕСУРСЫ (постоянный мир, без респавна)
// ============================================================
const resources = [];
const resourceMap = new Map();
let collectedSet = new Set();

function loadCollected() {
  try {
    const raw = localStorage.getItem('base-builder-collected');
    if (raw) collectedSet = new Set(JSON.parse(raw));
  } catch (e) {}
}

function saveCollected() {
  localStorage.setItem('base-builder-collected', JSON.stringify([...collectedSet]));
}

function spawnFromGrid() {
  if (!state.playerPos) return;
  const points = gridPointsAround(state.playerPos.lat, state.playerPos.lng);

  for (const p of points) {
    const id = p.lat.toFixed(6) + ',' + p.lng.toFixed(6);
    if (resourceMap.has(id)) continue;
    if (collectedSet.has(id)) continue;

    const marker = new maplibregl.Marker({ element: emojiEl(p.type.icon) })
      .setLngLat([p.lng, p.lat])
      .addTo(map);

    const res = { id, lat: p.lat, lng: p.lng, marker, type: p.type };
    marker.getElement().addEventListener('click', () => tryCollect(res));
    resources.push(res);
    resourceMap.set(id, res);
  }

  // Убираем далёкие маркеры, чтобы не забивать карту
  for (let i = resources.length - 1; i >= 0; i--) {
    const r = resources[i];
    const d = distanceM(state.playerPos.lat, state.playerPos.lng, r.lat, r.lng);
    if (d > SPAWN_VIEW_RADIUS_M) {
      r.marker.remove();
      resourceMap.delete(r.id);
      resources.splice(i, 1);
    }
  }
}

// ============================================================
// СБОР РЕСУРСА
// ============================================================
function tryCollect(r) {
  if (!state.playerPos) return;
  if (collectedSet.has(r.id)) return;
  const d = distanceM(state.playerPos.lat, state.playerPos.lng, r.lat, r.lng);
  if (d >= COLLECT_RADIUS_M) {
    setStatus('Слишком далеко: ' + Math.round(d) + ' м');
    return;
  }
  collectedSet.add(r.id);
  saveCollected();
  r.marker.remove();
  resourceMap.delete(r.id);
  const idx = resources.indexOf(r);
  if (idx >= 0) resources.splice(idx, 1);

  state.inventory[r.type.key] += 1;
  state.score += 1;
  renderHUD();
  saveState();
  setStatus('+1 ' + r.type.name);
}

// ============================================================
// БАЗА
// ============================================================
const baseModal = document.getElementById('baseModal');
const buildingsEl = document.getElementById('buildings');

document.getElementById('baseBtn').addEventListener('click', () => {
  renderBuildings();
  baseModal.classList.remove('hidden');
});
document.getElementById('closeBase').addEventListener('click', () => {
  baseModal.classList.add('hidden');
});

function canAfford(cost) {
  for (const k in cost) {
    if ((state.inventory[k] || 0) < cost[k]) return false;
  }
  return true;
}

function pay(cost) {
  for (const k in cost) state.inventory[k] -= cost[k];
}

function renderBuildings() {
  buildingsEl.innerHTML = '';
  for (const b of BUILDINGS) {
    const lvl = state.buildings[b.id];
    const isMax = lvl >= b.maxLevel;
    const cost = isMax ? null : b.cost(lvl + 1);
    const afford = cost ? canAfford(cost) : false;

    const div = document.createElement('div');
    div.className = 'building';
    let costText = 'Максимальный уровень';
    if (cost) {
      costText = 'Нужно: ' + Object.keys(cost).map(k => {
        const t = RESOURCE_TYPES.find(r => r.key === k);
        return t.icon + cost[k];
      }).join(' ');
    }
    div.innerHTML =
      '<h3>' + b.name + '</h3>' +
      '<div class="lvl">Уровень ' + lvl + ' / ' + b.maxLevel + '</div>' +
      '<div class="cost">' + costText + '</div>' +
      '<button ' + (isMax || !afford ? 'disabled' : '') + ' data-id="' + b.id + '">' +
      (isMax ? 'МАКС' : 'Улучшить') + '</button>';
    buildingsEl.appendChild(div);
  }

  const btns = buildingsEl.querySelectorAll('button[data-id]');
  for (const btn of btns) {
    btn.addEventListener('click', () => {
      const id = btn.dataset.id;
      const b = BUILDINGS.find(x => x.id === id);
      const lvl = state.buildings[id];
      if (lvl >= b.maxLevel) return;
      const cost = b.cost(lvl + 1);
      if (!canAfford(cost)) return;
      pay(cost);
      state.buildings[id] = lvl + 1;
      saveState();
      renderHUD();
      renderBuildings();
    });
  }
}

// ============================================================
// HUD
// ============================================================
function renderHUD() {
  document.getElementById('score').textContent = state.score;
  document.getElementById('distance').textContent = Math.round(state.totalDistance);
  document.getElementById('inv-wood').textContent = state.inventory.wood;
  document.getElementById('inv-metal').textContent = state.inventory.metal;
  document.getElementById('inv-chip').textContent = state.inventory.chip;
  document.getElementById('inv-fuel').textContent = state.inventory.fuel;
}

function setStatus(text) {
  document.getElementById('status').textContent = text;
}

// ============================================================
// ЗАПУСК
// ============================================================
loadState();
loadCollected();
renderHUD();

if (!('geolocation' in navigator)) {
  setStatus('Геолокация не поддерживается');
} else {
  let firstFix = true;
  navigator.geolocation.watchPosition(
    pos => {
      const { latitude, longitude } = pos.coords;
      updatePlayer(latitude, longitude);
      if (firstFix) {
        firstFix = false;
        setStatus('Собирай ресурсы и улучшай базу!');
      }
    },
    err => setStatus('Ошибка геолокации: ' + err.message),
    { enableHighAccuracy: true, maximumAge: 2000, timeout: 10000 }
  );
}
