// ==================== StreamWrap Web — Netflix-Style App ====================
// Complete rewrite using TMDB API + VidSrc embeds (no auth needed)

// ==================== CONFIG ====================
const TMDB_KEY = '086323fee7102f209a9c773da9381ea1';
const TMDB_BASE = 'https://api.themoviedb.org/3';
const IMG_POSTER = 'https://image.tmdb.org/t/p/w500';
const IMG_BACKDROP = 'https://image.tmdb.org/t/p/w1280';
const STREAMWRAP_PASSWORD = 'iamcool';

const EMBED_PROVIDERS = [
  { name: 'VidSrc', base: 'https://vidsrc-embed.ru/embed' },
  { name: 'VidCore', base: 'https://vidcore.net' },
  { name: 'VideoEasy', base: 'https://player.videasy.net' },
  { name: 'Peachify', base: 'https://peachify.top/embed' },
  { name: 'VidGod', base: 'https://vidgod.net' },
  { name: 'Vidify', base: 'https://player.vidify.top/embed' },
];

// ==================== CACHE ====================
const apiCache = new Map();

// ==================== STATE ====================
let currentMode = 'movies'; // 'movies' | 'livetv'
let heroItems = [];
let heroIndex = 0;
let heroInterval = null;
let currentFilter = 'all';
let myList = JSON.parse(localStorage.getItem('sw-mylist') || '[]');
let hlsInstance = null;
let currentDetailItem = null;
let searchTimeout = null;

