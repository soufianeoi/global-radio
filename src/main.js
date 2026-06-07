import Globe from 'globe.gl';

/* ===== Config ===== */
const API_URL = 'https://all.api.radio-browser.info/json/stations/topclick/500';
const RETRIES = 3;
const RETRY_DELAY = 1500;
const KNOWN_CODECS = ['MP3', 'AAC', 'OGG', 'OPUS', 'FLAC', 'WMA', 'WAV'];
const GENRE_PALETTE = [
  '#ef4444', '#f97316', '#f59e0b', '#84cc16', '#10b981',
  '#06b6d4', '#3b82f6', '#6366f1', '#8b5cf6', '#d946ef', '#f43f5e'
];
const DOT_COLORS = {
  default: '#888888',
  playing: '#10b981',
  favorite: '#f59e0b',
  highlighted: '#3b82f6'
};
const GLOBE_TEXTURE = '/earth-texture.jpg';
const GLOBE_TEXTURE_FALLBACK = '/earth-texture.jpg';
const VOLUME_STORAGE_KEY = 'radio-volume';

/* ===== State ===== */
const state = {
  allStations: [],
  filteredStations: [],
  favorites: new Set(),
  activeFilters: { country: '', genre: '', favoritesOnly: false },
  searchQuery: '',
  currentStation: null,
  isPlaying: false,
  isBuffering: false,
  audio: null,
  globe: null,
  markerCache: new Map(),
  sleepTimerId: null,
  sleepRemaining: 0,
  highlightedStation: null,
  searchSelectedIndex: -1,
  darkMode: false,
  isMuted: false,
  previousVolume: 0.8,
};

/* ===== Utilities ===== */
function $(sel) { return document.querySelector(sel); }
function $$(sel) { return document.querySelectorAll(sel); }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function hashString(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0;
  return Math.abs(h);
}

function getStationColor(station) {
  const tag = (station.tags || '').split(',')[0]?.trim() || station.country || 'unknown';
  return GENRE_PALETTE[hashString(tag) % GENRE_PALETTE.length];
}

function formatTime(seconds) {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

/* ===== Dark Mode ===== */
function applyTheme(dark) {
  state.darkMode = dark;
  document.documentElement.classList.toggle('dark', dark);
  const meta = $('#theme-meta');
  if (meta) meta.content = dark ? '#1a1a1a' : '#ffffff';
  $('#sun-icon').style.display = dark ? 'none' : 'block';
  $('#moon-icon').style.display = dark ? 'block' : 'none';
  localStorage.setItem('radio-theme', dark ? 'dark' : 'light');
}

function toggleTheme() {
  applyTheme(!state.darkMode);
}

function loadTheme() {
  const saved = localStorage.getItem('radio-theme');
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  applyTheme(saved ? saved === 'dark' : prefersDark);
}

/* ===== Data Fetching ===== */
async function fetchWithRetry(url, retries = RETRIES) {
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': 'GlobalRadioApp/1.0' },
        mode: 'cors'
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (err) {
      console.warn(`Fetch attempt ${i + 1} failed:`, err.message);
      if (i === retries - 1) throw err;
      await sleep(RETRY_DELAY * (i + 1));
    }
  }
}

function isHealthy(station) {
  const url = station.url_resolved || station.url;
  if (!url || !url.startsWith('https://')) return false;

  const codec = (station.codec || '').toUpperCase();
  if (!codec || !KNOWN_CODECS.some(k => codec.includes(k))) return false;

  const lat = parseFloat(station.geo_lat);
  const lng = parseFloat(station.geo_long);
  if (isNaN(lat) || isNaN(lng) || (lat === 0 && lng === 0)) return false;

  return true;
}

function parseTags(station) {
  return (station.tags || '')
    .split(',')
    .map(t => t.trim().toLowerCase())
    .filter(t => t.length > 0 && t.length < 30);
}

async function loadStations() {
  const data = await fetchWithRetry(API_URL);
  state.allStations = data.filter(isHealthy).map((s, i) => ({
    ...s,
    _idx: i,
    _tags: parseTags(s),
    _color: getStationColor(s),
    _lat: parseFloat(s.geo_lat),
    _lng: parseFloat(s.geo_long),
  }));
}

