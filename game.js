// ============================================================
// КОНФИГ
// ============================================================
const SPAWN_RADIUS_M = 150;
const COLLECT_RADIUS_M = 15;
const RESPAWN_MS = 60 * 1000;
const SPAWN_BATCH = 8;
const MIN_MOVE_M = 5;

const RESOURCE_TYPES = [
  { key: 'wood',  icon: '🪵', weight: 40, name: 'Дерево' },
  { key: 'metal', icon: '⚙️', weight: 30, name: 'Металл' },
  { key: 'chip',  icon: '🔌', weight: 20, name: 'Микросхема' },
  { key: 'fuel',  icon: '⛽', weight: 10, name: 'Топливо' },
];

const BUILDINGS = [
  {
    id: 'shelter',
    name: '🏕️ Укрытие',
    desc: 'Базовое укрытие',
    maxLevel: 5,
    cost: (lvl) => ({ wood: 10 * lvl, metal: 5 * lvl }),
  },
  {
    id: 'workshop',
    name: '🔧 Мастерская',
    desc: 'Открывает редкие ресурсы',
    maxLevel: 5,
    cost: (lvl) => ({ wood: 15 * lvl, metal: 20 * lvl, chip: 2 * lvl }),
  },
  {
    id: 'generator',
    name: '⚡ Генератор',
    desc: 'Увеличивает радиус спавна',
    maxLevel: 5,
    cost: (lvl) => ({ metal: 25 * lvl, fuel: 5 * lvl }),
  },
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
// КАРТА
// ============================================================
const map = L.map('map', { zoomControl: false }).setView([55.75, 37.61], 16);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 19,
  attribution: '© OpenStreetMap'
}).addTo(map);

let baseMarker = null;
let basePos = null;

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

function randomOffset(lat, lng, radiusM) {
  const r = Math.sqrt(Math.random()) * radiusM;
  const theta = Math.random() * 2 * Math.PI;
  const dLat = (r * Math.cos(theta)) / 111320;
  const dLng = (r * Math.sin(theta)) / (111320 * Math.cos((lat * Math.PI) / 180));
  return [lat + dLat, lng + dLng];
}

function pickResource() {
  const total = RESOURCE_TYPES.reduce((s, r) => s + r.weight, 0);
  let n = Math.random() * total;
  for (const r of RESOURCE_TYPES) {
    if (n < r.weight) return r;
    n -= r.weight;
  }
  return RESOURCE_TYPES[0];
}

// ============================================================
// ИГРОК
// ============================================================
let playerMarker = null;
let playerCircle = null;

function updatePlayer(lat, lng) {
  if (state.playerPos) {
    const d = distanceM(state.playerPos.lat, state.playerPos.lng, lat, lng);
    if (d > MIN_MOVE_M) {
      state.totalDistance += d;
      document.getElementById('distance').textContent = Math.round(state.totalDistance);
    }
  }
  state.playerPos = { lat, lng };

  if (!playerMarker) {
    playerMarker = L.circleMarker([lat, lng], {
      radius: 8, color: '#3b82f6', fillColor: '#3b82f6', fillOpacity: 1
    }).addTo(map);
    playerCircle = L.circle([lat, lng], {
      radius: COLLECT_RADIUS_M, color: '#3b82f6', fillOpacity: 0.1, weight: 1
    }).addTo(map);
    map.setView([lat, lng], 17);

    if (!basePos) {
      basePos = { lat, lng };
      baseMarker = L.marker([lat, lng], {
        icon: L.divIcon({ className: 'treasure-icon', html: '🏠', iconSize: [30, 30], iconAnchor: [15, 15] })
      }).addTo(map);
    }
  } else {
    playerMarker.setLatLng([lat, lng]);
    playerCircle.setLatLng([lat, lng]);
  }
  updateCollectButton();
}

// ============================================================
// РЕСУРСЫ
// ============================================================
const resources = [];

function spawnResource() {
  if (!state.playerPos) return;
  const [lat, lng] = randomOffset(state.playerPos.lat, state.playerPos.lng, SPAWN_RADIUS_M);
  const type = pickResource();
  const marker = L.marker([lat, lng], {
    icon: L.divIcon({
      className: 'treasure-icon', html: type.icon, iconSize: [30, 30], iconAnchor: [15, 15]
    })
  }).addTo(map);
  const res = { id: Date.now() + Math.random(), lat, lng, marker, type, collectedAt: null };
  marker.on('click', () => {
    if (!state.playerPos) return;
    const d = Math.round(distanceM(state.playerPos.lat, state.playerPos.lng, lat, lng));
    setStatus(type.name + ': ' + d + ' м');
  });
  resources.push(res);
}

function fillResources() {
  const active = resources.filter(r => !r.collectedAt).length;
  for (let i = active; i < SPAWN_BATCH; i++) spawnResource();
}

setInterval(() => {
  const now = Date.now();
  for (const r of resources) {
    if (r.collectedAt && now - r.collectedAt > RESPAWN_MS) {
      map.removeLayer(r.marker);
      r.collectedAt = null;
      const [lat, lng] = randomOffset(state.playerPos.lat, state.playerPos.lng, SPAWN_RADIUS_M);
      r.lat = lat; r.lng = lng;
      r.marker = L.marker([lat, lng], { icon: L.divIcon({
        className: 'treasure-icon', html: r.type.icon, iconSize: [30, 30], iconAnchor: [15, 15]
      })}).addTo(map);
    }
  }
  fillResources();
}, 20000);

// ============================================================
// КНОПКА СБОРА
// ============================================================
const collectBtn = document.getElementById('collectBtn');

function nearestResource() {
  if (!state.playerPos) return null;
  let best = null, bestD = Infinity;
  for (const r of resources) {
    if (r.collectedAt) continue;
    const d = distanceM(state.playerPos.lat, state.playerPos.lng, r.lat, r.lng);
    if (d < bestD) { bestD = d; best = r; }
  }
  return best ? { r: best, d: bestD } : null;
}

function updateCollectButton() {
  const near = nearestResource();
  if (near && near.d < COLLECT_RADIUS_M) {
    collectBtn.disabled = false;
    collectBtn.textContent = 'Собрать ' + near.r.type.icon + ' (' + Math.round(near.d) + ' м)';
  } else if (near) {
    collectBtn.disabled = true;
    collectBtn.textContent = 'Ближайшее: ' + Math.round(near.d) + ' м';
  } else {
    collectBtn.disabled = true;
    collectBtn.textContent = 'Ищи ресурсы…';
  }
}

collectBtn.addEventListener('click', () => {
  const near = nearestResource();
  if (!near || near.d >= COLLECT_RADIUS_M) return;
  const r = near.r;
  r.collectedAt = Date.now();
  map.removeLayer(r.marker);
  state.inventory[r.type.key] += 1;
  state.score += 1;
  renderHUD();
  saveState();
  setStatus('+1 ' + r.type.name);
  updateCollectButton();
});

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
        fillResources();
        setStatus('Собирай ресурсы и улучшай базу!');
      }
    },
    err => setStatus('Ошибка геолокации: ' + err.message),
    { enableHighAccuracy: true, maximumAge: 2000, timeout: 10000 }
  );
}