// ==================== PASSWORD GATE ====================
(function initPasswordGate() {
  const gate = document.getElementById('password-gate');
  const app = document.getElementById('app');
  const loading = document.getElementById('loading-screen');

  if (sessionStorage.getItem('sw-unlocked')) {
    if (loading) loading.classList.add('hidden');
    if (gate) gate.classList.add('hidden');
    if (app) app.classList.remove('hidden');
    initApp();
    return;
  }

  if (loading) loading.classList.add('hidden');
  if (gate) gate.classList.remove('hidden');

  function tryUnlock() {
    const pw = document.getElementById('gate-password').value;
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

// ==================== APP INIT ====================
function initApp() {
  injectStyles();
  buildAppHTML();
  setupModeTabs();
  setupSearch();
  setupNavigation();
  loadMovieTV();
  registerServiceWorker();
}

// ==================== INJECT DYNAMIC STYLES ====================
function injectStyles() {
  const style = document.createElement('style');
  style.textContent = `
    .skeleton { background: linear-gradient(90deg, #1a1a1a 25%, #2a2a2a 50%, #1a1a1a 75%); background-size: 200% 100%; animation: shimmer 1.5s infinite; border-radius: 6px; }
    @keyframes shimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }
    .skeleton-card { width: 200px; flex: 0 0 auto; }
    .skeleton-card .skeleton-poster { width: 100%; aspect-ratio: 2/3; border-radius: 6px; }
    .skeleton-card .skeleton-text { height: 14px; margin-top: 8px; width: 80%; }
    .skeleton-card .skeleton-text-sm { height: 10px; margin-top: 4px; width: 50%; }
    .error-state { text-align: center; padding: 40px; color: #b3b3b3; }
    .error-state .error-icon { font-size: 48px; margin-bottom: 12px; }
    .error-state .error-msg { font-size: 16px; margin-bottom: 16px; }
    .retry-btn { padding: 10px 24px; background: #e50914; color: #fff; border: none; border-radius: 6px; font-size: 14px; font-weight: 600; cursor: pointer; font-family: inherit; }
    .retry-btn:hover { background: #f40612; }
    .search-results-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); gap: 12px; padding: 0 0 32px; }
    .scroll-top-btn { position: fixed; bottom: 24px; right: 24px; width: 48px; height: 48px; border-radius: 50%; background: #e50914; color: #fff; border: none; font-size: 20px; cursor: pointer; z-index: 999; display: none; align-items: center; justify-content: center; box-shadow: 0 4px 20px rgba(229,9,20,0.5); transition: opacity 0.3s, transform 0.3s; }
    .scroll-top-btn.visible { display: flex; }
    .scroll-top-btn:hover { transform: scale(1.1); }
    .tv-episode-panel { padding: 20px 32px; }
    .tv-episode-panel h4 { color: #b3b3b3; font-size: 14px; margin-bottom: 12px; }
    .season-select { padding: 8px 16px; background: #222; color: #fff; border: 1px solid #444; border-radius: 6px; font-size: 14px; font-family: inherit; margin-bottom: 16px; }
    .episode-list { display: flex; flex-direction: column; gap: 8px; max-height: 300px; overflow-y: auto; }
    .episode-item { display: flex; align-items: center; gap: 12px; padding: 10px 14px; background: #222; border-radius: 6px; cursor: pointer; transition: background 0.2s; }
    .episode-item:hover { background: #333; }
    .episode-number { font-size: 13px; font-weight: 700; color: #e50914; min-width: 24px; }
    .episode-info { flex: 1; }
    .episode-name { font-size: 14px; font-weight: 600; color: #fff; }
    .episode-overview { font-size: 12px; color: #808080; margin-top: 2px; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
    .provider-select { padding: 8px 16px; background: #222; color: #fff; border: 1px solid #444; border-radius: 6px; font-size: 14px; font-family: inherit; margin-bottom: 12px; }
    .player-iframe { width: 100%; height: 100%; border: none; }
    .genre-badge { display: inline-block; padding: 3px 10px; background: rgba(229,9,20,0.15); color: #e50914; border-radius: 20px; font-size: 12px; font-weight: 600; }
    .cast-list { color: #b3b3b3; font-size: 13px; margin-top: 8px; }
    .cast-list strong { color: #fff; }
    @media (max-width: 768px) {
      .search-results-grid { grid-template-columns: repeat(auto-fill, minmax(130px, 1fr)); gap: 8px; }
      .hero-banner { height: 50vh !important; min-height: 300px !important; }
      .hero-banner-title { font-size: 28px !important; }
      .hero-banner-content { left: 20px !important; right: 20% !important; bottom: 60px !important; }
      .movie-card { width: 140px !important; }
      .detail-modal { margin: 12px !important; }
      .detail-modal-content { padding: 0 20px 20px !important; }
      .detail-modal-title { font-size: 24px !important; }
    }
    @media (max-width: 480px) {
      .movie-card { width: 120px !important; }
      .hero-banner { height: 45vh !important; min-height: 260px !important; }
      .hero-banner-title { font-size: 22px !important; }
      .hero-banner-content { left: 16px !important; right: 16px !important; bottom: 50px !important; }
      .hero-banner-description { display: none !important; }
      .tv-episode-panel { padding: 16px; }
    }
  `;
  document.head.appendChild(style);
}

// ==================== BUILD APP HTML ====================
function buildAppHTML() {
  const app = document.getElementById('app');
  app.innerHTML = `
    <header id="main-header">
      <div class="header-left">
        <h1 style="background:linear-gradient(135deg,#e50914,#ff6b35);-webkit-background-clip:text;-webkit-text-fill-color:transparent;font-size:24px;font-weight:800;cursor:pointer;" onclick="resetToHome()">StreamWrap</h1>
      </div>
      <div class="netflix-search" id="search-bar">
        <span class="netflix-search-icon">🔍</span>
        <input type="text" id="search-input" placeholder="Search movies & TV shows..." autocomplete="off">
        <button class="netflix-search-clear" id="search-clear">✕</button>
      </div>
      <nav id="header-nav">
        <button class="nav-tab active" data-filter="all">🎬 All</button>
        <button class="nav-tab" data-filter="movies">Movies</button>
        <button class="nav-tab" data-filter="tv">TV Shows</button>
      </nav>
    </header>

    <div id="mode-tabs" class="nav-tabs" style="max-width:1200px;margin:0 auto 24px;">
      <button class="nav-tab active" data-mode="movies">🎬 Movies & Shows</button>
      <button class="nav-tab" data-mode="livetv">📺 Live TV</button>
    </div>

    <div id="main-content" style="max-width:1200px;margin:0 auto;padding:0 16px 80px;">
      <div id="hero-section"></div>
      <div id="content-rows"></div>
      <div id="search-results" class="hidden"></div>
    </div>

    <div id="livetv-content" class="hidden" style="max-width:1200px;margin:0 auto;padding:0 16px 80px;">
      <section id="playlist-section">
        <div class="section-header">
          <h3 style="color:#e50914;font-size:18px;font-weight:700;">📺 M3U Playlist</h3>
        </div>
        <div class="playlist-input-group">
          <input type="url" id="playlist-url" placeholder="Paste M3U URL here..." value="https://iptv-org.github.io/iptv/index.m3u" style="flex:1;padding:12px 16px;border-radius:8px;background:#1a1a1a;border:2px solid #333;color:#fff;font-size:14px;font-family:inherit;outline:none;">
          <button id="load-btn" style="padding:12px 24px;background:#e50914;color:#fff;border:none;border-radius:8px;font-size:14px;font-weight:600;cursor:pointer;font-family:inherit;">Load</button>
        </div>
        <div class="quick-playlists">
          <button class="pill-btn active" data-url="worldcup">🏆 World Cup</button>
          <button class="pill-btn" data-url="https://iptv-org.github.io/iptv/categories/sports.m3u">⚽ Sports</button>
          <button class="pill-btn" data-url="https://iptv-org.github.io/iptv/index.m3u">🌍 All Channels</button>
          <button class="pill-btn" data-url="https://raw.githubusercontent.com/Free-TV/IPTV/master/iptv.m3u">📡 Free TV</button>
          <button class="pill-btn" data-url="https://streamwrap-m3u.pages.dev/ph.m3u">🇵🇭 Philippines</button>
          <button class="pill-btn" data-url="https://iptv-org.github.io/iptv/categories/news.m3u">📰 News</button>
        </div>
        <div id="playlist-status" class="hidden"></div>
      </section>
      <section id="channels-section" class="hidden">
        <div class="section-header">
          <h3 id="channel-count" style="color:#e50914;">Channels</h3>
          <input type="text" id="m3u-search" placeholder="Search..." style="padding:8px 12px;border-radius:8px;background:#1a1a1a;border:2px solid #333;color:#fff;font-size:13px;font-family:inherit;outline:none;max-width:300px;">
        </div>
        <div id="category-tabs" class="category-tabs"></div>
        <div id="channel-list" style="display:flex;flex-direction:column;gap:6px;"></div>
      </section>
    </div>

    <div id="detail-modal-backdrop" class="detail-modal-backdrop" onclick="closeDetailModal(event)">
      <div class="detail-modal" id="detail-modal">
        <button class="detail-modal-close" onclick="closeDetailModal()">✕</button>
        <div id="detail-modal-body"></div>
      </div>
    </div>

    <div id="player-overlay" class="hidden" style="position:fixed;inset:0;z-index:3000;background:#000;display:flex;flex-direction:column;">
      <div id="player-header" style="display:flex;align-items:center;gap:12px;padding:12px 16px;background:rgba(0,0,0,0.9);z-index:10;">
        <button onclick="closePlayer()" style="background:transparent;border:none;color:#fff;font-size:20px;cursor:pointer;padding:4px;">✕</button>
        <span id="player-title" style="font-size:14px;font-weight:600;color:#fff;flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;"></span>
        <select id="provider-select" class="provider-select"></select>
      </div>
      <div id="player-body" style="flex:1;display:flex;align-items:center;justify-content:center;position:relative;">
        <div id="player-loading" style="position:absolute;color:#b3b3b3;font-size:16px;">Loading player...</div>
      </div>
    </div>

    <button id="scroll-top-btn" class="scroll-top-btn" onclick="window.scrollTo({top:0,behavior:'smooth'})">↑</button>

    <footer style="text-align:center;padding:32px 16px;color:#666;font-size:12px;">
      <p>StreamWrap Web — Powered by TMDB & VidSrc</p>
    </footer>

    <div id="livetv-player-overlay" class="hidden" style="position:fixed;inset:0;z-index:1000;background:#000;display:flex;flex-direction:column;">
      <div style="display:flex;align-items:center;gap:12px;padding:12px 16px;background:rgba(0,0,0,0.9);z-index:10;">
        <button onclick="closeLiveTVPlayer()" style="background:transparent;border:none;color:#fff;font-size:20px;cursor:pointer;padding:4px;">✕</button>
        <span id="livetv-player-name" style="font-size:14px;font-weight:600;color:#fff;flex:1;"></span>
      </div>
      <div style="flex:1;display:flex;align-items:center;justify-content:center;">
        <video id="livetv-video" controls autoplay playsinline style="width:100%;height:100%;background:#000;"></video>
        <div id="livetv-error" class="hidden" style="position:absolute;text-align:center;color:#b3b3b3;">
          <p>⚠️ Could not load stream</p>
          <button onclick="retryLiveTV()" style="padding:10px 24px;background:#e50914;color:#fff;border:none;border-radius:6px;font-size:14px;cursor:pointer;margin-top:12px;font-family:inherit;">Retry</button>
        </div>
      </div>
    </div>
  `;
}

// ==================== TMDB API ====================
async function tmdbFetch(endpoint, params = {}) {
  const url = new URL(TMDB_BASE + endpoint);
  params.api_key = TMDB_KEY;
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  const cacheKey = url.toString();
  if (apiCache.has(cacheKey)) return apiCache.get(cacheKey);
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`TMDB ${res.status}`);
    const data = await res.json();
    apiCache.set(cacheKey, data);
    return data;
  } catch (err) {
    console.error('TMDB fetch error:', err);
    return null;
  }
}

// ==================== HERO BANNER ====================
function buildHero() {
  const section = document.getElementById('hero-section');
  if (!heroItems.length) { section.innerHTML = ''; return; }
  renderHeroSlide(section, heroItems[heroIndex]);
  // Start rotation
  if (heroInterval) clearInterval(heroInterval);
  heroInterval = setInterval(() => {
    heroIndex = (heroIndex + 1) % heroItems.length;
    renderHeroSlide(section, heroItems[heroIndex]);
  }, 8000);
}

function renderHeroSlide(section, item) {
  const title = item.title || item.name || 'Untitled';
  const year = (item.release_date || item.first_air_date || '').split('-')[0];
  const rating = item.vote_average ? item.vote_average.toFixed(1) : 'N/A';
  const overview = item.overview || 'No description available.';
  const backdrop = item.backdrop_path ? IMG_BACKDROP + item.backdrop_path : '';
  const isTV = item.media_type === 'tv' || item.first_air_date;
  const tag = isTV ? '📺 TV SERIES' : '🎬 MOVIE';

  section.innerHTML = `
    <div class="hero-banner">
      ${backdrop ? `<img class="hero-banner-image" src="${backdrop}" alt="${title}" onerror="this.style.display='none'">` : ''}
      <div class="hero-banner-overlay"></div>
      <div class="hero-banner-content">
        <div class="hero-banner-tag"><span class="tag-icon">${isTV ? '📺' : '🎬'}</span> ${tag}</div>
        <h2 class="hero-banner-title">${title}</h2>
        <div class="hero-banner-meta">
          <span class="meta-rating">⭐ ${rating}</span>
          ${year ? `<span class="meta-divider"></span><span>${year}</span>` : ''}
        </div>
        <p class="hero-banner-description">${overview}</p>
        <div class="hero-banner-actions">
          <button class="hero-play-btn" onclick="playItem(${item.id}, '${item.media_type || (isTV ? 'tv' : 'movie')}')">
            <span class="play-icon">▶</span> Play
          </button>
          <button class="hero-info-btn" onclick="showDetail(${item.id}, '${item.media_type || (isTV ? 'tv' : 'movie')}')">
            <span class="info-icon">ℹ️</span> More Info
          </button>
        </div>
        <div style="display:flex;gap:6px;margin-top:8px;" id="hero-dots"></div>
      </div>
    </div>
  `;
  // Build dots
  const dotsContainer = document.getElementById('hero-dots');
  if (dotsContainer) {
    heroItems.forEach((_, i) => {
      const dot = document.createElement('div');
      dot.style.cssText = `width:8px;height:8px;border-radius:50%;background:${i === heroIndex ? '#e50914' : '#555'};cursor:pointer;transition:background 0.3s;`;
      dot.onclick = () => { heroIndex = i; renderHeroSlide(section, heroItems[i]); };
      dotsContainer.appendChild(dot);
    });
  }
}

// ==================== CONTENT ROWS ====================
const ROW_CONFIG = [
  { title: 'Trending Now', endpoint: '/trending/all/week' },
  { title: 'Popular Movies', endpoint: '/movie/popular' },
  { title: 'Top Rated TV', endpoint: '/tv/top_rated' },
  { title: 'Popular TV Shows', endpoint: '/tv/popular' },
  { title: 'Top Rated Movies', endpoint: '/movie/top_rated' },
];

async function loadMovieTV() {
  const container = document.getElementById('content-rows');
  if (!container) return;
  // Show skeletons
  container.innerHTML = ROW_CONFIG.map(row => `
    <div class="content-row" data-row="${row.title}">
      <div class="content-row-header">
        <h3 class="content-row-title">${row.title}</h3>
      </div>
      <div class="content-row-wrapper">
        <div class="content-row-scroll">${buildSkeletons(10)}</div>
      </div>
    </div>
  `).join('');

  // Fetch all rows in parallel
  const results = await Promise.all(ROW_CONFIG.map(row => tmdbFetch(row.endpoint, { page: 1 })));
  
  // Use trending for hero
  if (results[0] && results[0].results) {
    heroItems = results[0].results.filter(item => item.backdrop_path).slice(0, 10);
    heroIndex = 0;
    buildHero();
  }

  // Render each row
  results.forEach((data, i) => {
    const container = document.querySelector(`[data-row="${ROW_CONFIG[i].title}"] .content-row-scroll`);
    if (!container) return;
    if (!data || !data.results || !data.results.length) {
      container.innerHTML = '<div class="error-state"><div class="error-icon">😕</div><p>No content available</p></div>';
      return;
    }
    container.innerHTML = data.results.filter(item => item.poster_path).map(item => buildCard(item)).join('');
  });
}

function buildCard(item) {
  const title = item.title || item.name || 'Untitled';
  const year = (item.release_date || item.first_air_date || '').split('-')[0];
  const rating = item.vote_average ? item.vote_average.toFixed(1) : '';
  const poster = item.poster_path ? IMG_POSTER + item.poster_path : '';
  const mediaType = item.media_type || (item.first_air_date ? 'tv' : 'movie');
  const id = item.id;

  const action = mediaType === 'movie' ? 'playItem' : 'showDetail';

  return `
    <div class="movie-card" onclick="${action}(${id}, '${mediaType}')" data-id="${id}">
      ${poster ? `<img class="movie-card-poster" src="${poster}" alt="${title}" loading="lazy" onerror="this.parentElement.style.display='none'">` : '<div class="movie-card-poster skeleton"></div>'}
      <div class="movie-card-overlay">
        <div class="movie-card-title">${title}</div>
        <div class="movie-card-meta">
          ${rating ? `<span class="movie-card-rating">⭐ ${rating}</span>` : ''}
          ${year ? `<span class="movie-card-year">${year}</span>` : ''}
        </div>
      </div>
      <div class="movie-card-play">▶</div>
    </div>
  `;
}

function buildSkeletons(count) {
  let html = '';
  for (let i = 0; i < count; i++) {
    html += `
      <div class="skeleton-card">
        <div class="skeleton-poster skeleton"></div>
        <div class="skeleton-text skeleton"></div>
        <div class="skeleton-text-sm skeleton"></div>
      </div>
    `;
  }
  return html;
}

// ==================== DETAIL MODAL ====================
async function showDetail(id, mediaType) {
  const endpoint = mediaType === 'tv' ? `/tv/${id}` : `/movie/${id}`;
  const data = await tmdbFetch(endpoint, { append_to_response: 'credits,videos,seasons' });
  if (!data) return;

  const title = data.title || data.name || 'Untitled';
  const year = (data.release_date || data.first_air_date || '').split('-')[0];
  const rating = data.vote_average ? data.vote_average.toFixed(1) : 'N/A';
  const overview = data.overview || 'No description available.';
  const backdrop = data.backdrop_path ? IMG_BACKDROP + data.backdrop_path : '';
  const poster = data.poster_path ? IMG_POSTER + data.poster_path : '';
  const genres = (data.genres || []).map(g => g.name).join(', ');
  const runtime = data.runtime ? `${data.runtime} min` : '';
  
  // Cast
  const cast = (data.credits && data.credits.cast ? data.credits.cast.slice(0, 5) : []).map(c => c.name).join(', ');
  
  // My list check
  const inList = myList.some(m => m.id === data.id);
  const isTV = mediaType === 'tv';

  const body = document.getElementById('detail-modal-body');
  body.innerHTML = `
    ${backdrop ? `<img class="detail-modal-backdrop-image" src="${backdrop}" alt="${title}" onerror="this.style.display='none'">` : ''}
    <div class="detail-modal-gradient"></div>
    <div class="detail-modal-content">
      <div style="display:flex;gap:20px;align-items:flex-start;">
        ${poster ? `<img src="${poster}" alt="${title}" style="width:130px;border-radius:8px;box-shadow:0 4px 20px rgba(0,0,0,0.5);" onerror="this.style.display='none'">` : ''}
        <div style="flex:1;">
          <h2 class="detail-modal-title">${title}</h2>
          <div class="detail-modal-actions">
            <button class="detail-play-btn" onclick="playItem(${data.id}, '${mediaType}')">
              <span class="play-icon">▶</span> Play
            </button>
            <button class="detail-my-list-btn" onclick="toggleMyList(${data.id}, '${mediaType}', '${title.replace(/'/g, "\\'")}', '${(data.poster_path || '').replace(/'/g, "\\'")}')" title="My List">
              ${inList ? '✓' : '+'}
            </button>
            <button class="detail-like-btn" onclick="this.textContent = this.textContent === '👍' ? '❤️' : '👍'" title="Rate">👍</button>
          </div>
          <div style="display:flex;gap:12px;flex-wrap:wrap;font-size:14px;color:#b3b3b3;margin-bottom:12px;">
            ${rating !== 'N/A' ? `<span style="color:#46d369;font-weight:700;">⭐ ${rating}</span>` : ''}
            ${year ? `<span>${year}</span>` : ''}
            ${runtime ? `<span>${runtime}</span>` : ''}
            ${isTV && data.number_of_seasons ? `<span>${data.number_of_seasons} Season${data.number_of_seasons > 1 ? 's' : ''}</span>` : ''}
          </div>
          ${genres ? `<div style="margin-bottom:12px;">${genres.split(', ').map(g => `<span class="genre-badge">${g}</span>`).join(' ')}</div>` : ''}
          <p style="font-size:14px;line-height:1.7;color:#b3b3b3;margin-bottom:16px;">${overview}</p>
          ${cast ? `<div class="cast-list"><strong>Cast: </strong>${cast}</div>` : ''}
          ${isTV && data.seasons ? buildSeasonPanel(data) : ''}
        </div>
      </div>
    </div>
  `;

  const backdropEl = document.getElementById('detail-modal-backdrop');
  backdropEl.classList.add('open');
  document.body.style.overflow = 'hidden';
  currentDetailItem = { id: data.id, mediaType, title, poster_path: data.poster_path };

  // If TV, load first season episodes
  if (isTV && data.seasons && data.seasons.length) {
    loadSeasonEpisodes(data.id, data.seasons[0].season_number, data.seasons);
  }
}

function buildSeasonPanel(data) {
  const seasons = data.seasons.filter(s => s.season_number > 0); // exclude specials
  if (!seasons.length) return '';
  return `
    <div class="tv-episode-panel" style="padding:0;margin-top:20px;">
      <h4 style="color:#b3b3b3;font-size:14px;margin-bottom:8px;">Select Episode:</h4>
      <select id="season-select" class="season-select" onchange="loadSeasonEpisodes(${data.id}, this.value, ${JSON.stringify(seasons).replace(/"/g, '&quot;')})">
        ${seasons.map(s => `<option value="${s.season_number}">Season ${s.season_number}</option>`).join('')}
      </select>
      <div id="episode-list-${data.id}" class="episode-list">
        <div style="color:#808080;font-size:13px;">Loading episodes...</div>
      </div>
    </div>
  `;
}

async function loadSeasonEpisodes(tvId, seasonNum, seasons) {
  const listEl = document.getElementById(`episode-list-${tvId}`);
  if (!listEl) return;
  listEl.innerHTML = '<div style="color:#808080;font-size:13px;">Loading episodes...</div>';

  const data = await tmdbFetch(`/tv/${tvId}/season/${seasonNum}`);
  if (!data || !data.episodes) {
    listEl.innerHTML = '<div style="color:#808080;font-size:13px;">No episodes found</div>';
    return;
  }

  listEl.innerHTML = data.episodes.map(ep => `
    <div class="episode-item" onclick="playItem(${tvId}, 'tv', ${seasonNum}, ${ep.episode_number})">
      <span class="episode-number">E${ep.episode_number}</span>
      <div class="episode-info">
        <div class="episode-name">${ep.name || 'Episode ' + ep.episode_number}</div>
        <div class="episode-overview">${ep.overview || 'No description'}</div>
      </div>
    </div>
  `).join('');
}

function closeDetailModal(e) {
  if (e && e.target !== e.currentTarget && !e.target.classList.contains('detail-modal-close')) return;
  const backdrop = document.getElementById('detail-modal-backdrop');
  backdrop.classList.remove('open');
  document.body.style.overflow = '';
  currentDetailItem = null;
}

// ==================== MY LIST ====================
function toggleMyList(id, mediaType, title, posterPath) {
  const idx = myList.findIndex(m => m.id === id);
  if (idx >= 0) {
    myList.splice(idx, 1);
  } else {
    myList.push({ id, mediaType, title, poster_path: posterPath });
  }
  localStorage.setItem('sw-mylist', JSON.stringify(myList));
  // Re-render modal if open
  if (currentDetailItem && currentDetailItem.id === id) {
    showDetail(id, mediaType);
  }
}

// ==================== VIDEO PLAYER ====================
function playItem(id, mediaType, season, episode) {
  const overlay = document.getElementById('player-overlay');
  const titleEl = document.getElementById('player-title');
  const body = document.getElementById('player-body');
  const select = document.getElementById('provider-select');

  const title = (currentDetailItem && currentDetailItem.title) || mediaType;
  titleEl.textContent = season ? `${title} — S${season}E${episode}` : title;

  // Build provider options
  select.innerHTML = EMBED_PROVIDERS.map((p, i) => `<option value="${i}">${p.name}</option>`).join('');

  function loadEmbed(providerIndex) {
    const provider = EMBED_PROVIDERS[providerIndex];
    let embedUrl;
    if (mediaType === 'tv' && season && episode) {
      embedUrl = `${provider.base}/tv/${id}?season=${season}&episode=${episode}`;
    } else {
      embedUrl = `${provider.base}/movie/${id}`;
    }

    // Remove old iframe
    const oldIframe = body.querySelector('iframe');
    if (oldIframe) oldIframe.remove();

    const loadingEl = document.getElementById('player-loading');
    if (loadingEl) loadingEl.style.display = 'block';

    const iframe = document.createElement('iframe');
    iframe.className = 'player-iframe';
    iframe.src = embedUrl;
    iframe.allow = 'autoplay; fullscreen; picture-in-picture';
    iframe.allowFullscreen = true;
    iframe.onload = () => { if (loadingEl) loadingEl.style.display = 'none'; };
    iframe.onerror = () => { if (loadingEl) loadingEl.textContent = 'Failed to load. Try another provider.'; };
    body.appendChild(iframe);
  }

  select.onchange = () => loadEmbed(parseInt(select.value));
  loadEmbed(0);

  overlay.classList.remove('hidden');
  overlay.style.display = 'flex';
  document.body.style.overflow = 'hidden';
}

function closePlayer() {
  const overlay = document.getElementById('player-overlay');
  overlay.classList.add('hidden');
  overlay.style.display = 'none';
  const body = document.getElementById('player-body');
  const iframe = body.querySelector('iframe');
  if (iframe) iframe.remove();
  document.body.style.overflow = '';
}

// ==================== SEARCH ====================
function setupSearch() {
  const input = document.getElementById('search-input');
  const clearBtn = document.getElementById('search-clear');
  const resultsContainer = document.getElementById('search-results');
  const mainContent = document.getElementById('main-content');

  if (!input) return;

  input.addEventListener('input', () => {
    const query = input.value.trim();
    clearBtn.style.display = query ? 'block' : 'none';
    document.getElementById('search-bar').classList.toggle('has-value', !!query);

    clearTimeout(searchTimeout);
    if (!query) {
      resultsContainer.classList.add('hidden');
      mainContent.querySelector('#hero-section').classList.remove('hidden');
      mainContent.querySelector('#content-rows').classList.remove('hidden');
      return;
    }

    searchTimeout = setTimeout(async () => {
      const data = await tmdbFetch('/search/multi', { query, page: 1 });
      if (!data || !data.results) return;

      const filtered = data.results.filter(r => r.media_type === 'movie' || r.media_type === 'tv');
      if (!filtered.length) {
        resultsContainer.innerHTML = '<div class="error-state"><div class="error-icon">🔍</div><p>No results found</p></div>';
      } else {
        resultsContainer.innerHTML = `<div class="search-results-grid">${filtered.map(item => buildCard(item)).join('')}</div>`;
      }
      resultsContainer.classList.remove('hidden');
      mainContent.querySelector('#hero-section').classList.add('hidden');
      mainContent.querySelector('#content-rows').classList.add('hidden');
    }, 300);
  });

  clearBtn.addEventListener('click', () => {
    input.value = '';
    clearBtn.style.display = 'none';
    document.getElementById('search-bar').classList.remove('has-value');
    resultsContainer.classList.add('hidden');
    mainContent.querySelector('#hero-section').classList.remove('hidden');
    mainContent.querySelector('#content-rows').classList.remove('hidden');
  });
}

// ==================== MODE TABS ====================
function setupModeTabs() {
  document.querySelectorAll('#mode-tabs .nav-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('#mode-tabs .nav-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      currentMode = tab.dataset.mode;

      const mainContent = document.getElementById('main-content');
      const liveTVContent = document.getElementById('livetv-content');
      const searchBar = document.getElementById('search-bar');
      const headerNav = document.getElementById('header-nav');

      if (currentMode === 'livetv') {
        mainContent.classList.add('hidden');
        liveTVContent.classList.remove('hidden');
        if (searchBar) searchBar.style.display = 'none';
        if (headerNav) headerNav.style.display = 'none';
      } else {
        mainContent.classList.remove('hidden');
        liveTVContent.classList.add('hidden');
        if (searchBar) searchBar.style.display = '';
        if (headerNav) headerNav.style.display = '';
      }
    });
  });
}

