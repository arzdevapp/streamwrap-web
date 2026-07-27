// ==================== Password Gate ====================
var STREAMWRAP_PASSWORD='iamcool';

(function() {
  var gate = document.getElementById('password-gate');
  var app = document.getElementById('app');
  var loading = document.getElementById('loading-screen');
  
  // Check if already unlocked this session
  if (sessionStorage.getItem('sw-unlocked')) {
    loading.classList.add('hidden');
    app.classList.remove('hidden');
    initApp();
    return;
  }
  
  // Show gate, hide loading
  loading.classList.add('hidden');
  gate.classList.remove('hidden');
  
  function tryUnlock() {
    var pw = document.getElementById('gate-password').value;
    if (pw === STREAMWRAP_PASSWORD) {
      sessionStorage.setItem('sw-unlocked', 'true');
      gate.classList.add('hidden');
      app.classList.remove('hidden');
      initApp();
    } else {
      document.getElementById('gate-error').classList.remove('hidden');
      document.getElementById('gate-password').value = '';
      document.getElementById('gate-password').focus();
    }
  }
  
  document.getElementById('gate-btn').addEventListener('click', tryUnlock);
  document.getElementById('gate-password').addEventListener('keydown', function(e) {
    if (e.key === 'Enter') tryUnlock();
  });
  document.getElementById('gate-password').focus();
})();

// ==================== State ====================
let channels = [], filteredChannels = [], categories = new Set();
let hls = null, isLoading = false, liveMatches = [], matchInterval = null;
let selectedCategory = 'all', searchQuery = '';

// MovieBox state
const MB_BASE = 'https://h5-api.aoneroom.com/wefeed-h5api-bff';
const MB_HEADERS = {
  'Accept': 'application/json',
  'X-Client-Info': JSON.stringify({timezone: 'America/Vancouver'}),
  'X-Request-Lang': 'en'
};
const mbCache = {};
let mbAllItems = [];
let mbHeroItems = [];
let heroIndex = 0;
let heroTimer = null;
let currentMode = 'moviebox'; // 'moviebox' or 'm3u'

// ==================== DOM ====================
const $ = id => document.getElementById(id);
const els = {};
['playlist-url','load-btn','playlist-status','channels-section','channel-list',
 'channel-count','search-input','player-overlay','video-player','player-channel-name',
 'close-player','player-error','retry-btn','hero-watch-btn','hero-browse-btn',
 'loading-screen','app','matches-grid','category-tabs','matches-section',
 'hero','playlist-section'].forEach(id => els[id] = $(id));

// Hide loading screen IMMEDIATELY
els['loading-screen'].classList.add('hidden');
els['app'].classList.remove('hidden');

// ==================== MovieBox API ====================
async function mbFetch(endpoint, params) {
  const qs = new URLSearchParams(params).toString();
  const url = MB_BASE + endpoint + '?' + qs;
  if (mbCache[url]) return mbCache[url];
  try {
    const ctrl = new AbortController();
    setTimeout(() => ctrl.abort(), 12000);
    const r = await fetch(url, {headers: MB_HEADERS, signal: ctrl.signal});
    const j = await r.json();
    mbCache[url] = j;
    return j;
  } catch(e) {
    console.warn('MB fetch failed:', endpoint, e);
    return null;
  }
}

async function mbGetRecs(subjectId, page, perPage) {
  const j = await mbFetch('/subject/detail-rec', {subjectId, page, perPage});
  return (j && j.data && j.data.items) || [];
}

async function mbGetDetail(detailPath) {
  const j = await mbFetch('/detail', {detailPath});
  return (j && j.data && j.data.subject) || null;
}

async function mbSearch(keyword) {
  const j = await mbFetch('/subject/everyone-search', {keyword});
  return (j && j.data && j.data.everyoneSearch) || [];
}