/* ===== Marker Cache ===== */
function getMarkerData(station) {
  if (state.markerCache.has(station.stationuuid)) {
    return state.markerCache.get(station.stationuuid);
  }
  const obj = {
    stationuuid: station.stationuuid,
    lat: station._lat,
    lng: station._lng,
    color: station._color,
    radius: 0.35,
    altitude: 0.02,
    label: `<div class="tooltip-name">${escapeHtml(station.name)}</div>
            <div class="tooltip-meta">${escapeHtml(station.country || 'Unknown')} · ${escapeHtml((station.tags || '').split(',')[0] || 'Unknown genre')}</div>`,
    station: station,
  };
  state.markerCache.set(station.stationuuid, obj);
  return obj;
}

/* ===== Filtering ===== */
function applyFilters() {
  const { country, genre, favoritesOnly } = state.activeFilters;

  state.filteredStations = state.allStations.filter(s => {
    if (country && s.country !== country) return false;
    if (genre && !s._tags.includes(genre.toLowerCase())) return false;
    if (favoritesOnly && !state.favorites.has(s.stationuuid)) return false;
    return true;
  });

  syncFiltersToURL();
  updateUI();
}

function computeFilterCounts() {
  const { country, genre, favoritesOnly } = state.activeFilters;

  const countryCounts = new Map();
  state.allStations.forEach(s => {
    if (genre && !s._tags.includes(genre.toLowerCase())) return;
    if (favoritesOnly && !state.favorites.has(s.stationuuid)) return;
    countryCounts.set(s.country, (countryCounts.get(s.country) || 0) + 1);
  });

  const genreCounts = new Map();
  state.allStations.forEach(s => {
    if (country && s.country !== country) return;
    if (favoritesOnly && !state.favorites.has(s.stationuuid)) return;
    s._tags.forEach(tag => {
      genreCounts.set(tag, (genreCounts.get(tag) || 0) + 1);
    });
  });

  return { countryCounts, genreCounts };
}

/* ===== URL Sync ===== */
function syncFiltersToURL() {
  const params = new URLSearchParams();
  if (state.activeFilters.country) params.set('country', state.activeFilters.country);
  if (state.activeFilters.genre) params.set('genre', state.activeFilters.genre);
  if (state.activeFilters.favoritesOnly) params.set('fav', '1');
  const url = params.toString() ? `?${params}` : window.location.pathname;
  window.history.replaceState(null, '', url);
}

function readFiltersFromURL() {
  const params = new URLSearchParams(window.location.search);
  if (params.has('country')) state.activeFilters.country = params.get('country');
  if (params.has('genre')) state.activeFilters.genre = params.get('genre');
  if (params.has('fav')) state.activeFilters.favoritesOnly = true;
}

/* ===== Globe ===== */
function initGlobe() {
  const container = $('#globe-container');
  const w = container.clientWidth;
  const h = container.clientHeight;

  state.globe = Globe()(container)
    .width(w)
    .height(h)
    .globeImageUrl(GLOBE_TEXTURE)
    .backgroundColor('rgba(255,255,255,0)')
    .atmosphereColor('#e8e8e8')
    .atmosphereAltitude(0.15)
    .showGraticules(true)
    .pointsData([])
    .pointLat('lat')
    .pointLng('lng')
    .pointColor('color')
    .pointRadius('radius')
    .pointAltitude('altitude')
    .pointLabel('label')
    .onPointClick(handleMarkerClick)
    .onPointHover(handleMarkerHover);

  state.globe.controls().autoRotate = true;
  state.globe.controls().autoRotateSpeed = 0.6;

  // Texture fallback
  const texLoader = state.globe.globeImageUrl;
  if (texLoader) {
    const img = new Image();
    img.onerror = () => {
      if (state.globe) state.globe.globeImageUrl(GLOBE_TEXTURE_FALLBACK);
    };
    img.src = GLOBE_TEXTURE;
  }

  window.addEventListener('resize', () => {
    const w = container.clientWidth;
    const h = container.clientHeight;
    state.globe.width(w).height(h);
  });
}