// ==================== NAVIGATION FILTERS ====================
function setupNavigation() {
  document.querySelectorAll('#header-nav .nav-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('#header-nav .nav-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      currentFilter = tab.dataset.filter;
      // Filter rows by type
      document.querySelectorAll('.content-row').forEach(row => {
        const title = row.dataset.row;
        if (currentFilter === 'all') {
          row.style.display = '';
        } else if (currentFilter === 'movies') {
          row.style.display = title.includes('Movie') ? '' : (title === 'Trending Now' || title === 'Top Rated TV' ? 'none' : 'none');
          if (title === 'Trending Now' || title.includes('Movie')) row.style.display = '';
          else row.style.display = 'none';
        } else if (currentFilter === 'tv') {
          if (title.includes('TV') || title.includes('Show')) row.style.display = '';
          else row.style.display = 'none';
        }
      });
    });
  });

  // Scroll to top button
  window.addEventListener('scroll', () => {
    const btn = document.getElementById('scroll-top-btn');
    if (btn) btn.classList.toggle('visible', window.scrollY > 400);
  });
}

// ==================== HOME RESET ====================
function resetToHome() {
  const searchInput = document.getElementById('search-input');
  if (searchInput) searchInput.value = '';
  const clearBtn = document.getElementById('search-clear');
  if (clearBtn) clearBtn.style.display = 'none';
  const resultsContainer = document.getElementById('search-results');
  if (resultsContainer) resultsContainer.classList.add('hidden');
  const mainContent = document.getElementById('main-content');
  if (mainContent) {
    mainContent.classList.remove('hidden');
    const hero = mainContent.querySelector('#hero-section');
    const rows = mainContent.querySelector('#content-rows');
    if (hero) hero.classList.remove('hidden');
    if (rows) rows.classList.remove('hidden');
  }
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ==================== LIVE TV (M3U Player) ====================
let channels = [], filteredChannels = [], categories = new Set();
let selectedCategory = 'all', liveHls = null;

(function initLiveTV() {
  document.addEventListener('click', (e) => {
    const pill = e.target.closest('.pill-btn[data-url]');
    if (pill) {
      const url = pill.dataset.url;
      document.querySelectorAll('.pill-btn[data-url]').forEach(p => p.classList.remove('active'));
      pill.classList.add('active');
      if (url === 'worldcup') {
        document.getElementById('playlist-url').value = 'https://iptv-org.github.io/iptv/index.m3u';
      } else {
        document.getElementById('playlist-url').value = url;
      }
      loadPlaylist(url === 'worldcup' ? 'https://iptv-org.github.io/iptv/index.m3u' : url);
    }
  });

  const loadBtn = document.getElementById('load-btn');
  if (loadBtn) {
    loadBtn.addEventListener('click', () => {
      const url = document.getElementById('playlist-url').value.trim();
      if (url) loadPlaylist(url);
    });
  }

  const m3uSearch = document.getElementById('m3u-search');
  if (m3uSearch) {
    m3uSearch.addEventListener('input', () => {
      const q = m3uSearch.value.toLowerCase();
      filteredChannels = channels.filter(c => c.name.toLowerCase().includes(q));
      renderChannels();
    });
  }
})();

async function loadPlaylist(url) {
  const status = document.getElementById('playlist-status');
  const channelsSection = document.getElementById('channels-section');
  status.classList.remove('hidden');
  status.className = 'loading';
  status.textContent = '⏳ Loading playlist...';

  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error('Failed to fetch');
    const text = await res.text();
    parseM3U(text);
    status.className = 'success';
    status.textContent = `✅ Loaded ${channels.length} channels`;
    channelsSection.classList.remove('hidden');
    setTimeout(() => status.classList.add('hidden'), 3000);
  } catch (err) {
    status.className = 'error';
    status.textContent = '❌ Failed to load playlist. Check URL and try again.';
  }
}