// ==================== MovieBox UI Injection ====================
function injectNetflixStyles() {
  const s = document.createElement('style');
  s.textContent = `
    /* Netflix-style additions */
    #app {
      max-width: 100% !important;
      padding: 0 0 80px !important;
    }
    header {
      padding: 16px 24px !important;
      max-width: 1400px !important;
      margin: 0 auto !important;
    }
    .mode-tabs {
      display: flex;
      gap: 4px;
      background: rgba(255,255,255,0.05);
      border-radius: 8px;
      padding: 3px;
      margin-left: 12px;
    }
    .mode-tab {
      padding: 6px 14px;
      border-radius: 6px;
      border: none;
      background: transparent;
      color: rgba(255,255,255,0.5);
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
      transition: 0.2s;
      font-family: inherit;
    }
    .mode-tab.active {
      background: rgba(255,255,255,0.12);
      color: #fff;
    }
    .mode-tab:hover { color: rgba(255,255,255,0.8); }

    /* Hero Banner */
    #netflix-hero {
      position: relative;
      width: 100%;
      height: 70vh;
      min-height: 400px;
      max-height: 700px;
      overflow: hidden;
      margin-bottom: 0;
      cursor: pointer;
    }
    .hero-slide {
      position: absolute;
      inset: 0;
      opacity: 0;
      transition: opacity 0.8s ease-in-out;
    }
    .hero-slide.active { opacity: 1; z-index: 1; }
    .hero-bg {
      position: absolute;
      inset: 0;
      background-size: cover;
      background-position: center top;
      filter: blur(0px);
    }
    .hero-bg::after {
      content: '';
      position: absolute;
      inset: 0;
      background: linear-gradient(
        to bottom,
        rgba(13,13,26,0.1) 0%,
        rgba(13,13,26,0.3) 40%,
        rgba(13,13,26,0.85) 70%,
        #0D0D1A 100%
      );
    }
    .hero-info {
      position: absolute;
      bottom: 80px;
      left: 40px;
      right: 40px;
      z-index: 2;
      max-width: 600px;
    }
    .hero-badge {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 4px 12px;
      border-radius: 4px;
      background: rgba(229,9,20,0.9);
      color: #fff;
      font-size: 12px;
      font-weight: 700;
      margin-bottom: 12px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    .hero-info h2 {
      font-size: 40px;
      font-weight: 800;
      color: #fff;
      margin-bottom: 8px;
      text-shadow: 0 2px 20px rgba(0,0,0,0.5);
      line-height: 1.1;
    }
    .hero-meta {
      display: flex;
      align-items: center;
      gap: 12px;
      margin-bottom: 12px;
      flex-wrap: wrap;
    }
    .hero-rating {
      color: #46d369;
      font-weight: 700;
      font-size: 14px;
    }
    .hero-year, .hero-genre, .hero-country {
      color: rgba(255,255,255,0.6);
      font-size: 13px;
    }
    .hero-desc {
      color: rgba(255,255,255,0.75);
      font-size: 14px;
      line-height: 1.5;
      margin-bottom: 16px;
      display: -webkit-box;
      -webkit-line-clamp: 3;
      -webkit-box-orient: vertical;
      overflow: hidden;
    }
    .hero-actions {
      display: flex;
      gap: 10px;
      flex-wrap: wrap;
    }
    .hero-play-btn {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 12px 28px;
      border-radius: 6px;
      border: none;
      background: #e50914;
      color: #fff;
      font-size: 16px;
      font-weight: 700;
      cursor: pointer;
      transition: 0.2s;
    }
    .hero-play-btn:hover { background: #f40612; transform: scale(1.02); }
    .hero-info-btn {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 12px 28px;
      border-radius: 6px;
      border: none;
      background: rgba(109,109,110,0.7);
      color: #fff;
      font-size: 16px;
      font-weight: 600;
      cursor: pointer;
      transition: 0.2s;
    }
    .hero-info-btn:hover { background: rgba(109,109,110,0.9); }
    .hero-dots {
      position: absolute;
      bottom: 20px;
      left: 50%;
      transform: translateX(-50%);
      display: flex;
      gap: 6px;
      z-index: 3;
    }
    .hero-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: rgba(255,255,255,0.3);
      cursor: pointer;
      transition: 0.3s;
    }
    .hero-dot.active {
      background: #e50914;
      width: 24px;
      border-radius: 4px;
    }

    /* Content Rows */
    .content-rows {
      max-width: 1400px;
      margin: 0 auto;
      padding: 0 40px;
    }
    .mb-row {
      margin-bottom: 36px;
    }
    .mb-row-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 12px;
    }
    .mb-row-header h3 {
      font-size: 18px;
      font-weight: 700;
      color: #fff;
    }
    .mb-row-see-all {
      font-size: 13px;
      color: #e50914;
      cursor: pointer;
      font-weight: 600;
      transition: 0.2s;
    }
    .mb-row-see-all:hover { text-decoration: underline; }
    .mb-row-scroll {
      display: flex;
      gap: 8px;
      overflow-x: auto;
      scroll-behavior: smooth;
      scrollbar-width: none;
      -ms-overflow-style: none;
      padding-bottom: 8px;
    }
    .mb-row-scroll::-webkit-scrollbar { display: none; }

    /* Card */
    .mb-card {
      flex: 0 0 auto;
      width: 180px;
      cursor: pointer;
      transition: transform 0.3s, box-shadow 0.3s;
      position: relative;
      border-radius: 4px;
      overflow: hidden;
    }
    .mb-card:hover {
      transform: scale(1.08);
      z-index: 5;
      box-shadow: 0 8px 40px rgba(0,0,0,0.6);
    }
    .mb-card-img {
      width: 100%;
      aspect-ratio: 2/3;
      object-fit: cover;
      display: block;
      background: #1a1a2e;
    }
    .mb-card-overlay {
      position: absolute;
      bottom: 0;
      left: 0;
      right: 0;
      padding: 8px;
      background: linear-gradient(transparent, rgba(0,0,0,0.9));
      opacity: 0;
      transition: opacity 0.3s;
    }
    .mb-card:hover .mb-card-overlay { opacity: 1; }
    .mb-card-title {
      font-size: 12px;
      font-weight: 600;
      color: #fff;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .mb-card-rating {
      font-size: 11px;
      color: #46d369;
      font-weight: 700;
    }
    .mb-card-play {
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%) scale(0);
      width: 50px;
      height: 50px;
      border-radius: 50%;
      background: rgba(229,9,20,0.9);
      display: flex;
      align-items: center;
      justify-content: center;
      color: #fff;
      font-size: 22px;
      transition: transform 0.3s;
    }
    .mb-card:hover .mb-card-play { transform: translate(-50%, -50%) scale(1); }

    /* Detail Modal */
    #detail-modal {
      position: fixed;
      inset: 0;
      z-index: 2000;
      display: flex;
      align-items: center;
      justify-content: center;
      background: rgba(0,0,0,0.85);
      opacity: 0;
      pointer-events: none;
      transition: opacity 0.3s;
    }
    #detail-modal.show {
      opacity: 1;
      pointer-events: all;
    }
    .detail-card {
      background: #181818;
      border-radius: 12px;
      width: 90%;
      max-width: 700px;
      max-height: 90vh;
      overflow-y: auto;
      position: relative;
    }
    .detail-backdrop {
      width: 100%;
      height: 300px;
      object-fit: cover;
      border-radius: 12px 12px 0 0;
    }
    .detail-close {
      position: absolute;
      top: 12px;
      right: 12px;
      width: 36px;
      height: 36px;
      border-radius: 50%;
      background: rgba(0,0,0,0.6);
      border: none;
      color: #fff;
      font-size: 18px;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 5;
    }
    .detail-body { padding: 24px; }
    .detail-body h2 {
      font-size: 28px;
      font-weight: 800;
      color: #fff;
      margin-bottom: 12px;
    }
    .detail-meta-row {
      display: flex;
      gap: 12px;
      align-items: center;
      flex-wrap: wrap;
      margin-bottom: 16px;
    }
    .detail-rating { color: #46d369; font-weight: 700; font-size: 15px; }
    .detail-tag {
      padding: 3px 10px;
      border-radius: 4px;
      background: rgba(255,255,255,0.1);
      color: rgba(255,255,255,0.7);
      font-size: 12px;
      font-weight: 500;
    }
    .detail-desc {
      color: rgba(255,255,255,0.7);
      font-size: 14px;
      line-height: 1.6;
      margin-bottom: 20px;
    }
    .detail-actions {
      display: flex;
      gap: 10px;
      flex-wrap: wrap;
    }
    .detail-play-btn {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 12px 32px;
      border-radius: 6px;
      border: none;
      background: #e50914;
      color: #fff;
      font-size: 16px;
      font-weight: 700;
      cursor: pointer;
      transition: 0.2s;
    }
    .detail-play-btn:hover { background: #f40612; }
    .detail-info-btn {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 12px 32px;
      border-radius: 6px;
      border: none;
      background: rgba(109,109,110,0.7);
      color: #fff;
      font-size: 16px;
      font-weight: 600;
      cursor: pointer;
    }
    .detail-subtitles {
      margin-top: 16px;
      font-size: 12px;
      color: rgba(255,255,255,0.4);
    }
    .detail-subtitles span { color: rgba(255,255,255,0.6); }

    /* Search */
    .mb-search-wrap {
      position: relative;
      max-width: 360px;
    }
    .mb-search-input {
      width: 100%;
      padding: 10px 14px 10px 36px;
      border-radius: 6px;
      border: 2px solid rgba(255,255,255,0.1);
      background: rgba(255,255,255,0.08);
      color: #fff;
      font-size: 14px;
      font-family: inherit;
      outline: none;
      transition: 0.2s;
    }
    .mb-search-input:focus {
      border-color: #e50914;
      background: rgba(0,0,0,0.4);
    }
    .mb-search-input::placeholder { color: rgba(255,255,255,0.3); }
    .mb-search-icon {
      position: absolute;
      left: 12px;
      top: 50%;
      transform: translateY(-50%);
      color: rgba(255,255,255,0.3);
      font-size: 14px;
      pointer-events: none;
    }

    /* Browse All Grid */
    #browse-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
      gap: 12px;
      padding: 20px 40px;
      max-width: 1400px;
      margin: 0 auto;
    }
    #browse-grid .mb-card {
      width: 100%;
    }
    .browse-title {
      text-align: center;
      font-size: 20px;
      font-weight: 700;
      color: #fff;
      padding: 20px 40px 10px;
      max-width: 1400px;
      margin: 0 auto;
    }

    /* Loading skeleton */
    .skeleton-row {
      display: flex;
      gap: 8px;
      padding: 0 40px;
      margin-bottom: 36px;
    }
    .skeleton-card {
      flex: 0 0 180px;
      height: 270px;
      border-radius: 4px;
      background: linear-gradient(90deg, #1a1a2e 25%, #252540 50%, #1a1a2e 75%);
      background-size: 200% 100%;
      animation: shimmer 1.5s infinite;
    }
    @keyframes shimmer {
      0% { background-position: 200% 0; }
      100% { background-position: -200% 0; }
    }

    /* M3U mode container */
    #m3u-mode {
      max-width: 900px;
      margin: 0 auto;
      padding: 0 16px;
    }
    #m3u-mode.hidden { display: none; }
    #moviebox-mode.hidden { display: none; }

    /* M3U playlist area */
    #m3u-playlist-area { margin: 8px 0 16px; }
    .section-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 12px;
      flex-wrap: wrap;
      gap: 8px;
    }
    .section-header h3 { font-size: 16px; font-weight: 700; }

    /* Responsive */
    @media (max-width: 768px) {
      .content-rows { padding: 0 16px; }
      .mb-card { width: 140px; }
      #netflix-hero { height: 55vh; min-height: 320px; }
      .hero-info { left: 20px; right: 20px; bottom: 60px; }
      .hero-info h2 { font-size: 28px; }
      .hero-desc { font-size: 13px; -webkit-line-clamp: 2; }
      .detail-card { width: 95%; }
      #browse-grid { padding: 20px 16px; grid-template-columns: repeat(auto-fill, minmax(130px, 1fr)); gap: 8px; }
      header { padding: 12px 16px !important; }
      .skeleton-row { padding: 0 16px; }
      .skeleton-card { flex: 0 0 140px; height: 210px; }
      .browse-title { padding: 20px 16px 10px; }
    }
    @media (max-width: 480px) {
      .mb-card { width: 120px; }
      .hero-info h2 { font-size: 22px; }
      .hero-play-btn, .hero-info-btn { padding: 10px 20px; font-size: 14px; }
      .mode-tabs { margin-left: 8px; }
      #browse-grid { grid-template-columns: repeat(auto-fill, minmax(110px, 1fr)); }
    }
  `;
  document.head.appendChild(s);
}