function updateGlobe() {
  if (!state.globe) return;
  const points = state.filteredStations.map(s => getMarkerData(s));
  state.globe.pointsData(points);
}

function handleMarkerClick(point) {
  if (!point || !point.station) return;
  playStation(point.station);
  highlightStation(point.station.stationuuid);
  scrollToCard(point.station.stationuuid);
  if (state.globe && state.globe.pointOfView) {
    state.globe.controls().autoRotate = false;
    state.globe.pointOfView({ lat: point.lat, lng: point.lng, altitude: 1.5 }, 1000);
    setTimeout(() => { state.globe.controls().autoRotate = true; }, 1500);
  }
}

function handleMarkerHover(point) {
  if (point && point.station) {
    highlightCard(point.station.stationuuid);
  } else {
    unhighlightCard();
  }
}

function highlightMarker(stationuuid) {
  const marker = state.markerCache.get(stationuuid);
  if (marker) {
    marker.radius = 0.7;
    marker.color = DOT_COLORS.highlighted;
    updateGlobe();
  }
}

function unhighlightMarker(stationuuid) {
  const marker = state.markerCache.get(stationuuid);
  const station = state.allStations.find(s => s.stationuuid === stationuuid);
  if (marker && station) {
    marker.radius = stationuuid === state.currentStation?.stationuuid ? 0.5 : 0.35;
    marker.color = stationuuid === state.currentStation?.stationuuid ? DOT_COLORS.playing : station._color;
    updateGlobe();
  }
}

/* ===== Cards ===== */
function renderCards() {
  const grid = $('#station-grid');
  grid.innerHTML = '';

  state.filteredStations.forEach(station => {
    const card = document.createElement('div');
    card.className = 'station-card';
    card.dataset.uuid = station.stationuuid;
    card.role = 'button';
    card.tabIndex = 0;
    if (station.stationuuid === state.currentStation?.stationuuid) {
      card.classList.add('active', 'playing');
    }
    if (state.favorites.has(station.stationuuid)) {
      card.classList.add('favorite');
    }

    const topTag = station._tags[0] || station.codec || 'radio';
    const isFav = state.favorites.has(station.stationuuid);

    card.innerHTML = `
      <div class="card-top">
        <div class="card-status" style="background:${station._color}"></div>
        <div class="eq-bars">
          <span></span><span></span><span></span>
        </div>
        <button class="card-fav" data-uuid="${station.stationuuid}" title="Favorite" aria-label="Toggle favorite">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="${isFav ? '#ef4444' : 'none'}" stroke="currentColor" stroke-width="2">
            <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path>
          </svg>
        </button>
      </div>
      <div class="card-name">${escapeHtml(station.name)}</div>
      <div class="card-meta">
        <span class="card-tag">${escapeHtml(station.country || 'Unknown')}</span>
        <span class="card-tag">${escapeHtml(topTag)}</span>
      </div>
    `;

    card.addEventListener('click', (e) => {
      if (e.target.closest('.card-fav')) {
        e.stopPropagation();
        toggleFavorite(station.stationuuid);
        return;
      }
      playStation(station);
      highlightStation(station.stationuuid);
      if (state.globe && state.globe.pointOfView) {
        state.globe.controls().autoRotate = false;
        state.globe.pointOfView({ lat: station._lat, lng: station._lng, altitude: 1.5 }, 1000);
        setTimeout(() => { state.globe.controls().autoRotate = true; }, 1500);
      }
    });

    card.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        card.click();
      }
    });

    card.addEventListener('mouseenter', () => {
      highlightMarker(station.stationuuid);
    });

    card.addEventListener('mouseleave', () => {
      if (station.stationuuid !== state.currentStation?.stationuuid) {
        unhighlightMarker(station.stationuuid);
      }
    });

    grid.appendChild(card);
  });

  showEmptyState(state.filteredStations.length === 0);
}