function parseM3U(text) {
  channels = [];
  categories = new Set();
  const lines = text.split('\n');
  let i = 0;
  while (i < lines.length) {
    if (lines[i].trim().startsWith('#EXTINF:')) {
      const info = lines[i].trim();
      const nameMatch = info.match(/,(.+)$/);
      const name = nameMatch ? nameMatch[1].trim() : 'Unknown';
      const groupMatch = info.match(/group-title="([^"]*)"/);
      const group = groupMatch ? groupMatch[1] : 'Other';
      const tvgLogo = (info.match(/tvg-logo="([^"]*)"/) || [])[1] || '';
      i++;
      while (i < lines.length && (lines[i].trim() === '' || lines[i].trim().startsWith('#'))) i++;
      const url = lines[i] ? lines[i].trim() : '';
      if (url && !url.startsWith('#')) {
        categories.add(group);
        channels.push({ name, url, group, logo: tvgLogo });
      }
    }
    i++;
  }
  filteredChannels = [...channels];
  selectedCategory = 'all';
  renderCategories();
  renderChannels();
}

function renderCategories() {
  const tabs = document.getElementById('category-tabs');
  if (!tabs) return;
  tabs.innerHTML = `<button class="cat-tab active" onclick="filterCategory('all')">All (${channels.length})</button>` +
    Array.from(categories).sort().map(c => `<button class="cat-tab" onclick="filterCategory('${c.replace(/'/g, "\\'")}')">${c}</button>`).join('');
}