function buildNetflixUI() {
  // Add mode tabs to header
  const headerLeft = document.querySelector('.header-left');
  const modeTabs = document.createElement('div');
  modeTabs.className = 'mode-tabs';
  modeTabs.innerHTML = `
    <button class="mode-tab active" data-mode="moviebox">🎬 Movies & Shows</button>
    <button class="mode-tab" data-mode="m3u">📺 Live TV</button>
  `;
  headerLeft.parentNode.insertBefore(modeTabs, document.getElementById('menu-btn'));

  // Add search to header
  const searchWrap = document.createElement('div');
  searchWrap.className = 'mb-search-wrap';
  searchWrap.innerHTML = `
    <span class="mb-search-icon">🔍</span>
    <input type="text" class="mb-search-input" id="mb-search" placeholder="Search movies & shows..." autocomplete="off">
  `;
  headerLeft.parentNode.insertBefore(searchWrap, modeTabs);

  // Build moviebox container
  const mbMode = document.createElement('div');
  mbMode.id = 'moviebox-mode';
  mbMode.innerHTML = `
    <div id="netflix-hero"></div>
    <div class="content-rows" id="mb-rows">
      <div class="skeleton-row"><div class="skeleton-card"></div><div class="skeleton-card"></div><div class="skeleton-card"></div><div class="skeleton-card"></div><div class="skeleton-card"></div></div>
      <div class="skeleton-row"><div class="skeleton-card"></div><div class="skeleton-card"></div><div class="skeleton-card"></div><div class="skeleton-card"></div><div class="skeleton-card"></div></div>
      <div class="skeleton-row"><div class="skeleton-card"></div><div class="skeleton-card"></div><div class="skeleton-card"></div><div class="skeleton-card"></div><div class="skeleton-card"></div></div>
    </div>
    <div id="browse-section" style="display:none;">
      <div class="browse-title">Browse All</div>
      <div id="browse-grid"></div>
    </div>
  `;

  // Build M3U container (wrap existing content)
  const m3uMode = document.createElement('div');
  m3uMode.id = 'm3u-mode';
  m3uMode.className = 'hidden';

  // Detail modal
  const modal = document.createElement('div');
  modal.id = 'detail-modal';
  modal.innerHTML = `
    <div class="detail-card">
      <button class="detail-close" id="detail-close">✕</button>
      <img class="detail-backdrop" id="detail-backdrop" src="" alt="">
      <div class="detail-body">
        <h2 id="detail-title"></h2>
        <div class="detail-meta-row" id="detail-meta"></div>
        <p class="detail-desc" id="detail-desc"></p>
        <div class="detail-actions">
          <button class="detail-play-btn" id="detail-play">▶ Play Trailer</button>
          <button class="detail-info-btn" id="detail-info-btn">ℹ️ Info</button>
        </div>
        <div class="detail-subtitles" id="detail-subs"></div>
      </div>
    </div>
  `;

  const app = els['app'];

  // Move existing sections into m3u mode
  const matchesSection = els['matches-section'];
  const heroSection = els['hero'];
  const playlistSection = els['playlist-section'];
  const channelsSection = els['channels-section'];

  // Create m3u-playlist-area wrapper
  const m3uPlaylistArea = document.createElement('div');
  m3uPlaylistArea.id = 'm3u-playlist-area';

  // Move elements into m3u mode
  if (matchesSection) m3uPlaylistArea.appendChild(matchesSection);
  if (heroSection) m3uPlaylistArea.appendChild(heroSection);
  if (playlistSection) m3uPlaylistArea.appendChild(playlistSection);
  if (channelsSection) m3uPlaylistArea.appendChild(channelsSection);

  m3uMode.appendChild(m3uPlaylistArea);

  // Insert new elements
  app.insertBefore(mbMode, app.querySelector('main') || app.children[1]);
  app.insertBefore(m3uMode, mbMode.nextSibling);
  app.appendChild(modal);

  // Mode switching
  document.querySelectorAll('.mode-tab').forEach(tab => {
    tab.addEventListener('click', function() {
      document.querySelectorAll('.mode-tab').forEach(t => t.classList.remove('active'));
      this.classList.add('active');
      currentMode = this.dataset.mode;
      const mbEl = document.getElementById('moviebox-mode');
      const m3uEl = document.getElementById('m3u-mode');
      if (currentMode === 'moviebox') {
        mbEl.classList.remove('hidden');
        m3uEl.classList.add('hidden');
        document.querySelector('.mb-search-wrap').style.display = '';
      } else {
        mbEl.classList.add('hidden');
        m3uEl.classList.remove('hidden');
        document.querySelector('.mb-search-wrap').style.display = 'none';
      }
    });
  });

  // Detail modal events
  document.getElementById('detail-close').addEventListener('click', closeDetail);
  modal.addEventListener('click', function(e) {
    if (e.target === modal) closeDetail();
  });
  document.getElementById('detail-play').addEventListener('click', function() {
    const url = this.dataset.trailerUrl;
    if (url) playTrailer(url, document.getElementById('detail-title').textContent);
  });
}