function highlightCard(stationuuid) {
  $$('.station-card').forEach(c => c.classList.remove('highlighted'));
  const card = $(`.station-card[data-uuid="${stationuuid}"]`);
  if (card) {
    card.classList.add('highlighted');
    card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
}

function unhighlightCard() {
  $$('.station-card').forEach(c => c.classList.remove('highlighted'));
}

function scrollToCard(stationuuid) {
  const card = $(`.station-card[data-uuid="${stationuuid}"]`);
  if (card) {
    card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
}

function highlightStation(stationuuid) {
  state.highlightedStation = stationuuid;
  $$('.station-card').forEach(c => {
    c.classList.toggle('active', c.dataset.uuid === stationuuid);
    c.classList.toggle('playing', c.dataset.uuid === stationuuid);
  });
  state.markerCache.forEach((marker, uuid) => {
    const station = state.allStations.find(s => s.stationuuid === uuid);
    if (!station) return;
    if (uuid === stationuuid) {
      marker.radius = 0.5;
      marker.color = DOT_COLORS.playing;
    } else {
      marker.radius = 0.35;
      marker.color = station._color;
    }
  });
  updateGlobe();
}

/* ===== Empty State ===== */
function showEmptyState(show) {
  const empty = $('#empty-state');
  const grid = $('#station-grid');
  if (show && state.allStations.length > 0) {
    empty.style.display = 'flex';
    grid.style.display = 'none';
    const { country, genre, favoritesOnly } = state.activeFilters;
    if (favoritesOnly) {
      $('#empty-state-text').textContent = 'No favorites match your filters';
    } else if (country || genre) {
      $('#empty-state-text').textContent = 'No stations match your filters';
    } else {
      $('#empty-state-text').textContent = 'No stations found';
    }
  } else {
    empty.style.display = 'none';
    grid.style.display = show ? 'none' : '';
  }
}

/* ===== Player ===== */
function initAudio() {
  state.audio = new Audio();

  const savedVol = localStorage.getItem(VOLUME_STORAGE_KEY);
  if (savedVol !== null) {
    state.audio.volume = parseFloat(savedVol);
    $('#volume').value = state.audio.volume;
    updateVolumeDisplay();
  } else {
    state.audio.volume = 0.8;
  }

  state.audio.addEventListener('play', () => {
    state.isPlaying = true;
    state.isBuffering = false;
    updatePlayerUI();
  });

  state.audio.addEventListener('pause', () => {
    state.isPlaying = false;
    state.isBuffering = false;
    updatePlayerUI();
  });

  state.audio.addEventListener('waiting', () => {
    state.isBuffering = true;
    updatePlayerUI();
  });

  state.audio.addEventListener('canplay', () => {
    state.isBuffering = false;
    updatePlayerUI();
  });

  state.audio.addEventListener('playing', () => {
    state.isBuffering = false;
    updatePlayerUI();
  });

  state.audio.addEventListener('error', () => {
    console.error('Audio error');
    state.isPlaying = false;
    state.isBuffering = false;
    updatePlayerUI();
    if (state.currentStation && state.currentStation.url && state.currentStation.url !== state.audio.src) {
      state.audio.src = state.currentStation.url;
      state.audio.play().catch(() => {});
    }
  });
}

function playStation(station) {
  if (!station) return;

  if (state.currentStation?.stationuuid === station.stationuuid && state.isPlaying) {
    pauseAudio();
    return;
  }

  state.currentStation = station;
  state.isBuffering = true;
  updatePlayerUI();

  state.audio.src = station.url_resolved || station.url;
  state.audio.play().catch(err => {
    console.error('Play failed:', err);
    state.isBuffering = false;
    if (station.url && station.url !== state.audio.src) {
      state.audio.src = station.url;
      state.audio.play().catch(() => {});
    }
  });

  highlightStation(station.stationuuid);
}

function pauseAudio() {
  state.audio.pause();
  state.isPlaying = false;
  state.isBuffering = false;
  updatePlayerUI();
}

function togglePlay() {
  if (!state.currentStation) return;
  if (state.isPlaying) {
    pauseAudio();
  } else {
    state.audio.play().catch(() => {});
  }
}

function updateVolumeDisplay() {
  const vol = Math.round(parseFloat($('#volume').value) * 100);
  $('#volume-display').textContent = `${vol}%`;
}

function updatePlayerUI() {
  const playBtn = $('#play-btn');
  const playIcon = $('#play-icon');
  const pauseIcon = $('#pause-icon');
  const spinner = $('#buffering-spinner');
  const nameEl = $('#player-name');
  const metaEl = $('#player-meta');
  const favBtn = $('#favorite-btn');

  if (!state.currentStation) {
    playBtn.disabled = true;
    favBtn.disabled = true;
    nameEl.textContent = 'Select a station';
    metaEl.textContent = '';
    playIcon.style.display = 'block';
    pauseIcon.style.display = 'none';
    spinner.style.display = 'none';
    return;
  }

  playBtn.disabled = false;
  favBtn.disabled = false;

  if (state.isBuffering) {
    playIcon.style.display = 'none';
    pauseIcon.style.display = 'none';
    spinner.style.display = 'flex';
  } else if (state.isPlaying) {
    playIcon.style.display = 'none';
    pauseIcon.style.display = 'block';
    spinner.style.display = 'none';
  } else {
    playIcon.style.display = 'block';
    pauseIcon.style.display = 'none';
    spinner.style.display = 'none';
  }

  nameEl.textContent = state.currentStation.name;
  const tag = state.currentStation._tags[0] || state.currentStation.codec || 'radio';
  metaEl.textContent = `${state.currentStation.country || 'Unknown'} · ${tag}`;

  const isFav = state.favorites.has(state.currentStation.stationuuid);
  favBtn.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="${isFav ? '#ef4444' : 'none'}" stroke="${isFav ? '#ef4444' : 'currentColor'}" stroke-width="2">
    <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path>
  </svg>`;
}

/* ===== Favorites ===== */
function loadFavorites() {
  try {
    const data = JSON.parse(localStorage.getItem('radio-favorites') || '[]');
    state.favorites = new Set(data);
  } catch {
    state.favorites = new Set();
  }
}

function saveFavorites() {
  localStorage.setItem('radio-favorites', JSON.stringify([...state.favorites]));
}

function toggleFavorite(stationuuid) {
  if (state.favorites.has(stationuuid)) {
    state.favorites.delete(stationuuid);
  } else {
    state.favorites.add(stationuuid);
  }
  saveFavorites();

  const card = $(`.station-card[data-uuid="${stationuuid}"]`);
  if (card) {
    card.classList.toggle('favorite', state.favorites.has(stationuuid));
    const favBtn = card.querySelector('.card-fav');
    const isFav = state.favorites.has(stationuuid);
    favBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="${isFav ? '#ef4444' : 'none'}" stroke="currentColor" stroke-width="2">
      <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path>
    </svg>`;
  }

  if (state.currentStation?.stationuuid === stationuuid) {
    updatePlayerUI();
  }

  if (state.activeFilters.favoritesOnly) {
    applyFilters();
  }
}

/* ===== Filters UI ===== */
function updateFilterOptions() {
  const { countryCounts, genreCounts } = computeFilterCounts();
  const countrySel = $('#country-filter');
  const genreSel = $('#genre-filter');
  const currentCountry = state.activeFilters.country;
  const currentGenre = state.activeFilters.genre;

  const countryOptions = Array.from(countryCounts.entries()).sort((a, b) => b[1] - a[1]);
  const genreOptions = Array.from(genreCounts.entries()).sort((a, b) => b[1] - a[1]).slice(0, 100);

  countrySel.innerHTML = '<option value="">All Countries</option>';
  countryOptions.forEach(([country, count]) => {
    const opt = document.createElement('option');
    opt.value = country;
    opt.textContent = `${country} (${count})`;
    if (country === currentCountry) opt.selected = true;
    countrySel.appendChild(opt);
  });

  genreSel.innerHTML = '<option value="">All Genres</option>';
  genreOptions.forEach(([genre, count]) => {
    const opt = document.createElement('option');
    opt.value = genre;
    opt.textContent = `${genre} (${count})`;
    if (genre === currentGenre) opt.selected = true;
    genreSel.appendChild(opt);
  });

  $('#country-badge').textContent = countryOptions.length;
  $('#genre-badge').textContent = genreOptions.length;
}

function initFilters() {
  $('#country-filter').addEventListener('change', (e) => {
    state.activeFilters.country = e.target.value;
    applyFilters();
  });

  $('#genre-filter').addEventListener('change', (e) => {
    state.activeFilters.genre = e.target.value;
    applyFilters();
  });

  $('#favorites-toggle').addEventListener('click', () => {
    state.activeFilters.favoritesOnly = !state.activeFilters.favoritesOnly;
    $('#favorites-toggle').classList.toggle('active', state.activeFilters.favoritesOnly);
    applyFilters();
  });
}

/* ===== Search Modal ===== */
function matchesSearch(station, query) {
  if (!query) return true;
  const q = query.toLowerCase();
  return station.name.toLowerCase().includes(q) ||
    (station.country || '').toLowerCase().includes(q) ||
    (station.tags || '').toLowerCase().includes(q) ||
    (station.state || '').toLowerCase().includes(q);
}

function initSearch() {
  const modal = $('#search-modal');
  const input = $('#search-input');

  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
      e.preventDefault();
      openSearch();
    }
    if (e.key === 'Escape' && modal.classList.contains('open')) {
      closeSearch();
    }
    if (modal.classList.contains('open')) {
      handleSearchNav(e);
    }
  });

  $('.search-backdrop').addEventListener('click', closeSearch);

  input.addEventListener('input', (e) => {
    state.searchQuery = e.target.value.trim();
    renderSearchResults();
  });
}

