/* Modulo FDSFLIX - tela.
 *
 * Portado do fdsFlix original (player proprio, sem anuncios), mantendo todas as
 * funcoes: busca TMDB, "continuar assistindo", retomada apos queda de rede,
 * auto-proximo, legendas com sincronia, players alternativos (embed) e a
 * cascata de provedores do servidor.
 *
 * O servidor do fdsFlix e um servico EXTERNO no Render gratuito: dorme e leva
 * ate ~40 s para acordar. Por isso tudo aqui tem esqueleto e aviso de espera, e
 * o navegacao.js ja o acorda por baixo dos panos quando voce entra no 2brain.
 */
(function () {
  'use strict';

  var FALLBACK_POPULAR = [
    { id: 27205, title: 'A Origem', year: '2010', type: 'movie', poster: '/9gk7adHYeDvHkCSEqAvQNLV5Uge.jpg' },
    { id: 155, title: 'Batman: O Cavaleiro das Trevas', year: '2008', type: 'movie', poster: '/qJ2tW6WMUDux911r6m7haRef0WH.jpg' },
    { id: 157336, title: 'Interestelar', year: '2014', type: 'movie', poster: '/gEU2QniE6E77NI6lCU6MxlNBvIx.jpg' },
    { id: 603, title: 'Matrix', year: '1999', type: 'movie', poster: '/f89U3ADr1oiB1s9GkdPOEpXUk5H.jpg' },
    { id: 550, title: 'Clube da Luta', year: '1999', type: 'movie', poster: '/pB8BM7pdSp6B6Ih7QZ4DrQ3PmJK.jpg' },
    { id: 238, title: 'O Poderoso Chefão', year: '1972', type: 'movie', poster: '/3bhkrj58Vtu7enYsRolD1fZdja1.jpg' },
    { id: 1396, title: 'Breaking Bad', year: '2008', type: 'tv', poster: '/ggFHVNu6YYI5L9pCfOacjizRGt.jpg' },
    { id: 1399, title: 'Game of Thrones', year: '2011', type: 'tv', poster: '/1XS1oqL89opfnbLl8WnZY1O1uJx.jpg' },
    { id: 66732, title: 'Stranger Things', year: '2016', type: 'tv', poster: '/49WJfeN0moxb9IPfGn8AIqMGskD.jpg' },
    { id: 100088, title: 'The Last of Us', year: '2023', type: 'tv', poster: '' }
  ];

  var $ = function (id) { return document.getElementById(id); };

  // Backend (Node + ffmpeg) em outro host. Troque aqui se o servico mudar de endereco.
  var API_BASE = 'https://fdsflix.onrender.com';
  var CONFIG = { apiKey: '' };

  // Tempo tipico para o Render gratuito acordar. So serve para a barra de espera.
  var WAKE_ESTIMATE_S = 40;
  // Marca (compartilhada com o navegacao.js) de que o servidor acabou de responder.
  var AWAKE_KEY = 'fdsflix.awake';
  var AWAKE_TTL_MS = 8 * 60 * 1000;

  function markAwake() {
    try { sessionStorage.setItem(AWAKE_KEY, String(Date.now())); } catch (err) { /* ignore */ }
  }

  function recentlyAwake() {
    try { return Date.now() - Number(sessionStorage.getItem(AWAKE_KEY) || 0) < AWAKE_TTL_MS; } catch (err) { return false; }
  }

  function apiUrl(path) {
    if (!path) return path;
    if (/^https?:\/\//i.test(path)) return path;
    if (!API_BASE) return path;
    return API_BASE + (path.charAt(0) === '/' ? path : '/' + path);
  }

  // fetch com a API key opcional (header x-api-key). O /pin.js do 2brain so carimba
  // chamada da mesma origem, entao o PIN nunca viaja para o servidor externo.
  function apiFetch(path, options) {
    var opts = options || {};
    var headers = Object.assign({}, opts.headers || {});
    if (CONFIG.apiKey) headers['x-api-key'] = CONFIG.apiKey;
    opts.headers = headers;
    return fetch(apiUrl(path), opts);
  }

  var state = {
    items: [],
    selected: null,
    hls: null,
    sessionId: null,
    controller: null,
    playToken: 0,
    hevc: detectHevc(),
    forceTranscode: false,
    lastMode: null,
    pendingSeek: 0,
    baseOffset: 0,
    transcoded: false,
    curS: 1,
    curE: 1,
    lastAbs: 0,
    lastSaveAt: 0,
    progReady: false,
    resumePending: false,
    netRetries: 0,
    autoNextTimer: null,
    autoNextStage: null,
    embedIndex: -1,
    hlsWatch: null,
    hlsIssue: '',
    subOffset: 0,
    subKey: null,
    subLang: null,
    langToken: 0,
    applyingLang: false,
    captions: [],
    popToken: 0,
    popularFallback: false,
    wakeTimer: null,
    playWake: null
  };

  /* ---------------------------------------------------------------- */
  /* Utilidades                                                        */
  /* ---------------------------------------------------------------- */

  function escapeHtml(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (char) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char];
    });
  }

  function detectHevc() {
    try {
      var video = document.createElement('video');
      var types = [
        'video/mp4; codecs="hvc1.1.6.L93.B0"',
        'video/mp4; codecs="hev1.1.6.L93.B0"'
      ];
      for (var i = 0; i < types.length; i++) {
        if (video.canPlayType(types[i]) === 'probably') return true;
        if (window.MediaSource && MediaSource.isTypeSupported(types[i])) return true;
      }
      return false;
    } catch (err) {
      return false;
    }
  }

  function toast(message) {
    var el = $('toast');
    el.textContent = message;
    el.classList.add('visivel');
    clearTimeout(toast._timer);
    toast._timer = setTimeout(function () { el.classList.remove('visivel'); }, 4200);
  }


  /* ---------------------------------------------------------------- */
  /* Progresso salvo (onde parou) + retomada após queda de conexão     */
  /* ---------------------------------------------------------------- */

  // Tudo fica no localStorage do navegador: zero carga no servidor e
  // sobrevive a reinício do backend. Só guardamos o essencial (alguns
  // números por título), com teto de títulos/episódios e validade.
  var PROG_KEY = 'fdsflix.progress.v1';
  var PROG_MAX_TITLES = 40;
  var PROG_MAX_EPS = 40;
  var PROG_TTL_MS = 120 * 24 * 3600 * 1000;
  var PROG_MIN_SECONDS = 15;
  var PROG_SAVE_EVERY_MS = 5000;
  var PROG_REWIND_SECONDS = 8;
  var NET_MAX_RETRIES = 5;

  function progLoad() {
    try {
      var raw = JSON.parse(localStorage.getItem(PROG_KEY) || '{}');
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
      var now = Date.now();
      var out = {};
      Object.keys(raw).forEach(function (key) {
        var entry = raw[key];
        if (entry && entry.id != null && entry.type && now - (entry.u || 0) < PROG_TTL_MS) out[key] = entry;
      });
      return out;
    } catch (err) {
      return {};
    }
  }

  var progress = progLoad();

  function progPersist() {
    var keys = Object.keys(progress);
    if (keys.length > PROG_MAX_TITLES) {
      keys.sort(function (a, b) { return (progress[b].u || 0) - (progress[a].u || 0); });
      keys.slice(PROG_MAX_TITLES).forEach(function (key) { delete progress[key]; });
    }
    try {
      localStorage.setItem(PROG_KEY, JSON.stringify(progress));
    } catch (err) { /* ignore */ }
  }

  function progKeyOf(item) {
    return item.type + ':' + item.id;
  }

  function fmtTime(seconds) {
    seconds = Math.max(0, Math.floor(Number(seconds) || 0));
    var h = Math.floor(seconds / 3600);
    var m = Math.floor((seconds % 3600) / 60);
    var s = seconds % 60;
    var mm = h ? ('0' + m).slice(-2) : String(m);
    return (h ? h + ':' : '') + mm + ':' + ('0' + s).slice(-2);
  }

  function secondsToStartMinutes(seconds) {
    if (!seconds || seconds < PROG_MIN_SECONDS) return 0;
    return (Math.max(0, seconds - PROG_REWIND_SECONDS) / 60).toFixed(1);
  }

  // Posição real no filme. No modo convertido (ffmpeg -ss) o <video> começa em 0
  // a partir do ponto "start", então a posição real é start + currentTime.
  function progCurrentAbs() {
    var t = $('nativePlayer').currentTime;
    if (!isFinite(t)) return 0;
    return state.baseOffset + t;
  }

  function progEntryFor(item) {
    var key = progKeyOf(item);
    var entry = progress[key];
    if (!entry) {
      entry = progress[key] = { id: item.id, type: item.type, s: 1, e: 1, t: 0, d: 0, eps: {} };
    }
    entry.title = item.title;
    entry.year = item.year || '';
    entry.poster = item.poster || '';
    return entry;
  }

  function progEpisodePos(item, s, e) {
    var entry = progress[progKeyOf(item)];
    return (entry && entry.eps && entry.eps[s + ':' + e]) || 0;
  }

  function progFinished() {
    var item = state.selected;
    state.progReady = false;
    if (!item) return;
    if (item.type === 'movie') {
      delete progress[progKeyOf(item)];
    } else {
      var entry = progEntryFor(item);
      if (entry.eps) delete entry.eps[state.curS + ':' + state.curE];
      // Terminou o episódio: o "continuar" aponta para o próximo, do início.
      entry.s = state.curS;
      entry.e = state.curE + 1;
      entry.t = 0;
      entry.d = 0;
      entry.u = Date.now();
    }
    progPersist();
  }

  function progRemember(force) {
    var item = state.selected;
    if (!item || !state.progReady) return;

    var abs = progCurrentAbs();
    state.lastAbs = abs;

    var now = Date.now();
    if (!force && now - state.lastSaveAt < PROG_SAVE_EVERY_MS) return;
    if (abs < PROG_MIN_SECONDS) return;
    state.lastSaveAt = now;

    // A playlist convertida cresce enquanto o ffmpeg trabalha (duração parcial),
    // então só confiamos na duração do arquivo no modo direto/HLS nativo.
    var video = $('nativePlayer');
    var dur = (!state.transcoded && isFinite(video.duration) && video.duration > 0) ? video.duration : 0;

    if (dur && dur - abs < Math.max(60, dur * 0.03)) {
      progFinished();
      return;
    }

    var entry = progEntryFor(item);
    entry.s = state.curS;
    entry.e = state.curE;
    entry.t = Math.floor(abs);
    entry.d = Math.floor(dur);
    entry.u = now;

    if (item.type === 'tv') {
      entry.eps = entry.eps || {};
      entry.eps[state.curS + ':' + state.curE] = Math.floor(abs);
      var epKeys = Object.keys(entry.eps);
      if (epKeys.length > PROG_MAX_EPS) {
        // descarta os mais antigos (ordem de inserção: o atual é reinserido no fim)
        var current = entry.eps[state.curS + ':' + state.curE];
        delete entry.eps[state.curS + ':' + state.curE];
        epKeys = Object.keys(entry.eps);
        epKeys.slice(0, epKeys.length - PROG_MAX_EPS + 1).forEach(function (k) { delete entry.eps[k]; });
        entry.eps[state.curS + ':' + state.curE] = current;
      }
    }

    progPersist();
  }

  function renderContinue() {
    var keys = Object.keys(progress).filter(function (key) {
      var entry = progress[key];
      return entry.t >= PROG_MIN_SECONDS || (entry.type === 'tv' && entry.e > 1);
    });
    keys.sort(function (a, b) { return (progress[b].u || 0) - (progress[a].u || 0); });
    keys = keys.slice(0, 12);

    var section = $('continueSection');
    if (!keys.length) {
      section.hidden = true;
      $('continueRow').innerHTML = '';
      return;
    }

    var html = '';
    keys.forEach(function (key) {
      var entry = progress[key];
      var isTv = entry.type === 'tv';
      var poster = entry.poster ? 'https://image.tmdb.org/t/p/w342' + entry.poster : '';
      var img = poster
        ? '<img src="' + escapeHtml(poster) + '" alt="" loading="lazy" onerror="this.remove()">'
        : '';
      var pct = entry.d > 0 ? Math.min(100, Math.round((entry.t / entry.d) * 100)) : 0;
      var label = isTv ? 'T' + entry.s + ' E' + entry.e : 'Filme';
      var meta = entry.t >= PROG_MIN_SECONDS
        ? label + ' · ' + fmtTime(entry.t)
        : 'Próximo: ' + label;

      html +=
        '<div class="card fx-card cont" data-key="' + escapeHtml(key) + '" title="' + escapeHtml(entry.title) + '">' +
          '<div class="fx-poster">' +
            '<div class="fx-poster-fallback">' + escapeHtml(entry.title) + '</div>' +
            '<span class="fx-tipo">' + (isTv ? 'Série' : 'Filme') + '</span>' +
            img +
            '<button class="fx-cont-x" type="button" data-remove="' + escapeHtml(key) + '" title="Remover da lista" aria-label="Remover da lista">×</button>' +
            (pct ? '<div class="fx-cont-bar"><span style="width:' + pct + '%"></span></div>' : '') +
          '</div>' +
          '<div class="fx-info">' +
            '<div class="fx-titulo">' + escapeHtml(entry.title) + '</div>' +
            '<div class="fx-meta">' + escapeHtml(meta) + '</div>' +
          '</div>' +
        '</div>';
    });

    $('continueRow').innerHTML = html;
    section.hidden = false;
  }

  /* ---- Auto-próximo episódio (opcional, chave no player) ---- */

  var AUTONEXT_KEY = 'fdsflix.autonext';
  var AUTONEXT_SECONDS = 5;

  function autoNextEnabled() {
    try { return localStorage.getItem(AUTONEXT_KEY) === '1'; } catch (err) { return false; }
  }

  function setAutoNextEnabled(on) {
    try { localStorage.setItem(AUTONEXT_KEY, on ? '1' : '0'); } catch (err) { /* ignore */ }
  }

  function clearAutoNext() {
    if (state.autoNextTimer) {
      clearInterval(state.autoNextTimer);
      state.autoNextTimer = null;
    }
    $('overlayCancel').hidden = true;
  }

  function playEpisode(season, episode) {
    $('seasonInput').value = season;
    $('episodeInput').value = episode;
    $('startInput').value = 0;
    renderPlayer();
  }

  function maybeAutoNext() {
    var item = state.selected;
    if (!item || item.type !== 'tv' || !autoNextEnabled()) return;

    clearAutoNext();
    var nextS = state.curS;
    var nextE = state.curE + 1;
    var left = AUTONEXT_SECONDS;
    var label = 'T' + nextS + ' E' + nextE;

    function paint() {
      showOverlay('Próximo episódio (' + label + ') em ' + left + 's…', false);
    }
    paint();
    $('overlayCancel').hidden = false;

    state.autoNextTimer = setInterval(function () {
      left -= 1;
      if (left > 0) { paint(); return; }
      clearAutoNext();
      state.autoNextStage = 'episode';
      playEpisode(nextS, nextE);
    }, 1000);
  }

  // O próximo episódio não existe (fim da temporada)? Tenta T+1 E1 uma única vez.
  function autoNextFallback() {
    if (state.autoNextStage === 'episode') {
      state.autoNextStage = 'season';
      playEpisode(state.curS + 1, 1);
      return true;
    }
    if (state.autoNextStage === 'season') {
      state.autoNextStage = null;
      // volta o "continuar" para o último episódio que existe
      var item = state.selected;
      if (item && progress[progKeyOf(item)]) {
        var entry = progress[progKeyOf(item)];
        entry.s = Math.max(1, state.curS - 1);
        entry.e = Math.max(1, (entry.e || 2) - 1);
        progPersist();
      }
      fail('Acabaram os episódios disponíveis. 🎉');
      return true;
    }
    return false;
  }

  // Perdeu a conexão no meio do filme: guarda a posição e recria o stream
  // do ponto onde parou (também cobre sessão de conversão perdida no servidor).
  function doNetResume() {
    state.resumePending = false;
    if (state.selected) renderPlayer();
  }

  function scheduleNetResume(reason) {
    if (!state.selected || state.resumePending) return;

    progRemember(true);
    state.resumePending = true;
    if (state.lastAbs >= PROG_MIN_SECONDS) {
      $('startInput').value = secondsToStartMinutes(state.lastAbs);
    }
    var at = state.lastAbs >= PROG_MIN_SECONDS ? ' de ' + fmtTime(state.lastAbs) : '';

    if (!navigator.onLine) {
      showOverlay('Sem conexão. Retomo' + at + ' assim que a internet voltar…', true);
      setStatus('warn', 'Sem conexão — vou retomar sozinho quando voltar.');
      return;
    }

    if (state.netRetries >= NET_MAX_RETRIES) {
      state.resumePending = false;
      var giveUp = (reason || 'Conexão instável.') + ' Retomo' + at + ' quando você tentar de novo.';
      showOverlay(giveUp, false);
      setStatus('error', giveUp);
      $('overlayRetry').hidden = false;
      return;
    }

    state.netRetries += 1;
    showOverlay('Conexão instável. Retomando' + at + '… (tentativa ' + state.netRetries + '/' + NET_MAX_RETRIES + ')', true);
    setStatus('warn', 'Conexão instável — retomando…');
    setTimeout(function () {
      if (state.resumePending) doNetResume();
    }, 2000 * state.netRetries);
  }


  /* ---------------------------------------------------------------- */
  /* Players alternativos (embed) — opcionais, só quando nada direto   */
  /* ---------------------------------------------------------------- */

  // Cada serviço abre por ID do TMDB. São páginas de terceiros (iframe),
  // por isso só aparecem quando a cascata direta não achou o título e
  // nunca carregam sozinhas.
  var EMBED_PROVIDERS = [
    { name: 'Vidsrc', url: function (t, id, s, e) {
      return t === 'movie' ? 'https://vidsrc.net/embed/movie?tmdb=' + id
        : 'https://vidsrc.net/embed/tv?tmdb=' + id + '&season=' + s + '&episode=' + e; } },
    { name: 'Vidsrc.cc', url: function (t, id, s, e) {
      return t === 'movie' ? 'https://vidsrc.cc/v2/embed/movie/' + id
        : 'https://vidsrc.cc/v2/embed/tv/' + id + '/' + s + '/' + e; } },
    { name: 'VidLink', url: function (t, id, s, e) {
      return t === 'movie' ? 'https://vidlink.pro/movie/' + id
        : 'https://vidlink.pro/tv/' + id + '/' + s + '/' + e; } },
    { name: 'VidFast', url: function (t, id, s, e) {
      return t === 'movie' ? 'https://vidfast.pro/movie/' + id
        : 'https://vidfast.pro/tv/' + id + '/' + s + '/' + e; } },
    { name: '2Embed', url: function (t, id, s, e) {
      return t === 'movie' ? 'https://www.2embed.cc/embed/' + id
        : 'https://www.2embed.cc/embedtv/' + id + '&s=' + s + '&e=' + e; } },
    { name: 'AutoEmbed', url: function (t, id, s, e) {
      return t === 'movie' ? 'https://autoembed.co/movie/tmdb/' + id
        : 'https://autoembed.co/tv/tmdb/' + id + '-' + s + '-' + e; } },
    { name: 'Embed.su', url: function (t, id, s, e) {
      return t === 'movie' ? 'https://embed.su/embed/movie/' + id
        : 'https://embed.su/embed/tv/' + id + '/' + s + '/' + e; } }
  ];

  // Sem allow-popups / allow-top-navigation: o player não abre abas nem
  // redireciona esta página. Fullscreen e reprodução continuam liberados.
  var EMBED_SANDBOX = 'allow-scripts allow-same-origin allow-forms allow-presentation allow-pointer-lock';
  var EMBED_SAFE_KEY = 'fdsflix.embedsafe';

  function embedSafeEnabled() {
    try { return localStorage.getItem(EMBED_SAFE_KEY) !== '0'; } catch (err) { return true; }
  }

  function hideEmbed() {
    state.embedIndex = -1;
    var frame = $('embedFrame');
    frame.hidden = true;
    frame.removeAttribute('src');
    $('nativePlayer').hidden = false;
    $('embedBar').hidden = true;
    Array.prototype.slice.call($('embedBtns').children).forEach(function (btn) {
      btn.classList.remove('active');
    });
  }

  function showEmbedOptions() {
    var item = state.selected;
    if (!item || !/^\d+$/.test(String(item.id))) return;

    var box = $('embedBtns');
    box.innerHTML = '';
    EMBED_PROVIDERS.forEach(function (provider, index) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'ghost';
      btn.textContent = provider.name;
      btn.setAttribute('data-embed', String(index));
      box.appendChild(btn);
    });
    $('embedBar').hidden = false;
  }

  function playEmbed(index) {
    var item = state.selected;
    var provider = EMBED_PROVIDERS[index];
    if (!item || !provider) return;

    var url = provider.url(item.type, item.id, state.curS, state.curE);
    try { $('nativePlayer').pause(); } catch (err) { /* ignore */ }
    hideOverlay();
    $('nativePlayer').hidden = true;

    var frame = $('embedFrame');
    frame.hidden = false;
    // O sandbox só vale na próxima navegação: define antes do src.
    frame.removeAttribute('src');
    if (embedSafeEnabled()) frame.setAttribute('sandbox', EMBED_SANDBOX);
    else frame.removeAttribute('sandbox');
    frame.src = url;
    state.embedIndex = index;

    Array.prototype.slice.call($('embedBtns').children).forEach(function (btn) {
      btn.classList.toggle('active', btn.getAttribute('data-embed') === String(index));
    });
    setStatus('warn', 'Player alternativo: ' + provider.name +
      (embedSafeEnabled() ? ' · modo seguro ligado (sem pop-ups)' : ' · modo seguro DESLIGADO') +
      ' — site de terceiros, não salva o progresso. Se der erro de sandbox, desligue o modo seguro; se não abrir, tente outro.');
  }

  /* ---------------------------------------------------------------- */
  /* Aviso de cold start (Render gratuito)                            */
  /* ---------------------------------------------------------------- */

  function setNotice(kind, text, showRetry) {
    var notice = $('serverNotice');
    notice.hidden = false;
    notice.className = 'fx-aviso ' + kind;
    $('noticeText').textContent = text;
    $('noticeRetry').hidden = !showRetry;
  }

  /* Acorda o servidor e acompanha: o Render gratuito responde 502/503 ou fica
     pendurado enquanto sobe (~40 s). Em vez de desistir na primeira falha, tenta de
     novo a cada poucos segundos mostrando o tempo decorrido. Se o 2brain acabou de
     acordar o servidor (navegacao.js), o aviso nem aparece. */
  function wakeServer() {
    var notice = $('serverNotice');
    clearTimeout(state.wakeTimer);

    var startedAt = Date.now();
    var settled = false;
    var attempt = 0;
    var MAX_ATTEMPTS = 14; // ~14 x 6 s: cobre com folga o cold start de 40 s

    var elapsed = function () { return Math.round((Date.now() - startedAt) / 1000); };

    // So avisa se demorar: servidor ja acordado nao precisa de faixa nenhuma.
    var slowTimer = setTimeout(function () {
      if (settled) return;
      setNotice('waking', 'Acordando o servidor… no plano gratuito leva até ~' + WAKE_ESTIMATE_S + ' s (' + elapsed() + ' s).', false);
    }, recentlyAwake() ? 6000 : 1500);

    var ticker = setInterval(function () {
      if (settled) { clearInterval(ticker); return; }
      if (elapsed() >= 2) {
        setNotice('waking', 'Acordando o servidor… no plano gratuito leva até ~' + WAKE_ESTIMATE_S + ' s (' + elapsed() + ' s).', false);
      }
    }, 1000);

    function done(ok, data) {
      settled = true;
      clearTimeout(slowTimer);
      clearInterval(ticker);
      if (!ok) {
        setNotice('error', 'O servidor não respondeu. Pode estar acordando: aguarde um instante e tente de novo.', true);
        return;
      }
      markAwake();
      // catálogo ficou no esqueleto/offline enquanto o servidor dormia: recarrega agora
      if (state.popularFallback && !$('searchInput').value.trim()) loadPopular();
      if (data && data.ffmpeg === false) {
        setNotice('warn', 'Servidor online, mas sem ffmpeg: vídeos HEVC não serão convertidos.', false);
        return;
      }
      if (notice.hidden) return; // nunca chegou a mostrar nada: segue em silêncio
      setNotice('ok', 'Servidor online e pronto.', false);
      setTimeout(function () {
        if (notice.className.indexOf('ok') === -1) return;
        notice.hidden = true;
      }, 3000);
    }

    function tentar() {
      attempt += 1;
      apiFetch('/api/health', { cache: 'no-store' })
        .then(function (response) {
          if (!response.ok) throw new Error('HTTP ' + response.status);
          return response.json();
        })
        .then(function (data) { done(true, data); })
        .catch(function () {
          if (attempt >= MAX_ATTEMPTS) { done(false); return; }
          state.wakeTimer = setTimeout(tentar, 6000);
        });
    }

    tentar();
  }

  /* ---------------------------------------------------------------- */
  /* Catálogo                                                          */
  /* ---------------------------------------------------------------- */

  function renderCards(items, title) {
    state.items = items || [];
    $('sectionTitle').textContent = title || '';

    var box = $('results');
    if (!state.items.length) {
      box.innerHTML = '<p class="fx-vazio">Nenhum resultado encontrado.</p>';
      return;
    }

    var html = '';
    for (var i = 0; i < state.items.length; i++) {
      var item = state.items[i];
      var poster = item.poster ? 'https://image.tmdb.org/t/p/w342' + item.poster : '';
      var img = poster
        ? '<img src="' + escapeHtml(poster) + '" alt="" loading="lazy" onerror="this.remove()">'
        : '';
      var active = state.selected && state.selected.id === item.id && state.selected.type === item.type;

      html +=
        '<div class="card fx-card' + (active ? ' active' : '') + '" data-index="' + i + '" title="' + escapeHtml(item.title) + '">' +
          '<div class="fx-poster">' +
            '<div class="fx-poster-fallback">' + escapeHtml(item.title) + '</div>' +
            '<span class="fx-tipo">' + (item.type === 'tv' ? 'Série' : 'Filme') + '</span>' +
            img +
          '</div>' +
          '<div class="fx-info">' +
            '<div class="fx-titulo">' + escapeHtml(item.title) + '</div>' +
            '<div class="fx-meta">' + escapeHtml(item.year || '') + (item.year ? ' · ' : '') + (item.type === 'tv' ? 'Série' : 'Filme') + '</div>' +
          '</div>' +
        '</div>';
    }
    box.innerHTML = html;
  }

  // Esqueleto na forma do cartaz. O servidor pode levar ~40 s para acordar,
  // então a legenda diz o que está acontecendo em vez de deixar a tela vazia.
  function renderSkeleton(title, legend, quantos) {
    $('sectionTitle').textContent = title || '';
    var html = legend ? '<p class="fx-esq-legenda">' + escapeHtml(legend) + '</p>' : '';
    for (var i = 0; i < (quantos || 12); i++) {
      html +=
        '<div class="card fx-card fx-esq" aria-hidden="true">' +
          '<div class="fx-poster"></div>' +
          '<div class="fx-info"><div class="fx-linha"></div><div class="fx-linha curta"></div></div>' +
        '</div>';
    }
    state.items = [];
    $('results').innerHTML = html;
  }

  var POPULAR_RETRY_MS = 7000;
  var POPULAR_MAX_TRIES = 8; // ~1 min de tentativas: cobre o cold start

  function loadPopular() {
    var token = ++state.popToken;
    var tries = 0;
    state.popularFallback = false;
    renderSkeleton('Populares', recentlyAwake() ? '' : 'Buscando os títulos em alta…');

    function falhou() {
      if (token !== state.popToken) return;
      tries += 1;
      if (tries >= POPULAR_MAX_TRIES) {
        // não deu: mostra a lista fixa (continua abrindo se o servidor acordar depois)
        state.popularFallback = true;
        renderCards(FALLBACK_POPULAR, 'Populares (lista offline)');
        return;
      }
      renderSkeleton('Populares', 'Acordando o servidor… isso pode levar até ~' + WAKE_ESTIMATE_S + ' s.');
      setTimeout(tentar, POPULAR_RETRY_MS);
    }

    function tentar() {
      if (token !== state.popToken) return;
      apiFetch('/api/popular')
        .then(function (response) { return response.ok ? response.json() : null; })
        .then(function (data) {
          if (token !== state.popToken) return;
          if (data && Array.isArray(data.results) && data.results.length) {
            markAwake();
            renderCards(data.results, 'Populares');
          } else {
            falhou();
          }
        })
        .catch(falhou);
    }

    tentar();
  }

  var searchTimer = null;

  function onSearchInput() {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(runSearch, 350);
  }

  function runSearch() {
    var query = $('searchInput').value.trim();
    if (!query) {
      loadPopular();
      return;
    }

    // invalida um loadPopular em andamento: a busca manda na grade
    state.popToken += 1;
    state.popularFallback = false;
    renderSkeleton('Buscando “' + query + '”…', '', 12);

    apiFetch('/api/search?q=' + encodeURIComponent(query))
      .then(function (response) {
        return response.json().then(function (data) {
          if (!response.ok) throw new Error(data.error || 'Falha na busca');
          return data;
        });
      })
      .then(function (data) {
        var items = (data.results || []).map(function (item) {
          return {
            id: item.id,
            title: item.title,
            year: item.year,
            type: item.type,
            poster: item.poster || ''
          };
        });
        renderCards(items, 'Resultados (' + items.length + ')');
      })
      .catch(function (err) {
        $('results').innerHTML = '<p class="fx-vazio">Erro na busca: ' + escapeHtml(err.message) +
          '. Se o servidor estiver acordando, aguarde um pouco e busque de novo.</p>';
      });
  }

  function clearSearch() {
    $('searchInput').value = '';
    loadPopular();
  }

  /* ---------------------------------------------------------------- */
  /* Player                                                            */
  /* ---------------------------------------------------------------- */

  function showOverlay(text, showSpinner) {
    var overlay = $('overlay');
    overlay.hidden = false;
    // enquanto carrega, o fundo pulsa (esqueleto do vídeo); em aviso/erro fica sólido
    overlay.classList.toggle('esqueleto-video', Boolean(showSpinner));
    $('overlayText').textContent = text || '';
    $('spinner').hidden = !showSpinner;
  }

  function hideOverlay() {
    $('overlay').hidden = true;
    stopPlayWake();
  }

  // Barra de espera do cold start dentro do player: o Render gratuito leva até
  // ~40 s, e uma barra com fim estimado é bem menos angustiante que um giro eterno.
  function stopPlayWake() {
    if (state.playWake) {
      clearInterval(state.playWake);
      state.playWake = null;
    }
    var bar = $('overlayBar');
    if (bar) {
      bar.hidden = true;
      var fill = bar.firstElementChild;
      if (fill) fill.style.width = '0%';
    }
  }

  function startPlayWake(token) {
    stopPlayWake();
    var startedAt = Date.now();
    var bar = $('overlayBar');
    bar.hidden = false;
    var tick = function () {
      if (token !== state.playToken) { stopPlayWake(); return; }
      var secs = Math.round((Date.now() - startedAt) / 1000);
      var pct = Math.min(95, Math.round((secs / WAKE_ESTIMATE_S) * 100));
      bar.firstElementChild.style.width = pct + '%';
      var texto = secs <= WAKE_ESTIMATE_S
        ? 'Acordando o servidor… no plano gratuito leva até ~' + WAKE_ESTIMATE_S + ' s (' + secs + ' s).'
        : 'Ainda acordando… o servidor está demorando mais que o normal (' + secs + ' s).';
      $('overlayText').textContent = texto;
    };
    tick();
    state.playWake = setInterval(tick, 1000);
  }

  function setStatus(kind, text) {
    var badge = $('statusBadge');
    var labels = { working: 'PREPARANDO', ok: 'PRONTO', warn: 'ATENÇÃO', error: 'ERRO' };
    badge.className = 'fx-selo ' + kind;
    badge.textContent = labels[kind] || 'INFO';
    $('statusText').textContent = text || '';
  }

  function fail(message) {
    hideOverlay();
    setStatus('error', message);
  }

  function beaconStop(sessionId) {
    if (!sessionId) return;
    try {
      navigator.sendBeacon(apiUrl('/api/stream/stop?sid=' + encodeURIComponent(sessionId)));
    } catch (err) { /* ignore */ }
  }

  function stopPlayback() {
    clearTimeout(state.hlsWatch);
    state.hlsIssue = '';
    if (state.controller) {
      try { state.controller.abort(); } catch (err) { /* ignore */ }
      state.controller = null;
    }
    if (state.hls) {
      try { state.hls.destroy(); } catch (err) { /* ignore */ }
      state.hls = null;
    }
    beaconStop(state.sessionId);
    state.sessionId = null;
  }

  function resetVideo() {
    var video = $('nativePlayer');
    try { video.pause(); } catch (err) { /* ignore */ }
    video.removeAttribute('src');
    video.load();
    state.captions = [];
    Array.prototype.slice.call(video.querySelectorAll('track')).forEach(function (track) {
      track.remove();
    });
    state.pendingSeek = 0;
    $('subBar').hidden = true;
  }

  /* ---------------------------------------------------------------- */
  /* Sincronia de legendas                                             */
  /* ---------------------------------------------------------------- */

  function subtitleKey(item, season, episode) {
    return 'fdsflix.sub.' + item.type + ':' + item.id +
      (item.type === 'tv' ? ':' + season + ':' + episode : '');
  }

  function loadSubOffset(key) {
    try {
      var raw = localStorage.getItem(key);
      return raw ? Number(raw) || 0 : 0;
    } catch (err) {
      return 0;
    }
  }

  function saveSubOffset(key, value) {
    try {
      localStorage.setItem(key, String(value));
    } catch (err) { /* ignore */ }
  }

  function subtitleUrl(url, offset) {
    var base = apiUrl(url);
    return base + (base.indexOf('?') === -1 ? '?' : '&') +
      'shift=' + encodeURIComponent(String(offset));
  }

  function loadSubLang(key) {
    try {
      return localStorage.getItem(key + '.lang');
    } catch (err) {
      return null;
    }
  }

  function saveSubLang(key, value) {
    try {
      localStorage.setItem(key + '.lang', value);
    } catch (err) { /* ignore */ }
  }

  function addCaptions(captions) {
    var video = $('nativePlayer');

    (captions || []).forEach(function (caption) {
      if (!caption || !caption.url) return;
      var track = document.createElement('track');
      track.kind = 'subtitles';
      track.label = caption.label || 'Legenda';
      track.srclang = caption.srclang || 'und';
      track.src = subtitleUrl(caption.url, state.subOffset);
      video.appendChild(track);
    });
  }

  function populateSubLang(captions) {
    var select = $('subLangSelect');
    if (!select) return;

    var html = '<option value="off">Desligada</option>';
    (captions || []).forEach(function (caption, index) {
      html += '<option value="' + index + '">' +
        escapeHtml(caption.label || ('Legenda ' + (index + 1))) + '</option>';
    });
    select.innerHTML = html;
  }

  function activeSubIndex() {
    var video = $('nativePlayer');
    for (var i = 0; i < video.textTracks.length; i++) {
      if (video.textTracks[i].mode === 'showing') return i;
    }
    return -1;
  }

  function applySubLangByIndex(index) {
    var video = $('nativePlayer');
    var tracks = video.textTracks;
    var off = index === -1 || index === null || index === undefined;

    state.applyingLang = true;

    for (var i = 0; i < tracks.length; i++) {
      tracks[i].mode = !off && i === index ? 'showing' : 'disabled';
    }

    var select = $('subLangSelect');
    if (select) select.value = off ? 'off' : String(index);

    state.subLang = off ? 'off' : (state.captions[index] ? state.captions[index].label : 'off');
    if (state.subKey) saveSubLang(state.subKey, state.subLang);

    // As tracks terminam de registrar de forma assíncrona; ignora os eventos
    // de change disparados pela própria aplicação.
    setTimeout(function () { state.applyingLang = false; }, 250);
  }

  function applySubLangSoon(index, delay) {
    var token = ++state.langToken;
    setTimeout(function () {
      if (token !== state.langToken) return;
      applySubLangByIndex(index);
    }, delay || 120);
  }

  function applySavedSubLang(captions) {
    var saved = state.subKey ? loadSubLang(state.subKey) : null;
    var index = -1;

    if (saved && saved !== 'off') {
      for (var i = 0; i < captions.length; i++) {
        if (captions[i].label === saved) { index = i; break; }
      }
    }

    if (index === -1 && saved !== 'off') {
      for (var j = 0; j < captions.length; j++) {
        if (captions[j].default) { index = j; break; }
      }
      if (index === -1 && captions.length) index = 0;
    }

    var select = $('subLangSelect');
    if (select) select.value = index === -1 ? 'off' : String(index);

    applySubLangSoon(index, 150);
  }

  function syncSubLangFromTracks() {
    if (!state.captions.length) return;
    if (state.applyingLang) return;
    if (!$('nativePlayer').querySelector('track')) return; // durante rebuild

    var index = activeSubIndex();
    var select = $('subLangSelect');
    if (select) select.value = index === -1 ? 'off' : String(index);

    state.subLang = index === -1 ? 'off' : (state.captions[index] ? state.captions[index].label : 'off');
    if (state.subKey) saveSubLang(state.subKey, state.subLang);
  }

  function rebuildCaptions() {
    if (!state.captions.length) return;

    var select = $('subLangSelect');
    var active = select && select.value !== 'off' ? Number(select.value) : -1;
    var video = $('nativePlayer');

    Array.prototype.slice.call(video.querySelectorAll('track')).forEach(function (track) {
      track.remove();
    });

    addCaptions(state.captions);
    populateSubLang(state.captions);
    if (select) select.value = active === -1 ? 'off' : String(active);

    applySubLangSoon(active, 80);
  }

  function applySubOffset(value) {
    var offset = Number(value);
    if (!isFinite(offset)) offset = 0;
    offset = Math.max(-600, Math.min(600, Math.round(offset * 1000) / 1000));

    state.subOffset = offset;
    $('subOffsetInput').value = String(offset);
    if (state.subKey) saveSubOffset(state.subKey, offset);
    rebuildCaptions();
  }

  function attachHls(url, video, startPosition) {
    if (!window.Hls || !Hls.isSupported()) {
      if (video.canPlayType('application/vnd.apple.mpegurl')) {
        video.src = url;
        return;
      }
      throw new Error('Este navegador não tem suporte a HLS.');
    }

    var hls = new Hls({
      startPosition: startPosition > 0 ? startPosition : 0,
      enableWorker: true,
      lowLatencyMode: false,
      maxBufferLength: 30,
      maxMaxBufferLength: 60,
      backBufferLength: 90,
      manifestLoadingMaxRetry: 8,
      levelLoadingMaxRetry: 8,
      fragLoadingMaxRetry: 8,
      fragLoadingRetryDelay: 800
    });
    state.hls = hls;

    var fatalCount = 0;

    hls.on(Hls.Events.ERROR, function (event, data) {
      if (data) {
        var code = data.response && data.response.code ? ' HTTP ' + data.response.code : '';
        state.hlsIssue = data.details + code + (data.fatal ? ' (fatal)' : '');
        console.warn('[hls]', data.type, data.details, code, data.fatal ? 'FATAL' : '');
      }
      if (!data || !data.fatal) return;
      fatalCount += 1;
      console.warn('[hls]', data.type, data.details);

      if (data.type === Hls.ErrorTypes.NETWORK_ERROR && (!navigator.onLine || fatalCount > 4)) {
        // Sem internet (ou o servidor perdeu a sessão): recria o stream de onde parou.
        scheduleNetResume('A conexão com o vídeo caiu.');
        return;
      }
      if (fatalCount > 4) {
        fail('A conversão falhou (' + data.details + '). Tente recarregar ou escolher outra qualidade.');
        return;
      }
      if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
        setStatus('warn', 'Reconectando ao servidor de vídeo…');
        hls.startLoad();
      } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
        setStatus('warn', 'Recuperando o decodificador…');
        hls.recoverMediaError();
      } else {
        fail('Falha na reprodução (' + data.details + ').');
      }
    });

    hls.on(Hls.Events.MANIFEST_PARSED, function () {
      var videoEl = $('nativePlayer');
      videoEl.play().catch(function () {
        hideOverlay();
        setStatus('warn', 'O navegador bloqueou o autoplay — clique no ▶ do vídeo.');
      });
    });

    // Se em 25 s nada tocou, mostra o que o player viu (para diagnóstico).
    clearTimeout(state.hlsWatch);
    state.hlsWatch = setTimeout(function () {
      var v = $('nativePlayer');
      if (!state.selected || (!v.paused && v.readyState >= 3 && v.currentTime > 0)) return;
      var msg = 'O vídeo não começou em 25 s. Player: ' + (state.hlsIssue || 'sem erro registrado') +
        ' · duração ' + (isFinite(v.duration) ? Math.round(v.duration) + 's' : '?') +
        ' · readyState ' + v.readyState +
        '. Abra ' + apiUrl('/api/debug/hls') + ' e copie o resultado.';
      setStatus('warn', msg);
      console.warn('[diagnóstico]', msg);
    }, 25000);

    hls.loadSource(url);
    hls.attachMedia(video);
  }

  function renderPlayer() {
    var item = state.selected;
    if (!item) return;

    clearAutoNext();
    hideEmbed();

    // Guarda onde estava antes de derrubar o vídeo atual.
    progRemember(true);
    state.progReady = false;
    state.baseOffset = 0;
    state.transcoded = false;

    stopPlayback();
    resetVideo();

    var season = Math.max(1, Number($('seasonInput').value) || 1);
    var episode = Math.max(1, Number($('episodeInput').value) || 1);
    var quality = $('qualitySelect').value;
    var startSeconds = Math.max(0, Math.round((Number($('startInput').value) || 0) * 60));

    state.curS = season;
    state.curE = episode;

    state.subKey = subtitleKey(item, season, episode);
    state.subOffset = loadSubOffset(state.subKey);
    $('subOffsetInput').value = String(state.subOffset);
    $('subBar').hidden = true;

    var params = new URLSearchParams();
    params.set('id', String(item.id));
    params.set('type', item.type);
    params.set('s', String(season));
    params.set('e', String(episode));
    params.set('hevc', state.hevc && !state.forceTranscode ? '1' : '0');
    params.set('start', String(startSeconds));
    if (quality) params.set('res', quality);
    if (item.title) params.set('title', item.title);

    state.pendingSeek = startSeconds;
    showOverlay('Extraindo o stream…', true);
    setStatus('working', 'Pedindo o vídeo ao servidor…');

    var controller = new AbortController();
    state.controller = controller;
    var playToken = ++state.playToken;

    // Se o backend estiver dormindo (Render free), avisa em vez de parecer travado.
    var slowTimer = setTimeout(function () {
      if (playToken !== state.playToken) return;
      showOverlay('Acordando o servidor…', true);
      startPlayWake(playToken);
      setStatus('working', 'Acordando o servidor (plano gratuito, até ~' + WAKE_ESTIMATE_S + ' s)…');
    }, recentlyAwake() ? 9000 : 4000);

    apiFetch('/api/stream?' + params.toString(), { signal: controller.signal })
      .then(function (response) {
        return response.json().catch(function () { return {}; }).then(function (data) {
          if (!response.ok || !data.url) {
            throw new Error(data.error || 'O servidor não retornou um vídeo.');
          }
          return data;
        });
      })
      .then(function (data) {
        clearTimeout(slowTimer);
        stopPlayWake();
        if (playToken !== state.playToken) return;
        markAwake();

        state.sessionId = data.sessionId || null;
        state.lastMode = data.mode;
        state.transcoded = Boolean(data.transcoded);
        state.baseOffset = data.transcoded ? startSeconds : 0;
        // No stream convertido o servidor já começa em "start": não buscar de novo.
        if (data.mode === 'hls' && data.transcoded) state.pendingSeek = 0;
        state.captions = Array.isArray(data.captions) ? data.captions : [];
        addCaptions(state.captions);
        populateSubLang(state.captions);
        applySavedSubLang(state.captions);
        $('subBar').hidden = state.captions.length === 0;

        var video = $('nativePlayer');

        if (data.mode === 'hls') {
          showOverlay(data.transcoded ? 'Convertendo para H.264…' : 'Carregando stream…', true);
          attachHls(apiUrl(data.url), video, data.transcoded ? 0 : startSeconds);
        } else if (data.mode === 'direct') {
          video.src = apiUrl(data.url);
          video.play().catch(function () {
            hideOverlay();
            setStatus('warn', 'O navegador bloqueou o autoplay — clique no ▶ do vídeo.');
          });
        } else {
          throw new Error('Modo de reprodução desconhecido.');
        }

        var details = [];
        details.push('Fonte: ' + (data.provider || 'desconhecida'));
        details.push(data.transcoded ? ('convertido para ' + data.quality + 'p') : ('qualidade ' + data.quality + 'p'));
        if (data.note) details.push(data.note);
        setStatus('ok', details.join(' · '));
      })
      .catch(function (err) {
        clearTimeout(slowTimer);
        stopPlayWake();
        if (err && err.name === 'AbortError') return;
        if (playToken !== state.playToken) return;
        if (!navigator.onLine || /failed to fetch|networkerror|load failed/i.test((err && err.message) || '')) {
          scheduleNetResume('Sem conexão com o servidor.');
          return;
        }
        if (autoNextFallback()) return;
        fail(err.message || 'Erro ao preparar o vídeo.');
        showEmbedOptions();
      });
  }

  function selectItem(index) {
    var item = state.items[index];
    if (item) openItem(item);
  }

  function openItem(item) {
    if (!item) return;

    clearAutoNext();
    state.autoNextStage = null;

    // Antes de trocar de título, salva a posição do que estava tocando.
    progRemember(true);
    state.progReady = false;
    state.lastAbs = 0;
    state.netRetries = 0;
    state.resumePending = false;

    state.selected = item;
    $('playerTitle').textContent = item.title;
    $('playerMeta').textContent =
      (item.year ? item.year + ' · ' : '') + (item.type === 'tv' ? 'Série' : 'Filme');

    $('tvControls').hidden = item.type !== 'tv';
    if (item.type === 'tv') {
      $('seasonInput').value = 1;
      $('episodeInput').value = 1;
    }
    $('startInput').value = 0;

    // Já assistiu antes? Volta no episódio e no minuto onde parou.
    var saved = progress[progKeyOf(item)];
    if (saved) {
      if (item.type === 'tv') {
        $('seasonInput').value = Math.max(1, Number(saved.s) || 1);
        $('episodeInput').value = Math.max(1, Number(saved.e) || 1);
      }
      if (saved.t >= PROG_MIN_SECONDS) {
        $('startInput').value = secondsToStartMinutes(saved.t);
        toast('Retomando de ' + fmtTime(saved.t) + (item.type === 'tv' ? ' (T' + saved.s + ' E' + saved.e + ')' : ''));
      } else if (item.type === 'tv') {
        toast('Continuando em T' + saved.s + ' E' + saved.e);
      }
    }
    $('playerSection').hidden = false;

    Array.prototype.slice.call(document.querySelectorAll('.fx-card')).forEach(function (card) {
      var cardItem = card.dataset.index !== undefined ? state.items[Number(card.dataset.index)] : null;
      card.classList.toggle('active', Boolean(cardItem) && String(cardItem.id) === String(item.id) && cardItem.type === item.type);
    });

    $('playerSection').scrollIntoView({ behavior: 'smooth', block: 'start' });
    renderPlayer();
  }

  function closePlayer() {
    hideEmbed();
    clearAutoNext();
    state.autoNextStage = null;
    progRemember(true);
    state.progReady = false;
    state.resumePending = false;
    stopPlayback();
    resetVideo();
    state.selected = null;
    renderContinue();
    $('playerSection').hidden = true;
    Array.prototype.slice.call(document.querySelectorAll('.fx-card')).forEach(function (card) {
      card.classList.remove('active');
    });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  /* ---------------------------------------------------------------- */
  /* Eventos                                                           */
  /* ---------------------------------------------------------------- */

  $('results').addEventListener('click', function (event) {
    var card = event.target.closest ? event.target.closest('.fx-card') : null;
    if (!card || card.classList.contains('fx-esq')) return;
    selectItem(Number(card.dataset.index));
  });

  $('searchInput').addEventListener('input', onSearchInput);
  $('searchInput').addEventListener('keydown', function (event) {
    if (event.key === 'Enter') {
      clearTimeout(searchTimer);
      runSearch();
    }
  });

  $('clearBtn').addEventListener('click', clearSearch);
  $('reloadBtn').addEventListener('click', function () {
    // "Recarregar" volta ao ponto atual, não ao início configurado.
    if (state.selected) {
      progRemember(true);
      if (state.lastAbs >= PROG_MIN_SECONDS) $('startInput').value = secondsToStartMinutes(state.lastAbs);
      state.netRetries = 0;
      state.resumePending = false;
    }
    renderPlayer();
  });
  $('closeBtn').addEventListener('click', closePlayer);

  $('subLangSelect').addEventListener('change', function () {
    applySubLangByIndex(this.value === 'off' ? -1 : Number(this.value));
  });

  $('subMinus').addEventListener('click', function () { applySubOffset(state.subOffset - 0.5); });
  $('subPlus').addEventListener('click', function () { applySubOffset(state.subOffset + 0.5); });
  $('subReset').addEventListener('click', function () { applySubOffset(0); });
  $('subOffsetInput').addEventListener('change', function () { applySubOffset(this.value); });

  $('qualitySelect').addEventListener('change', function () {
    var video = $('nativePlayer');
    if (state.selected && progCurrentAbs() > 5) {
      $('startInput').value = (progCurrentAbs() / 60).toFixed(1);
    }
    if (state.selected) renderPlayer();
  });

  // Trocar de episódio: começa de onde parou NESSE episódio (ou do zero).
  ['seasonInput', 'episodeInput'].forEach(function (id) {
    $(id).addEventListener('change', function () {
      if (!state.selected) return;
      var s = Math.max(1, Number($('seasonInput').value) || 1);
      var e = Math.max(1, Number($('episodeInput').value) || 1);
      $('startInput').value = secondsToStartMinutes(progEpisodePos(state.selected, s, e));
      renderPlayer();
    });
  });

  $('startInput').addEventListener('change', function () {
    if (state.selected) renderPlayer();
  });

  $('continueRow').addEventListener('click', function (event) {
    var target = event.target;
    var removeBtn = target.closest ? target.closest('[data-remove]') : null;
    if (removeBtn) {
      event.stopPropagation();
      delete progress[removeBtn.getAttribute('data-remove')];
      progPersist();
      renderContinue();
      return;
    }
    var card = target.closest ? target.closest('.fx-card') : null;
    if (!card) return;
    var entry = progress[card.getAttribute('data-key')];
    if (!entry) return;
    openItem({ id: entry.id, type: entry.type, title: entry.title, year: entry.year, poster: entry.poster });
  });

  var video = $('nativePlayer');

  var directCheckTimer = null;

  // Alguns navegadores dizem não suportar HEVC, mas "tocam" assim mesmo:
  // avançam o tempo e reproduzem só o áudio, sem decodificar nenhum frame
  // (videoWidth fica 0) e sem disparar erro. Nesse caso força a conversão.
  function checkDirectDecoding() {
    clearTimeout(directCheckTimer);
    if (state.lastMode !== 'direct' || state.forceTranscode) return;

    directCheckTimer = setTimeout(function () {
      var v = $('nativePlayer');
      if (state.lastMode !== 'direct' || state.forceTranscode) return;
      if (v.currentTime > 0.3 && (v.videoWidth === 0 || v.videoHeight === 0)) {
        state.forceTranscode = true;
        toast('O navegador não decodificou a imagem do vídeo original. Convertendo para H.264…');
        renderPlayer();
      }
    }, 3000);
  }

  video.addEventListener('playing', function () {
    hideOverlay();
    clearTimeout(state.hlsWatch);
    state.progReady = true;
    clearAutoNext();
    state.autoNextStage = null;
    state.netRetries = 0;
    state.resumePending = false;
    $('overlayRetry').hidden = true;
    checkDirectDecoding();
  });

  video.addEventListener('timeupdate', function () { progRemember(false); });
  video.addEventListener('pause', function () { progRemember(true); });
  video.addEventListener('seeked', function () { progRemember(true); });
  video.addEventListener('ended', function () {
    progFinished();
    maybeAutoNext();
  });

  video.addEventListener('waiting', function () {
    if (state.selected) showOverlay('Armazenando buffer…', true);
  });

  video.addEventListener('loadedmetadata', function () {
    if (state.selected && state.pendingSeek > 0 && !state.hls) {
      try { video.currentTime = state.pendingSeek; } catch (err) { /* ignore */ }
    }
    state.pendingSeek = 0;
  });

  video.addEventListener('error', function () {
    if (!state.selected) return;
    var error = video.error;
    if (!error) return;
    var messages = {
      1: 'Carregamento interrompido.',
      2: 'Erro de rede ao carregar o vídeo.',
      3: 'Falha ao decodificar o vídeo (codec não suportado).',
      4: 'Formato de vídeo não suportado.'
    };

    // Rede de segurança: o navegador disse que suportava HEVC mas não decodificou.
    // Refaz o pedido forçando a transcodificação para H.264.
    if ((error.code === 3 || error.code === 4) && state.lastMode === 'direct' && !state.forceTranscode) {
      state.forceTranscode = true;
      toast('O navegador não decodificou o vídeo original. Convertendo para H.264…');
      renderPlayer();
      return;
    }

    // Queda de rede no meio do vídeo: retoma sozinho do minuto onde parou.
    if (error.code === 2 || (error.code === 4 && !navigator.onLine)) {
      scheduleNetResume(messages[error.code]);
      return;
    }

    fail(messages[error.code] || 'Erro desconhecido ao reproduzir o vídeo.');
  });

  // Mantém o seletor sincronizado quando o usuário usa o menu CC nativo.
  if (video.textTracks.addEventListener) {
    video.textTracks.addEventListener('change', syncSubLangFromTracks);
  } else {
    video.textTracks.onchange = syncSubLangFromTracks;
  }

  $('embedSafeToggle').checked = embedSafeEnabled();
  $('embedSafeToggle').addEventListener('change', function () {
    try { localStorage.setItem(EMBED_SAFE_KEY, this.checked ? '1' : '0'); } catch (err) { /* ignore */ }
    // Recarrega o embed aberto já com a nova regra.
    if (state.embedIndex >= 0) playEmbed(state.embedIndex);
  });

  $('embedBtns').addEventListener('click', function (event) {
    var btn = event.target.closest ? event.target.closest('[data-embed]') : null;
    if (btn) playEmbed(Number(btn.getAttribute('data-embed')));
  });

  $('overlayCancel').addEventListener('click', function () {
    clearAutoNext();
    hideOverlay();
  });

  $('autoNextToggle').checked = autoNextEnabled();
  $('autoNextToggle').addEventListener('change', function () {
    setAutoNextEnabled(this.checked);
    if (!this.checked) clearAutoNext();
    toast(this.checked ? 'Auto-próximo ligado.' : 'Auto-próximo desligado.');
  });

  $('overlayRetry').addEventListener('click', function () {
    state.netRetries = 0;
    state.resumePending = false;
    if (state.selected) renderPlayer();
  });

  window.addEventListener('beforeunload', function () {
    progRemember(true);
    beaconStop(state.sessionId);
  });
  window.addEventListener('pagehide', function () { progRemember(true); });
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden') progRemember(true);
  });

  window.addEventListener('offline', function () {
    if (state.selected) toast('Sem conexão. O vídeo segue do buffer e retomo de onde parou quando voltar.');
  });

  window.addEventListener('online', function () {
    if (!state.selected) return;
    if (state.resumePending) {
      toast('Conexão de volta — retomando…');
      doNetResume();
      return;
    }
    // Voltou a internet mas o vídeo ficou travado esperando dados: refaz o stream.
    setTimeout(function () {
      var v = $('nativePlayer');
      if (state.selected && !state.resumePending && !v.ended && !v.paused && v.readyState < 3) {
        state.netRetries = 0;
        scheduleNetResume('Conexão restabelecida.');
      }
    }, 2500);
  });

  /* ---------------------------------------------------------------- */
  /* Inicialização                                                     */
  /* ---------------------------------------------------------------- */

  renderContinue();
  loadPopular();

  $('deployHint').hidden = false;
  wakeServer();

  $('noticeRetry').addEventListener('click', function () {
    setNotice('checking', 'Conectando ao servidor…', false);
    wakeServer();
  });

  // Aviso (não bloqueia nada): só diz se o servidor está sem ffmpeg.
  apiFetch('/api/config')
    .then(function (response) { return response.ok ? response.json() : null; })
    .then(function (config) {
      if (config && config.ffmpeg === false) {
        toast('ffmpeg não encontrado no servidor: vídeos HEVC não poderão ser convertidos.');
      }
    })
    .catch(function () { /* ignore */ });
})();