// ==================== Hero Banner ====================
function renderHero(items) {
  const container = document.getElementById('netflix-hero');
  if (!container || !items.length) return;

  mbHeroItems = items.slice(0, 6);
  let html = '';

  mbHeroItems.forEach((item, i) => {
    const cover = (item.stills && item.stills.url) || (item.cover && item.cover.url) || '';
    const bgUrl = cover || '';
    html += `
      <div class="hero-slide ${i === 0 ? 'active' : ''}" data-index="${i}">
        <div class="hero-bg" style="background-image:url('${bgUrl}')"></div>
        <div class="hero-info">
          <div class="hero-badge">🎬 Featured</div>
          <h2>${escHtml(item.title)}</h2>
          <div class="hero-meta">
            ${item.imdbRatingValue ? '<span class="hero-rating">⭐ ' + item.imdbRatingValue + '</span>' : ''}
            ${item.releaseDate ? '<span class="hero-year">' + item.releaseDate.substring(0,4) + '</span>' : ''}
            ${item.genre ? '<span class="hero-genre">' + escHtml(item.genre.split(',')[0]) + '</span>' : ''}
            ${item.countryName ? '<span class="hero-country">' + escHtml(item.countryName) + '</span>' : ''}
          </div>
          <p class="hero-desc">${escHtml(item.description || item.postTitle || '')}</p>
          <div class="hero-actions">
            <button class="hero-play-btn" data-detail-path="${item.detailPath}">▶ Watch Trailer</button>
            <button class="hero-info-btn" data-detail-path="${item.detailPath}">ℹ️ More Info</button>
          </div>
        </div>
      </div>
    `;
  });

  // Dots
  html += '<div class="hero-dots">';
  mbHeroItems.forEach((_, i) => {
    html += `<div class="hero-dot ${i === 0 ? 'active' : ''}" data-index="${i}"></div>`;
  });
  html += '</div>';

  container.innerHTML = html;

  // Hero click events
  container.querySelectorAll('.hero-play-btn').forEach(btn => {
    btn.addEventListener('click', async function(e) {
      e.stopPropagation();
      const dp = this.dataset.detailPath;
      const subject = await mbGetDetail(dp);
      if (subject && subject.trailer && subject.trailer.videoAddress) {
        playTrailer(subject.trailer.videoAddress.url, subject.title);
      }
    });
  });
  container.querySelectorAll('.hero-info-btn').forEach(btn => {
    btn.addEventListener('click', async function(e) {
      e.stopPropagation();
      const dp = this.dataset.detailPath;
      const subject = await mbGetDetail(dp);
      if (subject) showDetail(subject);
    });
  });

  // Click on hero slide to show detail
  container.querySelectorAll('.hero-slide').forEach(slide => {
    slide.addEventListener('click', async function(e) {
      if (e.target.closest('.hero-play-btn') || e.target.closest('.hero-info-btn')) return;
      const idx = parseInt(this.dataset.index);
      const item = mbHeroItems[idx];
      if (item) {
        const subject = await mbGetDetail(item.detailPath);
        if (subject) showDetail(subject);
      }
    });
  });

  // Dot navigation
  container.querySelectorAll('.hero-dot').forEach(dot => {
    dot.addEventListener('click', function(e) {
      e.stopPropagation();
      goToHeroSlide(parseInt(this.dataset.index));
    });
  });

  // Auto-rotate
  startHeroRotation();
}

function goToHeroSlide(index) {
  const slides = document.querySelectorAll('.hero-slide');
  const dots = document.querySelectorAll('.hero-dot');
  slides.forEach(s => s.classList.remove('active'));
  dots.forEach(d => d.classList.remove('active'));
  if (slides[index]) slides[index].classList.add('active');
  if (dots[index]) dots[index].classList.add('active');
  heroIndex = index;
}

function startHeroRotation() {
  if (heroTimer) clearInterval(heroTimer);
  heroTimer = setInterval(() => {
    heroIndex = (heroIndex + 1) % mbHeroItems.length;
    goToHeroSlide(heroIndex);
  }, 8000);
}