function filterCategory(cat) {
  selectedCategory = cat;
  document.querySelectorAll('.cat-tab').forEach(t => t.classList.remove('active'));
  event.target.classList.add('active');
  if (cat === 'all') {
    filteredChannels = [...channels];
  } else {
    filteredChannels = channels.filter(c => c.group === cat);
  }
  renderChannels();
}

function renderChannels() {
  const list = document.getElementById('channel-list');
  const countEl = document.getElementById('channel-count');
  if (!list) return;
  if (countEl) countEl.textContent = `Channels (${filteredChannels.length})`;

  if (!filteredChannels.length) {
    list.innerHTML = '<div class="empty-state">No channels found</div>';
    return;
  }

  list.innerHTML = filteredChannels.map((ch, i) => `
    <div class="channel-item" onclick="playLiveTV(${channels.indexOf(ch)})">
      ${ch.logo ? `<img class="channel-logo" src="${ch.logo}" alt="" onerror="this.style.display='none'">` : ''}
      <div class="channel-info">
        <div class="channel-name">${ch.name}</div>
        <div class="channel-meta">${ch.group}</div>
      </div>
      <span class="channel-play">▶</span>
    </div>
  `).join('');
}

function playLiveTV(index) {
  const ch = channels[index];
  if (!ch) return;
  const overlay = document.getElementById('livetv-player-overlay');
  const nameEl = document.getElementById('livetv-player-name');
  const video = document.getElementById('livetv-video');
  const errorEl = document.getElementById('livetv-error');

  nameEl.textContent = ch.name;
  overlay.classList.remove('hidden');
  overlay.style.display = 'flex';
  errorEl.classList.add('hidden');

  if (liveHls) { liveHls.destroy(); liveHls = null; }

  if (ch.url.includes('.m3u8') && Hls.isSupported()) {
    liveHls = new Hls({ maxBufferLength: 30 });
    liveHls.loadSource(ch.url);
    liveHls.attachMedia(video);
    liveHls.on(Hls.Events.MANIFEST_PARSED, () => video.play().catch(() => {}));
    liveHls.on(Hls.Events.ERROR, (_, data) => {
      if (data.fatal) { errorEl.classList.remove('hidden'); video.style.display = 'none'; }
    });
  } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
    video.src = ch.url;
    video.play().catch(() => {});
  } else {
    video.src = ch.url;
    video.play().catch(() => {});
  }
}