function openSearch() {
  $('#search-modal').classList.add('open');
  $('#search-input').value = state.searchQuery;
  $('#search-input').focus();
  renderSearchResults();
}

function closeSearch() {
  $('#search-modal').classList.remove('open');
  state.searchSelectedIndex = -1;
  state.searchQuery = '';
}

function renderSearchResults() {
  const results = $('#search-results');
  const query = state.searchQuery.toLowerCase();

  if (!query) {
    results.innerHTML = '<div class="search-empty">Type to search stations, countries, or genres</div>';
    return;
  }

  const matches = state.allStations.filter(s => matchesSearch(s, query)).slice(0, 50);

  if (matches.length === 0) {
    results.innerHTML = '<div class="search-empty">No stations found</div>';
    return;
  }

  results.innerHTML = '';
  matches.forEach((station, i) => {
    const el = document.createElement('div');
    el.className = 'search-result-item';
    el.dataset.index = i;
    el.dataset.uuid = station.stationuuid;
    el.role = 'option';
    if (i === state.searchSelectedIndex) el.classList.add('selected');

    const tag = station._tags[0] || station.codec || 'radio';
    el.innerHTML = `
      <div class="search-result-dot" style="background:${station._color}"></div>
      <div class="search-result-info">
        <div class="search-result-name">${escapeHtml(station.name)}</div>
        <div class="search-result-meta">${escapeHtml(station.country || 'Unknown')} · ${escapeHtml(tag)}</div>
      </div>
    `;

    el.addEventListener('click', () => {
      playStation(station);
      highlightStation(station.stationuuid);
      scrollToCard(station.stationuuid);
      closeSearch();
    });

    results.appendChild(el);
  });
}