// ==================== Content Rows ====================
function renderRows() {
  const container = document.getElementById('mb-rows');
  if (!container) return;
  container.innerHTML = '';

  const rowDefs = [
    { id: 70, title: '🔥 Trending Now' },
    { id: 10, title: '⭐ Popular' },
    { id: 20, title: '🆕 New Releases' },
    { id: 30, title: '🎭 Top Rated' },
  ];

  rowDefs.forEach(def => {
    const row = document.createElement('div');
    row.className = 'mb-row';
    row.innerHTML = `
      <div class="mb-row-header">
        <h3>${def.title}</h3>
        <span class="mb-row-see-all" data-subject-id="${def.id}">See All →</span>
      </div>
      <div class="mb-row-scroll" id="row-${def.id}">
        <div class="skeleton-card"></div><div class="skeleton-card"></div><div class="skeleton-card"></div><div class="skeleton-card"></div><div class="skeleton-card"></div>
      </div>
    `;
    container.appendChild(row);

    // Load items
    mbGetRecs(def.id, 1, 20).then(items => {
      const scrollEl = document.getElementById('row-' + def.id);
      if (!scrollEl || !items.length) {
        if (scrollEl) scrollEl.innerHTML = '<div style="color:rgba(255,255,255,0.3);padding:20px;">No content available</div>';
        return;
      }
      scrollEl.innerHTML = '';
      items.forEach(item => {
        mbAllItems.push(item);
        scrollEl.appendChild(createCard(item));
      });

      // Add row scroll arrows on hover (desktop)
      addScrollArrows(scrollEl);
    });
  });

  // See All links
  setTimeout(() => {
    document.querySelectorAll('.mb-row-see-all').forEach(link => {
      link.addEventListener('click', function() {
        const subjectId = this.dataset.subjectId;
        showBrowseAll(subjectId);
      });
    });
  }, 500);
}

function addScrollArrows(scrollEl) {
  // Add left/right scroll buttons on desktop
  const parent = scrollEl.parentNode;
  parent.style.position = 'relative';

  const leftBtn = document.createElement('button');
  leftBtn.innerHTML = '‹';
  leftBtn.style.cssText = 'position:absolute;left:-16px;top:40px;width:36px;height:36px;border-radius:50%;background:rgba(0,0,0,0.7);border:none;color:#fff;font-size:24px;cursor:pointer;z-index:5;display:none;align-items:center;justify-content:center;';
  leftBtn.addEventListener('click', () => scrollEl.scrollBy({left: -600, behavior: 'smooth'}));

  const rightBtn = document.createElement('button');
  rightBtn.innerHTML = '›';
  rightBtn.style.cssText = 'position:absolute;right:-16px;top:40px;width:36px;height:36px;border-radius:50%;background:rgba(0,0,0,0.7);border:none;color:#fff;font-size:24px;cursor:pointer;z-index:5;display:none;align-items:center;justify-content:center;';
  rightBtn.addEventListener('click', () => scrollEl.scrollBy({left: 600, behavior: 'smooth'}));

  parent.appendChild(leftBtn);
  parent.appendChild(rightBtn);

  if (window.innerWidth > 768) {
    parent.addEventListener('mouseenter', () => { leftBtn.style.display = 'flex'; rightBtn.style.display = 'flex'; });
    parent.addEventListener('mouseleave', () => { leftBtn.style.display = 'none'; rightBtn.style.display = 'none'; });
  }
}

// ==================== Card ====================
function createCard(item) {
  const card = document.createElement('div');
  card.className = 'mb-card';
  const coverUrl = (item.cover && item.cover.url) || '';
  card.innerHTML = `
    <img class="mb-card-img" src="${escAttr(coverUrl)}" alt="${escAttr(item.title)}" loading="lazy" onerror="this.src='data:image/svg+xml,%3Csvg xmlns=\\'http://www.w3.org/2000/svg\\' viewBox=\\'0 0 200 300\\'%3E%3Crect fill=\\'%231a1a2e\\' width=\\'200\\' height=\\'300\\'/%3E%3Ctext x=\\'100\\' y=\\'150\\' text-anchor=\\'middle\\' fill=\\'%23555\\' font-size=\\'14\\'%3ENo Image%3C/text%3E%3C/svg%3E'">
    <div class="mb-card-play">▶</div>
    <div class="mb-card-overlay">
      <div class="mb-card-title">${escHtml(item.title)}</div>
      ${item.imdbRatingValue ? '<div class="mb-card-rating">⭐ ' + item.imdbRatingValue + '</div>' : ''}
    </div>
  `;
  card.addEventListener('click', async () => {
    const subject = await mbGetDetail(item.detailPath);
    if (subject) showDetail(subject);
  });
  return card;
}

// ==================== Detail Modal ====================
let currentDetail = null;

function showDetail(subject) {
  currentDetail = subject;
  const modal = document.getElementById('detail-modal');
  const cover = (subject.stills && subject.stills.url) || (subject.cover && subject.cover.url) || '';
  document.getElementById('detail-backdrop').src = cover;
  document.getElementById('detail-title').textContent = subject.title || 'Untitled';

  // Meta
  const metaHtml = [];
  if (subject.imdbRatingValue) metaHtml.push('<span class="detail-rating">⭐ ' + subject.imdbRatingValue + '</span>');
  if (subject.releaseDate) metaHtml.push('<span class="detail-tag">' + subject.releaseDate.substring(0,4) + '</span>');
  if (subject.genre) {
    subject.genre.split(',').slice(0,3).forEach(g => {
      metaHtml.push('<span class="detail-tag">' + escHtml(g.trim()) + '</span>');
    });
  }
  if (subject.countryName) metaHtml.push('<span class="detail-tag">' + escHtml(subject.countryName) + '</span>');
  document.getElementById('detail-meta').innerHTML = metaHtml.join('');

  // Description
  document.getElementById('detail-desc').textContent = subject.description || subject.postTitle || 'No description available.';

  // Subtitles
  if (subject.subtitles) {
    const subs = subject.subtitles.split(',').slice(0, 8).join(', ');
    document.getElementById('detail-subs').innerHTML = '<span>Subtitles:</span> ' + escHtml(subs);
  } else {
    document.getElementById('detail-subs').innerHTML = '';
  }

  // Play button
  const playBtn = document.getElementById('detail-play');
  if (subject.trailer && subject.trailer.videoAddress && subject.trailer.videoAddress.url) {
    playBtn.dataset.trailerUrl = subject.trailer.videoAddress.url;
    playBtn.style.display = '';
  } else {
    playBtn.style.display = 'none';
  }

  modal.classList.add('show');
  document.body.style.overflow = 'hidden';
}

