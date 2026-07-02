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

// ==================== DOM ====================
const $ = id => document.getElementById(id);
const els = {};
['playlist-url','load-btn','playlist-status','channels-section','channel-list',
 'channel-count','search-input','player-overlay','video-player','player-channel-name',
 'close-player','player-error','retry-btn','hero-watch-btn','hero-browse-btn',
 'loading-screen','app','matches-grid','category-tabs'].forEach(id => els[id] = $(id));

// Hide loading screen IMMEDIATELY
els['loading-screen'].classList.add('hidden');
els['app'].classList.remove('hidden');

// ==================== World Cup API ====================
async function fetchMatches() {
  try {
    const ac = new AbortController();
    setTimeout(() => ac.abort(), 5000);
    const r = await fetch('https://worldcup26.ir/get/games', { signal: ac.signal });
    const data = await r.json();
    const games = data.games || data.data || [];
    
    // Separate Canada matches and other matches
    const canadaGames = games.filter(g => {
      const name = (g.home_team_name_en + ' ' + g.away_team_name_en).toLowerCase();
      return name.includes('canada');
    });
    const otherGames = games.filter(g => {
      const name = (g.home_team_name_en + ' ' + g.away_team_name_en).toLowerCase();
      return !name.includes('canada');
    });
    
    // Show Canada matches first, then live matches, then today's
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

// ==================== M3U Parser ====================
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

// ==================== Load Playlist ====================
async function loadPlaylist(url) {
  if (isLoading) return;
  isLoading = true;
  setStatus('loading', '⏳ Loading channels...');
  try {
    let text;
    if (url === 'worldcup') {
      // Build M3U dynamically — TSN Canada first!
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
    updateTabs();
    setStatus('success', '✅ ' + channels.filter(c=>c.url).length + ' channels');
    applyFilters();
    els['channels-section'].classList.remove('hidden');
    isLoading = false;
  } catch(e) {
    if (url === 'worldcup') {
      loadPlaylist('https://iptv-org.github.io/iptv/categories/sports.m3u');
      return;
    }
    setStatus('error', '❌ Could not load. Try pasting an M3U URL.');
    isLoading = false;
  }
}

function setStatus(type, msg) {
  const el = els['playlist-status'];
  el.className = ''; el.classList.add(type); el.textContent = msg;
}

function updateTabs() {
  const tabs = els['category-tabs'];
  tabs.innerHTML = '<span class="cat-tab active" data-cat="all">🏁 All</span>';
  [...categories].sort().forEach(c => {
    tabs.innerHTML += '<span class="cat-tab" data-cat="' + c.replace(/"/g,'') + '">' + c + '</span>';
  });
  tabs.querySelectorAll('.cat-tab').forEach(tab => {
    tab.addEventListener('click', function() {
      tabs.querySelectorAll('.cat-tab').forEach(t => t.classList.remove('active'));
      this.classList.add('active');
      selectedCategory = this.dataset.cat;
      applyFilters();
    });
  });
}

function applyFilters() {
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
    el.addEventListener('click', function() { playChannel(ch); });
    list.appendChild(el);
  });
}

// ==================== Player ====================
function playChannel(ch) {
  if (!ch || !ch.url) return;
  els['player-channel-name'].textContent = ch.name || 'Channel';
  els['player-error'].classList.add('hidden');
  els['player-overlay'].classList.remove('hidden');
  if (hls) { hls.destroy(); hls = null; }
  const isHLS = ch.url.includes('.m3u8');
  const onErr = function() {
    els['player-error'].classList.remove('hidden');
  };
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

els['close-player'].addEventListener('click', function() {
  els['player-overlay'].classList.add('hidden');
  if (hls) { hls.destroy(); hls = null; }
  els['video-player'].pause();
  els['video-player'].src = '';
});
els['retry-btn'].addEventListener('click', function() {
  var n = els['player-channel-name'].textContent;
  var ch = channels.find(function(c) { return c.name === n; });
  if (ch) playChannel(ch);
});

function watchMatch(home, away) {
  // Load World Cup channels then auto-play — Canada first!
  document.querySelectorAll('.pill-btn').forEach(function(b) { b.classList.remove('active'); });
  
  // Try to find the best channel: TSN for Canada, FIFA+ for everyone else
  var isCanada = (home.toLowerCase().indexOf('canada') >= 0) || (away.toLowerCase().indexOf('canada') >= 0);
  
  var existingChannel = channels.find(function(c) {
    if (isCanada) return c.name && c.name.indexOf('TSN') >= 0 && c.url;
    return c.name && c.name.indexOf('FIFA+ English') >= 0 && c.url;
  });
  
  if (existingChannel) {
    playChannel(existingChannel);
    els['channels-section'].scrollIntoView({ behavior: 'smooth' });
    return;
  }
  
  // Load playlist first
  loadPlaylist('worldcup').then(function() {
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
      setTimeout(function() { playChannel(best); }, 500);
    }
    els['channels-section'].scrollIntoView({ behavior: 'smooth' });
  });
}

// ==================== UI ====================
document.querySelectorAll('.pill-btn').forEach(function(btn) {
  btn.addEventListener('click', function(e) {
    if (btn.classList.contains('external')) {
      return;
    }
    document.querySelectorAll('.pill-btn').forEach(function(b) { b.classList.remove('active'); });
    btn.classList.add('active');
    loadPlaylist(btn.dataset.url);
  });
});

els['load-btn'].addEventListener('click', function() {
  var u = els['playlist-url'].value.trim();
  if (u) loadPlaylist(u);
});

els['search-input'].addEventListener('input', applyFilters);

els['hero-watch-btn'].addEventListener('click', function() {
  document.querySelectorAll('.pill-btn').forEach(function(b) { b.classList.remove('active'); });
  loadPlaylist('worldcup');
  els['channels-section'].scrollIntoView({ behavior: 'smooth' });
});

// ==================== Init ====================
function initApp() {
  setTimeout(function() {
    fetchMatches();
    matchInterval = setInterval(fetchMatches, 30000);
    loadPlaylist('worldcup');
  }, 200);
}

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(function(){});
}