function handleSearchNav(e) {
  const items = $$('.search-result-item');
  if (!items.length) return;

  if (e.key === 'ArrowDown') {
    e.preventDefault();
    state.searchSelectedIndex = (state.searchSelectedIndex + 1) % items.length;
    updateSearchSelection();
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    state.searchSelectedIndex = state.searchSelectedIndex <= 0 ? items.length - 1 : state.searchSelectedIndex - 1;
    updateSearchSelection();
  } else if (e.key === 'Enter') {
    e.preventDefault();
    const selected = items[state.searchSelectedIndex];
    if (selected) {
      const uuid = selected.dataset.uuid;
      const station = state.allStations.find(s => s.stationuuid === uuid);
      if (station) {
        playStation(station);
        highlightStation(uuid);
        scrollToCard(uuid);
        closeSearch();
      }
    }
  }
}

function updateSearchSelection() {
  $$('.search-result-item').forEach((el, i) => {
    el.classList.toggle('selected', i === state.searchSelectedIndex);
    if (i === state.searchSelectedIndex) {
      el.scrollIntoView({ block: 'nearest' });
    }
  });
}

/* ===== Sleep Timer ===== */
function initSleepTimer() {
  $('#sleep-btn').addEventListener('click', () => {
    $('#sleep-menu').classList.toggle('open');
  });

  $('#sleep-menu').addEventListener('click', (e) => {
    if (e.target.tagName === 'BUTTON') {
      const mins = parseInt(e.target.dataset.min);
      setSleepTimer(mins);
      $('#sleep-menu').classList.remove('open');
    }
  });

  document.addEventListener('click', (e) => {
    if (!e.target.closest('.sleep-wrap')) {
      $('#sleep-menu').classList.remove('open');
    }
  });
}