function closeDetail() {
  document.getElementById('detail-modal').classList.remove('show');
  document.body.style.overflow = '';
  currentDetail = null;
}

// ==================== Video Player ====================
function playTrailer(url, title) {
  els['player-channel-name'].textContent = title || 'Trailer';
  els['player-error'].classList.add('hidden');
  els['player-overlay'].classList.remove('hidden');
  document.body.style.overflow = 'hidden';

  if (hls) { hls.destroy(); hls = null; }

  const isHLS = url.includes('.m3u8');
  const onErr = () => els['player-error'].classList.remove('hidden');

  if (isHLS && window.Hls && Hls.isSupported()) {
    hls = new Hls();
    hls.loadSource(url);
    hls.attachMedia(els['video-player']);
    hls.on(Hls.Events.ERROR, (_, d) => { if (d.fatal) onErr(); });
  } else if (isHLS && els['video-player'].canPlayType('application/vnd.apple.mpegurl')) {
    els['video-player'].src = url;
  } else {
    els['video-player'].src = url;
  }
  els['video-player'].play().catch(() => {});
}

els['close-player'].addEventListener('click', function() {
  els['player-overlay'].classList.add('hidden');
  document.body.style.overflow = '';
  if (hls) { hls.destroy(); hls = null; }
  els['video-player'].pause();
  els['video-player'].src = '';
});
els['retry-btn'].addEventListener('click', function() {
  var n = els['player-channel-name'].textContent;
  var ch = channels.find(function(c) { return c.name === n; });
  if (ch) playM3UChannel(ch);
});

// ==================== Browse All ====================
async function showBrowseAll(subjectId) {
  const browseSection = document.getElementById('browse-section');
  const browseGrid = document.getElementById('browse-grid');
  if (!browseSection || !browseGrid) return;

  browseSection.style.display = '';
  browseGrid.innerHTML = '<div class="skeleton-card" style="width:100%;height:200px;grid-column:1/-1;"></div>';

  // Scroll to browse
  browseSection.scrollIntoView({ behavior: 'smooth' });

  const items = await mbGetRecs(subjectId, 1, 40);
  browseGrid.innerHTML = '';
  if (!items.length) {
    browseGrid.innerHTML = '<div style="color:rgba(255,255,255,0.3);text-align:center;padding:40px;grid-column:1/-1;">No content available</div>';
    return;
  }
  items.forEach(item => {
    browseGrid.appendChild(createCard(item));
  });
}

// ==================== Search ====================
let searchTimeout = null;
function setupSearch() {
  const input = document.getElementById('mb-search');
  if (!input) return;
  input.addEventListener('input', function() {
    clearTimeout(searchTimeout);
    const q = this.value.trim();
    if (!q) {
      // Reset to normal rows
      document.getElementById('mb-rows').style.display = '';
      document.getElementById('browse-section').style.display = 'none';
      return;
    }
    searchTimeout = setTimeout(() => doSearch(q), 400);
  });
}

async function doSearch(query) {
  const rows = document.getElementById('mb-rows');
  const browseGrid = document.getElementById('browse-grid');
  const browseSection = document.getElementById('browse-section');

  rows.style.display = 'none';
  browseSection.style.display = '';
  browseGrid.innerHTML = '<div class="skeleton-card" style="width:100%;height:200px;grid-column:1/-1;"></div>';

  // Search suggestions API
  const suggestions = await mbSearch(query);

  // Also search all cached items by title
  const q = query.toLowerCase();
  let results = mbAllItems.filter(item =>
    item.title && item.title.toLowerCase().includes(q)
  );

  // If suggestions found, try to get detail for each
  if (suggestions.length && results.length < 10) {
    for (const s of suggestions.slice(0, 5)) {
      if (!results.find(r => r.title === s.title)) {
        // Try to find in cache or add placeholder
        const cached = mbAllItems.find(r => r.title === s.title);
        if (cached) results.push(cached);
      }
    }
  }

  // De-duplicate
  const seen = new Set();
  results = results.filter(item => {
    if (seen.has(item.subjectId)) return false;
    seen.add(item.subjectId);
    return true;
  });

  browseGrid.innerHTML = '';
  if (!results.length) {
    browseGrid.innerHTML = '<div style="color:rgba(255,255,255,0.3);text-align:center;padding:40px;grid-column:1/-1;">No results for "' + escHtml(query) + '"</div>';
    return;
  }
  results.forEach(item => {
    browseGrid.appendChild(createCard(item));
  });
}

// ==================== M3U (existing functionality) ====================
function watchMatch(home, away) {
  document.querySelectorAll('.pill-btn').forEach(function(b) { b.classList.remove('active'); });
  var isCanada = (home.toLowerCase().indexOf('canada') >= 0) || (away.toLowerCase().indexOf('canada') >= 0);
  var existingChannel = channels.find(function(c) {
    if (isCanada) return c.name && c.name.indexOf('TSN') >= 0 && c.url;
    return c.name && c.name.indexOf('FIFA+ English') >= 0 && c.url;
  });
  if (existingChannel) {
    playM3UChannel(existingChannel);
    els['channels-section'].scrollIntoView({ behavior: 'smooth' });
    return;
  }
  loadM3UPlaylist('worldcup').then(function() {
    var best;
    if (isCanada) {
      best = channels.find(function(c) { return c.name && c.name.indexOf('TSN') >= 0 && c.url; });
    }
    if (!best) {
      best = channels.find(function(c) { return c.url && c.name.indexOf('FIFA+') >= 0 && c.url; });
    }
    if (!best) {
      best = channels.find(function(c) { return c.url; });
    }
    if (best) {
      setTimeout(function() { playM3UChannel(best); }, 500);
    }
    els['channels-section'].scrollIntoView({ behavior: 'smooth' });
  });
}