function closeLiveTVPlayer() {
  const overlay = document.getElementById('livetv-player-overlay');
  overlay.classList.add('hidden');
  overlay.style.display = 'none';
  const video = document.getElementById('livetv-video');
  video.pause();
  video.src = '';
  if (liveHls) { liveHls.destroy(); liveHls = null; }
}

function retryLiveTV() {
  const video = document.getElementById('livetv-video');
  video.style.display = '';
  document.getElementById('livetv-error').classList.add('hidden');
  // Re-trigger current channel load
  const nameEl = document.getElementById('livetv-player-name');
  const ch = channels.find(c => c.name === nameEl.textContent);
  if (ch) {
    const idx = channels.indexOf(ch);
    playLiveTV(idx);
  }
}

// ==================== SERVICE WORKER ====================
function registerServiceWorker() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  }
}

// ==================== TV REMOTE / KEYBOARD NAVIGATION ====================
function setupTVRemoteNavigation() {
  if (window.__streamWrapTVNavigation) return;
  window.__streamWrapTVNavigation = true;
  const selector = [
    'button', 'input', 'textarea', 'select', 'a[href]',
    '.movie-card', '.episode-item', '.channel-item',
    '[onclick]', '[tabindex]'
  ].join(',');

  const prepare = (root = document) => {
    root.querySelectorAll(selector).forEach((el) => {
      if (el.matches('input, select, button, a[href]')) return;
      if (!el.hasAttribute('tabindex')) el.tabIndex = 0;
      if (!el.hasAttribute('role')) el.setAttribute('role', 'button');
    });
  };

  const visible = (el) => {
    const rect = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    return rect.width > 0 && rect.height > 0 &&
      style.display !== 'none' && style.visibility !== 'hidden';
  };

  const activeScope = () => {
    const player = document.getElementById('player-overlay');
    if (player && !player.classList.contains('hidden')) return player;
    const livePlayer = document.getElementById('livetv-player-overlay');
    if (livePlayer && !livePlayer.classList.contains('hidden')) return livePlayer;
    const modal = document.getElementById('detail-modal-backdrop');
    if (modal && modal.classList.contains('open')) return modal;
    const gate = document.getElementById('password-gate');
    if (gate && !gate.classList.contains('hidden')) return gate;
    return document.getElementById('app') || document;
  };

  const focusables = () => {
    const scope = activeScope();
    prepare(scope);
    return Array.from(scope.querySelectorAll(selector)).filter(visible);
  };

  const move = (direction) => {
    const items = focusables();
    if (!items.length) return;
    const current = items.includes(document.activeElement) ? document.activeElement : null;
    if (!current) {
      items[0].focus();
      return;
    }

    const from = current.getBoundingClientRect();
    const fx = from.left + from.width / 2;
    const fy = from.top + from.height / 2;
    let best = null;
    let bestScore = Infinity;

    items.forEach((candidate) => {
      if (candidate === current) return;
      const rect = candidate.getBoundingClientRect();
      const x = rect.left + rect.width / 2;
      const y = rect.top + rect.height / 2;
      const dx = x - fx;
      const dy = y - fy;
      if ((direction === 'left' && dx >= -4) ||
          (direction === 'right' && dx <= 4) ||
          (direction === 'up' && dy >= -4) ||
          (direction === 'down' && dy <= 4)) return;

      const primary = direction === 'left' || direction === 'right' ? Math.abs(dx) : Math.abs(dy);
      const secondary = direction === 'left' || direction === 'right' ? Math.abs(dy) : Math.abs(dx);
      const score = primary + secondary * 2.5;
      if (score < bestScore) {
        best = candidate;
        bestScore = score;
      }
    });

    if (best) {
      best.focus({ preventScroll: true });
      best.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
    }
  };

  prepare();
  new MutationObserver((mutations) => {
    mutations.forEach((mutation) => mutation.addedNodes.forEach((node) => {
      if (node.nodeType === 1) prepare(node);
    }));
  }).observe(document.body, { childList: true, subtree: true });

  document.addEventListener('keydown', (e) => {
    const directions = {
      ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down'
    };
    if (directions[e.key]) {
      e.preventDefault();
      move(directions[e.key]);
      return;
    }
    if ((e.key === 'Enter' || e.key === ' ') &&
        document.activeElement &&
        document.activeElement.matches('input, textarea, select, [contenteditable="true"]')) {
      // A real remote key gesture is required for Android TV WebView to open its IME.
      document.activeElement.focus();
      document.activeElement.click();
      return;
    }
    if ((e.key === 'Enter' || e.key === ' ') &&
        document.activeElement &&
        !document.activeElement.matches('input, textarea, select, button, a[href]')) {
      e.preventDefault();
      document.activeElement.click();
    }
  });

  requestAnimationFrame(() => {
    const items = focusables();
    if (items.length && !items.includes(document.activeElement)) items[0].focus();
  });
}

// Start on the password gate too; dynamic app controls are picked up by the observer.
setupTVRemoteNavigation();

// ==================== KEYBOARD SHORTCUTS ====================
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    const playerOverlay = document.getElementById('player-overlay');
    if (playerOverlay && !playerOverlay.classList.contains('hidden')) {
      closePlayer();
      return;
    }
    const modal = document.getElementById('detail-modal-backdrop');
    if (modal && modal.classList.contains('open')) {
      closeDetailModal();
    }
    const livePlayer = document.getElementById('livetv-player-overlay');
    if (livePlayer && !livePlayer.classList.contains('hidden')) {
      closeLiveTVPlayer();
    }
  }
});