function setSleepTimer(minutes) {
  if (state.sleepTimerId) {
    clearInterval(state.sleepTimerId);
    state.sleepTimerId = null;
  }
  state.sleepRemaining = 0;

  if (minutes <= 0) {
    $('#sleep-display').textContent = '';
    return;
  }

  state.sleepRemaining = minutes * 60;
  $('#sleep-display').textContent = formatTime(state.sleepRemaining);

  state.sleepTimerId = setInterval(() => {
    state.sleepRemaining--;
    if (state.sleepRemaining <= 0) {
      clearInterval(state.sleepTimerId);
      state.sleepTimerId = null;
      pauseAudio();
      $('#sleep-display').textContent = '';
    } else {
      $('#sleep-display').textContent = formatTime(state.sleepRemaining);
    }
  }, 1000);
}

/* ===== UI Updates ===== */
function updateUI() {
  renderCards();
  updateGlobe();
  updateFilterOptions();
  const count = state.filteredStations.length;
  $('#station-count').textContent = `${count} station${count !== 1 ? 's' : ''}`;
  document.title = `Global Radio — ${count} station${count !== 1 ? 's' : ''}`;
}

/* ===== Initialization ===== */
async function init() {
  loadTheme();
  loadFavorites();
  readFiltersFromURL();
  initAudio();
  initGlobe();
  initFilters();
  initSearch();
  initSleepTimer();
  updateVolumeDisplay();

  // mute toggle
  $('#mute-btn').addEventListener('click', () => {
    if (state.isMuted) {
      state.audio.volume = state.previousVolume;
      $('#volume').value = state.previousVolume;
      state.isMuted = false;
    } else {
      state.previousVolume = state.audio.volume;
      state.audio.volume = 0;
      $('#volume').value = 0;
      state.isMuted = true;
    }
    updateVolumeDisplay();
    updatePlayerUI();
  });

  $('#volume').addEventListener('input', (e) => {
    const vol = parseFloat(e.target.value);
    state.audio.volume = vol;
    state.isMuted = vol === 0;
    localStorage.setItem(VOLUME_STORAGE_KEY, vol);
    updateVolumeDisplay();
  });

  $('#play-btn').addEventListener('click', togglePlay);
  $('#favorite-btn').addEventListener('click', () => {
    if (state.currentStation) toggleFavorite(state.currentStation.stationuuid);
  });
  $('#theme-toggle').addEventListener('click', toggleTheme);
  $('#clear-filters-btn').addEventListener('click', () => {
    state.activeFilters.country = '';
    state.activeFilters.genre = '';
    state.activeFilters.favoritesOnly = false;
    $('#favorites-toggle').classList.remove('active');
    applyFilters();
  });

  // Retry on loading error
  $('#retry-btn').addEventListener('click', () => {
    $('#retry-btn').style.display = 'none';
    $('.loading-text').textContent = 'Loading stations…';
    $('#loading-sub').textContent = 'Fetching global radio from radio-browser.info';
    init();
  });

  try {
    await loadStations();
    applyFilters();
    $('#loading').classList.add('hidden');
    $('#main-layout').style.display = 'flex';
  } catch (err) {
    console.error('Failed to load stations:', err);
    $('.loading-text').textContent = 'Failed to load stations';
    $('#loading-sub').textContent = `${err.message}. Check your internet connection.`;
    $('#retry-btn').style.display = 'inline-block';
  }
}

init();