// M3U Parser
function parseM3U(text) {
  const result = []; let cur = {};
  (text||'').split('\n').forEach(line => {
    const t = line.trim();
    if (t.startsWith('#EXTINF:')) {
      cur = {};
      const a = t.match(/#EXTINF:-?\d+(?:\.\d+)?(.*?)$/);
      if (a) {
        const s = a[1];
        const m = s.match(/tvg-id="([^"]*)"/); if (m) cur.id = m[1];
        const l = s.match(/tvg-logo="([^"]*)"/); if (l) cur.logo = l[1];
        const g = s.match(/group-title="([^"]*)"/); if (g) cur.category = g[1];
        const n = t.match(/,([^,]+)$/); if (n) cur.name = n[1].trim();
      }
    } else if (t.startsWith('http') && cur.name) {
      cur.url = t; result.push(Object.assign({}, cur)); cur = {};
    }
  });
  return result;
}

async function loadM3UPlaylist(url) {
  if (isLoading) return;
  isLoading = true;
  setM3UStatus('loading', '⏳ Loading channels...');
  try {
    let text;
    if (url === 'worldcup') {
      text = '#EXTM3U\n';
      text += '#EXTINF:-1 tvg-logo="https://i.imgur.com/AYza8KO.png" group-title="🇨🇦 Canada - World Cup",TSN3 (Canada)\n';
      text += 'https://tsn1.shaanp76.workers.dev/\n';
      text += '#EXTINF:-1 tvg-logo="https://upload.wikimedia.org/wikipedia/commons/thumb/9/9c/FIFA%2B_(2025).svg/960px-FIFA%2B_(2025).svg.png" group-title="⚽ World Cup",FIFA+ English (Official)\n';
      text += 'https://d2w9q46ikgrcwx.cloudfront.net/v1/master/3722c60a815c199d9c0ef36c5b73da68a62b09d1/cc-of5cbk3sav3w5/v1/sysdata_s_p_a_fifa_7/samsungheadend_us/latest/main/hls/playlist.m3u8\n';
      var langs = ['United States','French','German','Spain','Portuguese','Italy','Hispanic America'];
      langs.forEach(function(l) {
        text += '#EXTINF:-1 tvg-logo="https://upload.wikimedia.org/wikipedia/commons/thumb/9/9c/FIFA%2B_(2025).svg/960px-FIFA%2B_(2025).svg.png" group-title="⚽ World Cup",FIFA+ ' + l + '\n';
      });
      text += '#EXTINF:-1 tvg-logo="https://upload.wikimedia.org/wikipedia/commons/thumb/0/0c/FOX_Sports_logo.svg/960px-FOX_Sports_logo.svg.png" group-title="⚽ World Cup",FOX Sports (US)\n';
      text += '#EXTINF:-1 tvg-logo="https://upload.wikimedia.org/wikipedia/commons/thumb/d/d6/BeIN_Sports_logo.svg/500px-BeIN_Sports_logo.svg.png" group-title="⚽ World Cup",beIN Sports USA\n';
      text += '#EXTINF:-1 tvg-logo="https://i.imgur.com/q8BENJg.png" group-title="⚽ World Cup",CBS Sports HQ (US)\n';
      text += '#EXTINF:-1 tvg-logo="https://i.imgur.com/EzNf2Yx.png" group-title="⚽ World Cup",NBC Sports NOW (US)\n';
      text += '#EXTINF:-1 tvg-logo="https://upload.wikimedia.org/wikipedia/commons/thumb/d/d5/ESPN_Deportes.svg/960px-ESPN_Deportes.svg.png" group-title="⚽ World Cup",ESPN Deportes (US)\n';
      text += '#EXTINF:-1 tvg-logo="https://upload.wikimedia.org/wikipedia/commons/e/eb/Canal%2BFoot.png" group-title="⚽ World Cup",Canal+ Foot (France)\n';
      text += '#EXTINF:-1 tvg-logo="https://upload.wikimedia.org/wikipedia/commons/thumb/9/9c/FIFA%2B_(2025).svg/960px-FIFA%2B_(2025).svg.png" group-title="⚽ World Cup",FIFA+ Women\n';
    } else {
      const ac = new AbortController();
      setTimeout(() => ac.abort(), 10000);
      const r = await fetch(url, { signal: ac.signal });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      text = await r.text();
    }
    channels = parseM3U(text);
    if (!channels.filter(c => c.url).length) throw new Error('No working URLs');
    categories = new Set(channels.map(c => c.category).filter(Boolean));
    updateM3UTabs();
    setM3UStatus('success', '✅ ' + channels.filter(c=>c.url).length + ' channels');
    applyM3UFilters();
    els['channels-section'].classList.remove('hidden');
    isLoading = false;
  } catch(e) {
    if (url === 'worldcup') {
      loadM3UPlaylist('https://iptv-org.github.io/iptv/categories/sports.m3u');
      return;
    }
    setM3UStatus('error', '❌ Could not load. Try pasting an M3U URL.');
    isLoading = false;
  }
}

function setM3UStatus(type, msg) {
  const el = els['playlist-status'];
  if (!el) return;
  el.className = ''; el.classList.add(type); el.textContent = msg;
}

function updateM3UTabs() {
  const tabs = els['category-tabs'];
  if (!tabs) return;
  tabs.innerHTML = '<span class="cat-tab active" data-cat="all">🏁 All</span>';
  [...categories].sort().forEach(c => {
    tabs.innerHTML += '<span class="cat-tab" data-cat="' + c.replace(/"/g,'') + '">' + c + '</span>';
  });
  tabs.querySelectorAll('.cat-tab').forEach(tab => {
    tab.addEventListener('click', function() {
      tabs.querySelectorAll('.cat-tab').forEach(t => t.classList.remove('active'));
      this.classList.add('active');
      selectedCategory = this.dataset.cat;
      applyM3UFilters();
    });
  });
}

function applyM3UFilters() {
  searchQuery = (els['search-input'].value || '').toLowerCase().trim();
  filteredChannels = channels.filter(c =>
    c.name.toLowerCase().includes(searchQuery) &&
    (selectedCategory === 'all' || c.category === selectedCategory)
  );
  const list = els['channel-list'];
  list.innerHTML = '';
  if (!filteredChannels.length) {
    list.innerHTML = '<div class="empty-state">No channels</div>';
    els['channel-count'].textContent = '0';
    return;
  }
  els['channel-count'].textContent = '' + filteredChannels.length;
  filteredChannels.forEach(ch => {
    const el = document.createElement('div');
    el.className = 'channel-item';
    el.innerHTML = '<img class="channel-logo" src="' + (ch.logo||'') + '" alt="" onerror="this.style.display=\'none\'">' +
      '<div class="channel-info"><div class="channel-name">' + ch.name + '<span class="live-badge">LIVE</span></div>' +
      '<div class="channel-meta">' + (ch.category||'Sport') + '</div></div><span class="channel-play">▶</span>';
    el.addEventListener('click', function() { playM3UChannel(ch); });
    list.appendChild(el);
  });
}

function playM3UChannel(ch) {
  if (!ch || !ch.url) return;
  els['player-channel-name'].textContent = ch.name || 'Channel';
  els['player-error'].classList.add('hidden');
  els['player-overlay'].classList.remove('hidden');
  document.body.style.overflow = 'hidden';
  if (hls) { hls.destroy(); hls = null; }
  const isHLS = ch.url.includes('.m3u8');
  const onErr = function() { els['player-error'].classList.remove('hidden'); };
  if (isHLS && window.Hls && Hls.isSupported()) {
    hls = new Hls();
    hls.loadSource(ch.url);
    hls.attachMedia(els['video-player']);
    hls.on(Hls.Events.ERROR, function(_, d) { if (d.fatal) onErr(); });
  } else if (isHLS && els['video-player'].canPlayType('application/vnd.apple.mpegurl')) {
    els['video-player'].src = ch.url;
  } else if (!isHLS) {
    els['video-player'].src = ch.url;
  } else {
    onErr();
  }
  els['video-player'].play().catch(function(){});
}

// ==================== UI Events ====================
document.querySelectorAll('.pill-btn').forEach(function(btn) {
  btn.addEventListener('click', function(e) {
    if (btn.classList.contains('external')) return;
    document.querySelectorAll('.pill-btn').forEach(function(b) { b.classList.remove('active'); });
    btn.classList.add('active');
    loadM3UPlaylist(btn.dataset.url);
  });
});

els['load-btn'].addEventListener('click', function() {
  var u = els['playlist-url'].value.trim();
  if (u) loadM3UPlaylist(u);
});

els['search-input'].addEventListener('input', applyM3UFilters);

els['hero-watch-btn'].addEventListener('click', function() {
  document.querySelectorAll('.pill-btn').forEach(function(b) { b.classList.remove('active'); });
  loadM3UPlaylist('worldcup');
  els['channels-section'].scrollIntoView({ behavior: 'smooth' });
});

// ==================== Helpers ====================
function escHtml(s) {
  if (!s) return '';
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function escAttr(s) {
  if (!s) return '';
  return s.replace(/'/g,'&#39;').replace(/"/g,'&quot;');
}

// ==================== Init ====================
function initApp() {
  injectNetflixStyles();
  buildNetflixUI();
  setupSearch();

  // Fetch content for hero and rows
  setTimeout(async () => {
    // Get hero items from subjectId=70 (first page)
    const heroItems = await mbGetRecs(70, 1, 10);
    renderHero(heroItems);

    // Render content rows (also fetches from various subjectIds)
    renderRows();
  }, 200);

  // Also init M3U mode data (matches, etc.)
  setTimeout(function() {
    fetchMatches();
    matchInterval = setInterval(fetchMatches, 30000);
    loadM3UPlaylist('worldcup');
  }, 400);
}

// ==================== World Cup API (M3U mode) ====================
async function fetchMatches() {
  try {
    const ac = new AbortController();
    setTimeout(() => ac.abort(), 5000);
    const r = await fetch('https://worldcup26.ir/get/games', { signal: ac.signal });
    const data = await r.json();
    const games = data.games || data.data || [];
    const canadaGames = games.filter(g => {
      const name = (g.home_team_name_en + ' ' + g.away_team_name_en).toLowerCase();
      return name.includes('canada');
    });
    const otherGames = games.filter(g => {
      const name = (g.home_team_name_en + ' ' + g.away_team_name_en).toLowerCase();
      return !name.includes('canada');
    });
    var liveOthers = otherGames.filter(function(g) { return g.time_elapsed === 'live'; });
    var todayOthers = otherGames.filter(function(g) {
      return (g.local_date||'').startsWith('06/') && g.time_elapsed !== 'notstarted';
    });
    liveMatches = canadaGames.concat(liveOthers).concat(todayOthers).slice(0, 10);
    renderMatches();
  } catch(e) {
    if (els['matches-grid']) els['matches-grid'].innerHTML = '<div class="empty-state">Scores unavailable</div>';
  }
}

function renderMatches() {
  if (!els['matches-grid'] || !liveMatches.length) return;
  const groups = {};
  liveMatches.forEach(function(g) {
    var name = (g.home_team_name_en + ' ' + g.away_team_name_en).toLowerCase();
    var grp = name.includes('canada') ? '🇨🇦 Canada' : 'Group ' + (g.group || '');
    if (!groups[grp]) groups[grp] = [];
    groups[grp].push(g);
  });
  els['matches-grid'].innerHTML = Object.entries(groups).map(function(e) {
    var grp = e[0], games = e[1];
    var isCanada = grp === '🇨🇦 Canada';
    return '<div class="match-group' + (isCanada ? ' canada-group' : '') + '"><div class="match-group-header">' + grp + ' <span class="match-count">' + games.length + '</span></div>' +
    games.map(function(g) {
      var isLive = g.time_elapsed === 'live', isFinished = g.finished === 'TRUE';
      var hs = g.home_score||'0', as = g.away_score||'0';
      var status = isLive ? '🔴 LIVE' : isFinished ? '⏱ FT' : '⏳';
      var home = g.home_team_name_en || '?', away = g.away_team_name_en || '?';
      return '<div class="match-row' + (isCanada ? ' canada-row' : '') + '" onclick="watchMatch(\'' + home + '\',\'' + away + '\')">' +
        '<div class="match-row-status ' + (isLive?'live':isFinished?'ft':'') + '">' + status + '</div>' +
        '<div class="match-row-teams">' +
        '<div class="match-row-team ' + (hs>as&&isFinished?'winner':'') + '"><span class="team-name">' + home + '</span><span class="team-score">' + hs + '</span></div>' +
        '<div class="match-row-team ' + (as>hs&&isFinished?'winner':'') + '"><span class="team-name">' + away + '</span><span class="team-score">' + as + '</span></div>' +
        '</div>' + (!isFinished ? '<div class="match-row-mini">▶ Watch</div>' : '<div class="match-row-mini">📊</div>') +
        '</div>';
    }).join('') + '</div>';
  }).join('');
}

// Expose watchMatch globally for onclick handlers
window.watchMatch = watchMatch;

// Service Worker
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(function(){});
}
