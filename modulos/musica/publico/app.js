/* Player. JS puro, sem build.
 *
 * Telas por hash: #/ (inicio), #/busca/termo, #/artista/usuario e
 * #/cd/usuario/slug. A fila, os modos (aleatorio e repetir) e os CDs
 * recentes ficam no localStorage deste navegador.
 * O audio toca direto do Sua Musica; se o CDN recusar, tenta de novo pelo
 * /api/audio do Worker, que busca e repassa.
 */
const $ = (s) => document.querySelector(s);
const tela = $('#tela');
const audio = $('#audio');
const API = window.API_BASE || '';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* ------------------------------------------------------------ memoria */

const guardar = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* sem espaco */ } };
const ler = (k, padrao) => { try { return JSON.parse(localStorage.getItem(k)) ?? padrao; } catch { return padrao; } };

const S = {
  fila: ler('mus:fila', []),
  i: ler('mus:indice', -1),
  recentes: ler('mus:recentes', []),
  aleatorio: ler('mus:aleatorio', false),
  // repetir: 'nao' | 'fila' | 'uma'
  repetir: ler('mus:repetir', 'nao'),
  // a ordem original, pra desfazer o aleatorio
  original: ler('mus:original', null),
  lista: [], // faixas da tela atual (CD aberto ou musicas da busca)
  // radio: 'nao' | 'inteligente' | 'artista'. Quando ligada, a fila nunca acaba.
  radio: ler('mus:radio', 'nao'),
  semente: ler('mus:semente', ''),
  // o que ja rolou, pra radio nao girar em circulo
  cdsTocados: ler('mus:cdsTocados', []),
  perfil: ler('mus:perfil', { artistas: {}, estilos: {} }),
  abastecendo: false,
};
const salvarFila = () => {
  guardar('mus:fila', S.fila); guardar('mus:indice', S.i);
  guardar('mus:original', S.original);
};
const salvarRadio = () => {
  guardar('mus:radio', S.radio); guardar('mus:semente', S.semente);
  guardar('mus:cdsTocados', S.cdsTocados.slice(-60)); guardar('mus:perfil', S.perfil);
};

async function api(caminho) {
  const r = await fetch(API + caminho);
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.erro || `Falhou (${r.status})`);
  return d;
}

/* -------------------------------------------------------------- telas */

const plays = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(1).replace('.0', '')} mi` : n >= 1e3 ? `${Math.round(n / 1e3)} mil` : String(n || 0)) + ' plays';

function gradeCds(lista) {
  return '<div class="grade">' + lista.map((c, n) =>
    `<button class="cd surgir" style="animation-delay:${Math.min(n * 30, 400)}ms" data-link="${esc(c.link)}">` +
      `<img src="${esc(c.capa)}" alt="" loading="lazy" referrerpolicy="no-referrer" />` +
      `<strong>${esc(c.titulo)}</strong><span>${esc(c.artista)}</span></button>`).join('') + '</div>';
}

// lista de faixas; com capa=true mostra a capinha e o CD (busca)
function listaFaixas(faixas, comCapa) {
  return '<ul class="faixas">' + faixas.map((f, n) =>
    `<li><button class="faixa" data-faixa="${n}">` +
      (comCapa ? `<img class="mini" src="${esc(f.capa)}" alt="" loading="lazy" referrerpolicy="no-referrer" />`
               : `<span class="n">${n + 1}</span>`) +
      `<span class="t">${esc(f.titulo)}${comCapa ? `<small>${esc(f.cd)}</small>` : ''}</span></button></li>`).join('') + '</ul>';
}

const voltar = '<button class="voltar" data-voltar>‹ Início</button>';
const erro = (e) => voltar + `<p class="aviso erro">${esc(e.message)}</p>`;

async function telaInicio() {
  S.lista = [];
  tela.innerHTML = (S.recentes.length
      ? '<div class="acoes">' +
        `<button class="btn" data-radio="inteligente" data-semente="${esc(S.recentes[0].link)}" aria-pressed="false">Rádio</button>` +
        `<button class="btn suave" data-radio="artista" data-semente="${esc(S.recentes[0].link)}" aria-pressed="false">Rádio do artista</button>` +
        '</div><p class="aviso" id="radioAviso"></p>' : '') +
    (S.recentes.length
      ? '<div class="secao"><h2>Abertos recentemente</h2></div>' + gradeCds(S.recentes) : '') +
    '<div class="secao"><h2>Destaques do Sua Música</h2></div><div class="grade">' +
    '<div class="esq"></div>'.repeat(6) + '</div>';
  try {
    const { destaques } = await api('/api/inicio');
    atualizarBotoesRadio();
    const alvo = tela.querySelectorAll('.grade');
    alvo[alvo.length - 1].outerHTML = destaques.length ? gradeCds(destaques)
      : '<p class="aviso">Sem destaques agora. Busque uma música ou artista ali em cima.</p>';
  } catch (e) {
    tela.querySelector('.grade:last-of-type').outerHTML = `<p class="aviso erro">${esc(e.message)}</p>`;
  }
}

async function telaBusca(termo) {
  $('#campoBusca').value = termo;
  tela.innerHTML = voltar + `<p class="aviso">Buscando “${esc(termo)}”…</p>`;
  let r;
  try { r = await api('/api/busca?q=' + encodeURIComponent(termo)); } catch (e) { tela.innerHTML = erro(e); return; }
  S.lista = r.musicas;
  const nada = !r.artistas.length && !r.musicas.length && !r.cds.length;
  tela.innerHTML = voltar +
    (nada ? `<p class="aviso">Nada encontrado para “${esc(termo)}”.</p>` : '') +
    (r.artistas.length ? '<div class="secao"><h2>Artistas</h2></div><div class="artistas">' +
      r.artistas.map((a) => `<button class="artista surgir" data-artista="${esc(a.usuario)}">` +
        `<img src="${esc(a.foto)}" alt="" loading="lazy" referrerpolicy="no-referrer" />` +
        `<strong>${esc(a.nome)}</strong><span>${plays(a.plays)}</span></button>`).join('') + '</div>' : '') +
    (r.musicas.length ? `<div class="secao"><h2>Músicas</h2><span>${r.musicas.length}</span></div>` +
      '<div class="acoes"><button class="btn" data-tocar-lista>Tocar todas</button>' +
      '<button class="btn suave" data-enfileirar>Pôr na fila</button></div>' + listaFaixas(r.musicas, true) : '') +
    (r.cds.length ? '<div class="secao"><h2>CDs</h2></div>' + gradeCds(r.cds) : '');
  marcarAtual();
}

async function telaArtista(usuario) {
  S.lista = [];
  tela.innerHTML = voltar + '<p class="aviso">Abrindo o artista…</p>';
  let a;
  try { a = await api('/api/artista?u=' + encodeURIComponent(usuario)); } catch (e) { tela.innerHTML = erro(e); return; }
  tela.innerHTML = voltar +
    '<div class="artista-topo surgir">' +
      `<img src="${esc(a.foto)}" alt="" referrerpolicy="no-referrer" />` +
      `<div><h2>${esc(a.nome)}</h2><p>${plays(a.plays)} · ${a.cds.length} CDs</p></div>` +
    '</div>' +
    (a.cds.length ? gradeCds(a.cds) : '<p class="aviso">Esse artista não tem CDs públicos.</p>');
}

async function telaCd(usuario, slug) {
  tela.innerHTML = voltar + '<p class="aviso">Abrindo o CD…</p>';
  let cd;
  try { cd = await api('/api/cd?link=' + encodeURIComponent(`${usuario}/${slug}`)); } catch (e) { tela.innerHTML = erro(e); return; }
  S.lista = cd.faixas;
  // lembra o CD entre os recentes (os 12 ultimos, sem repetir)
  S.recentes = [{ titulo: cd.titulo, artista: cd.artista, capa: cd.capa, link: cd.link },
    ...S.recentes.filter((r) => r.link !== cd.link)].slice(0, 12);
  guardar('mus:recentes', S.recentes);

  tela.innerHTML = voltar +
    '<div class="cd-topo surgir">' +
      `<img src="${esc(cd.capa)}" alt="" referrerpolicy="no-referrer" />` +
      `<div><small>${esc(cd.estilo || 'CD')}</small><h2>${esc(cd.titulo)}</h2>` +
      `<p><a href="#/artista/${esc(cd.usuario)}">${esc(cd.artista)}</a> · ${cd.faixas.length} ${cd.faixas.length === 1 ? 'faixa' : 'faixas'}</p></div>` +
    '</div>' +
    (cd.faixas.length
      ? '<div class="acoes"><button class="btn" data-tocar-lista>Tocar CD</button>' +
        '<button class="btn suave" data-enfileirar>Pôr na fila</button>' +
        `<button class="btn suave" data-radio="inteligente" data-semente="${esc(cd.link)}" aria-pressed="false">Rádio</button>` +
        `<button class="btn suave" data-radio="artista" data-semente="${esc(cd.link)}" aria-pressed="false">Só ${esc(cd.artista)}</button>` +
        '</div><p class="aviso" id="radioAviso"></p>' + listaFaixas(cd.faixas, false)
      : '<p class="aviso">Este CD não tem faixas disponíveis.</p>') +
    (cd.parecidos.length ? '<div class="secao"><h2>Parecidos</h2></div>' + gradeCds(cd.parecidos) : '');
  marcarAtual();
  atualizarBotoesRadio();
}

function rotear() {
  const partes = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);
  if (partes[0] === 'cd' && partes.length >= 3) telaCd(partes[1], partes[2]);
  else if (partes[0] === 'busca' && partes[1]) telaBusca(partes.slice(1).join('/'));
  else if (partes[0] === 'artista' && partes[1]) telaArtista(partes[1]);
  else { $('#campoBusca').value = ''; telaInicio(); }
  window.scrollTo(0, 0);
}

function abrirCd(link) {
  const m = String(link).match(/suamusica\.com\.br\/([\w.-]+)\/([\w.-]+)/);
  if (m) location.hash = `#/cd/${m[1]}/${m[2]}`;
}

/* -------------------------------------------------------- aleatorio */

function embaralhar(lista) {
  const a = lista.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// liga: a musica atual fica no topo e o resto e sorteado. Desliga: volta a
// ordem original, continuando da musica que esta tocando.
function aplicarAleatorio() {
  const atual = S.fila[S.i];
  if (S.aleatorio) {
    S.original = S.fila.slice();
    const resto = S.fila.filter((_, n) => n !== S.i);
    S.fila = atual ? [atual, ...embaralhar(resto)] : embaralhar(resto);
    S.i = atual ? 0 : -1;
  } else if (S.original) {
    const ids = new Set(S.fila.map((f) => f.id));
    // o que entrou na fila depois de embaralhar vai pro fim da ordem original
    const extras = S.fila.filter((f) => !S.original.some((o) => o.id === f.id));
    S.fila = [...S.original.filter((f) => ids.has(f.id)), ...extras];
    S.i = atual ? S.fila.findIndex((f) => f.id === atual.id) : -1;
    S.original = null;
  }
  salvarFila();
}

// quando uma lista nova comeca a tocar, respeita o aleatorio ligado
function tocarLista(faixas, inicio) {
  S.fila = faixas.slice();
  S.i = inicio;
  S.original = null;
  if (S.aleatorio) aplicarAleatorio();
  tocar(S.i);
}

/* -------------------------------------------------------------- radio */

/* Com a radio ligada, a fila nunca acaba: quando faltam poucas faixas, o
   servidor manda outro lote. O que ja tocou vai junto no pedido, senao a
   radio gira em circulo. */
const FALTANDO_PRA_ABASTECER = 4;

async function abastecer(quantas = 12) {
  if (S.radio === 'nao' || S.abastecendo || !S.semente) return;
  if (!window.Radio) { recadoRadio('Rádio não carregou (radio.js).'); return; }
  S.abastecendo = true;
  try {
    // tudo no navegador: o motor so usa /api/cd, /api/artista e /api/inicio
    // A semente ANDA: a cada lote, parte de um CD recente da fila em vez de
    // voltar sempre ao mesmo. Sem isso o grafo fica girando no mesmo bairro.
    const recente = S.fila.slice(-4).map((f) => f.link).filter(Boolean);
    const semente = S.radio === 'inteligente' && recente.length && Math.random() < 0.7
      ? recente[Math.floor(Math.random() * recente.length)]
      : S.semente;
    const r = await Radio.montarLote({
      modo: S.radio,
      semente,
      quantas,
      perfil: S.perfil,
      tocados: S.cdsTocados.slice(-30),
      recentes: S.fila.slice(-6).map((f) => f.usuario || '').filter(Boolean),
      // o que falta do CD aberto, pra entrar picado no meio da mistura
      faixasDoCd: S.radio === 'inteligente' ? S.lista : [],
      jaNaFila: S.fila.map((f) => f.id),
    });
    const ids = new Set(S.fila.map((f) => f.id));
    const novas = (r.faixas || []).filter((f) => !ids.has(f.id));
    if (!novas.length) {
      recadoRadio('A rádio não achou nada novo. Tente outro CD como semente.');
      return;
    }
    const comecavaVazia = S.i < 0 || !S.fila.length;
    const primeiraNova = S.fila.length;
    S.fila.push(...novas);
    if (S.original) S.original.push(...novas);
    S.cdsTocados = [...new Set([...S.cdsTocados, ...(r.cds || [])])].slice(-60);
    salvarFila(); salvarRadio();
    if (!$('#fila').hidden) desenharFila();
    recadoRadio('');
    // sem nada tocando, a radio comeca agora
    if (comecavaVazia) tocar(primeiraNova);
    else mostrarPlayer();
  } catch (e) {
    // radio e extra: a fila atual continua ate o fim, mas o motivo aparece
    recadoRadio('Rádio falhou: ' + e.message);
  } finally {
    S.abastecendo = false;
  }
}

/* Gosto implicito, mesma regra do servidor: pulou cedo conta contra, ouviu
   quase tudo conta a favor. Fica so neste navegador. */
function anotarFeedback(faixa, ouviu, duracao, pulou) {
  if (!faixa) return;
  const fracao = duracao > 0 ? ouviu / duracao : 0;
  let delta = 0;
  if (pulou && ouviu < 20) delta = -0.15;
  else if (fracao > 0.8) delta = 0.12;
  else if (fracao > 0.4) delta = 0.04;
  if (!delta) return;
  const mexer = (mapa, chave) => {
    if (!chave) return;
    mapa[chave] = Math.min(1.8, Math.max(0.4, (mapa[chave] || 1) + delta));
  };
  mexer(S.perfil.artistas, faixa.usuario);
  mexer(S.perfil.estilos, faixa.estilo);
  salvarRadio();
}

/* A radio e infinita, entao a fila cresceria pra sempre no localStorage.
   Guarda 10 atras (pra voltar) e tudo que vem pela frente. So com a radio
   ligada: fila montada na mao e sua, ninguem corta. */
const ATRAS = 10;
const PODAR_ACIMA_DE = 60;

function podarFila() {
  if (S.radio === 'nao' || S.fila.length <= PODAR_ACIMA_DE) return;
  const corte = S.i - ATRAS;
  if (corte <= 0) return;
  S.fila = S.fila.slice(corte);
  // sem ajustar o indice junto, o player pularia de musica na hora da poda
  S.i -= corte;
  if (S.original) S.original = S.original.slice(corte);
  salvarFila();
  if (!$('#fila').hidden) desenharFila();
}

function ligarRadio(modo, semente) {
  S.radio = modo;
  S.semente = semente || S.semente;
  salvarRadio();
  atualizarBotoesRadio();
  if (modo === 'nao') return;
  // o primeiro lote passeia pelo grafo e pode levar alguns segundos
  recadoRadio('Procurando música…');
  // LIGAR A RADIO REFAZ A FILA AGORA: o que estava tocando continua, e o resto
  // ja vem misturado. Antes a radio so emendava depois do CD inteiro.
  const atual = S.fila[S.i];
  if (atual) {
    S.fila = [atual];
    S.i = 0;
    S.original = null;
    salvarFila();
    if (!$('#fila').hidden) desenharFila();
  }
  abastecer(12);
}

/* Recado da radio na tela. Texto vazio volta pro estado normal. Sem isso a
   falha ia so pro console e a tela ficava dizendo "ligada" sem tocar nada. */
function recadoRadio(texto) {
  const aviso = $('#radioAviso');
  if (!aviso) return;
  if (texto) { aviso.textContent = texto; return; }
  atualizarBotoesRadio();
}

function atualizarBotoesRadio() {
  document.querySelectorAll('[data-radio]').forEach((b) => {
    b.setAttribute('aria-pressed', String(b.dataset.radio === S.radio));
  });
  const aviso = $('#radioAviso');
  if (aviso) {
    aviso.textContent = S.radio === 'nao' ? ''
      : S.radio === 'artista' ? 'Rádio ligada: só este artista'
      : 'Rádio ligada: misturando parecidos';
  }
}

/* -------------------------------------------- tela apagada e assinatura */

/* Os links do CloudFront vencem em ~11h e a fila mora no localStorage. Com
   o celular bloqueado numa radio longa, a faixa seguinte chegaria com link
   vencido e o player tocaria silencio. Entao: antes de tocar, se faltar
   menos de 5 min pro vencimento (ou nem der pra ler), pede link novo. */
function venceEm(url) {
  const m = String(url || '').match(/[?&]Expires=(\d+)/);
  return m ? Number(m[1]) : 0;
}

function precisaReassinar(url) {
  const v = venceEm(url);
  return !v || v - Math.floor(Date.now() / 1000) < 300;
}

async function reassinar(faixas) {
  const alvos = faixas.filter((f) => f && f.audio && precisaReassinar(f.audio));
  if (!alvos.length) return;
  const q = alvos.map((f) => 'u=' + encodeURIComponent(f.audio)).join('&');
  const r = await api('/api/assinar?' + q);
  (r.links || []).forEach((novo, n) => { if (novo) alvos[n].audio = novo; });
  salvarFila();
}

/* Pre-carrega a proxima faixa num <audio> escondido. Com a tela apagada o
   navegador segura os timers, mas o que ja esta em buffer toca. */
const proximoAudio = new Audio();
proximoAudio.preload = 'auto';

function prepararProxima() {
  const f = S.fila[S.i + 1];
  if (!f || !f.audio) return;
  if (proximoAudio.getAttribute('src') === f.audio) return;
  proximoAudio.src = f.audio;
  proximoAudio.load();
}

/* Barra de progresso e botoes na tela de bloqueio. Sem setPositionState a
   barra do sistema fica parada, e sem playbackState o botao teima em play. */
function atualizarMediaSession() {
  if (!('mediaSession' in navigator)) return;
  navigator.mediaSession.playbackState = audio.paused ? 'paused' : 'playing';
  try {
    if (audio.duration && Number.isFinite(audio.duration)) {
      navigator.mediaSession.setPositionState({
        duration: audio.duration,
        position: Math.min(audio.currentTime, audio.duration),
        playbackRate: audio.playbackRate || 1,
      });
    }
  } catch { /* navegador antigo: segue sem a barra */ }
}

/* ------------------------------------------------------------- player */

/* Tela acesa enquanto toca. Automatico: liga no play, solta no pause.
   O que ele NAO faz: impedir o bloqueio no botao lateral nem sobreviver a
   troca de aba. O sistema solta o wake lock nesses casos, e por isso existe
   o religa() no visibilitychange la embaixo. */
let travaTela = null;

async function manterTelaAcesa(ligar) {
  if (!('wakeLock' in navigator)) return;
  try {
    if (ligar && !travaTela) {
      travaTela = await navigator.wakeLock.request('screen');
      // o sistema pode soltar sozinho; sem isto a gente acharia que segue ligado
      travaTela.addEventListener('release', () => { travaTela = null; dep('wake lock solto'); });
      dep('tela acesa');
    } else if (!ligar && travaTela) {
      const t = travaTela;
      travaTela = null;
      await t.release();
      dep('tela liberada');
    }
  } catch (e) {
    // bateria fraca ou aba em segundo plano: o navegador recusa, e tudo bem
    dep('wake lock recusado: ' + e.name);
  }
}

let tentouProxy = false;
let tentouRenovar = false;

function tocar(indice) {
  if (indice < 0 || indice >= S.fila.length) return;
  // a faixa que estava tocando vira sinal de gosto (pulou cedo x ouviu tudo)
  const antes = S.fila[S.i];
  if (antes && audio.currentTime > 0) {
    anotarFeedback(antes, audio.currentTime, audio.duration || 0, indice !== S.i + 1 || audio.currentTime < (audio.duration || 0) - 2);
  }
  S.i = indice;
  salvarFila();
  const f = S.fila[indice];
  tentouProxy = false;
  tentouRenovar = false;
  /* NADA de rede antes do play. No Android a permissao de tocar anda junto
     com o gesto: um await aqui quebra a corrente e o Chrome recusa em
     silencio. Link vencido vira tratamento de ERRO, logo abaixo. */
  audio.src = f.audio;
  audio.play().catch((e) => { $('#pSub').textContent = 'Não tocou: ' + e.message; });
  mostrarPlayer();
  // com a radio ligada, completa antes de acabar: nada de silencio entre lotes
  if (S.radio !== 'nao' && S.fila.length - indice <= FALTANDO_PRA_ABASTECER) abastecer(12);
  podarFila();
  // deixa a proxima pronta: com a tela apagada, buffer e o que salva a emenda
  prepararProxima();
}

function proxima(automatico) {
  if (S.repetir === 'uma' && automatico) { audio.currentTime = 0; audio.play(); return; }
  if (S.i < S.fila.length - 1) return tocar(S.i + 1);
  // fim da fila com radio ligada: pede o lote e emenda quando chegar
  if (S.radio !== 'nao' && S.semente) {
    $('#pSub').textContent = 'Procurando mais música…';
    return abastecer(12).then(() => { if (S.i < S.fila.length - 1) tocar(S.i + 1); });
  }
  // fim da fila: com repetir a fila, volta pro comeco (sorteando de novo se aleatorio)
  if (S.repetir === 'fila' || (S.repetir === 'uma' && !automatico)) {
    if (S.aleatorio) { S.fila = embaralhar(S.fila); salvarFila(); }
    return tocar(0);
  }
}

// o CDN recusou o arquivo direto: uma tentativa pelo Worker. Se as duas
// falharem, PARA e mostra o aviso, em vez de atravessar a fila sem tocar.
audio.addEventListener('error', () => {
  const f = S.fila[S.i];
  if (!f || !audio.getAttribute('src')) return;
  /* 1o degrau: link vencido. Reabre o CD, que volta com as faixas assinadas
     agora. O /api/assinar so existe no player antigo; o Worker nao tem. */
  if (!tentouRenovar && f.link) {
    tentouRenovar = true;
    $('#pSub').textContent = 'Renovando o link…';
    api('/api/cd?link=' + encodeURIComponent(f.link)).then((cd) => {
      const nova = (cd.faixas || []).find((x) => x.id === f.id);
      if (!nova) throw new Error('faixa saiu do CD');
      f.audio = nova.audio;
      salvarFila();
      audio.src = f.audio;
      audio.play().catch((e) => { $('#pSub').textContent = 'Não tocou: ' + e.message; });
    }).catch((e) => { $('#pSub').textContent = 'Não renovou: ' + e.message; });
    return;
  }
  if (!tentouProxy) {
    tentouProxy = true;
    audio.src = API + '/api/audio?u=' + encodeURIComponent(f.audio);
    audio.play().catch(() => {});
    return;
  }
  audio.removeAttribute('src');
  icone();
  $('#pSub').textContent = 'Não tocou essa faixa. Toque em próxima pra seguir.';
});
audio.addEventListener('ended', () => proxima(true));
audio.addEventListener('play', () => { icone(); atualizarMediaSession(); manterTelaAcesa(true); });
audio.addEventListener('pause', () => { icone(); atualizarMediaSession(); manterTelaAcesa(false); });
audio.addEventListener('loadedmetadata', atualizarMediaSession);
let ultimaPos = 0;
audio.addEventListener('timeupdate', () => {
  // a barra do sistema so precisa de 1 aviso por segundo; mais que isso pesa
  if (Math.abs(audio.currentTime - ultimaPos) > 1) { ultimaPos = audio.currentTime; atualizarMediaSession(); }
  const d = audio.duration || 0;
  $('#progressoCheio').style.width = d ? `${(audio.currentTime / d) * 100}%` : '0';
  $('#pTempo').textContent = minutos(audio.currentTime) + (d ? ' / ' + minutos(d) : '');
});

function minutos(s) {
  s = Math.floor(s || 0);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function icone() {
  $('#iTocar').innerHTML = audio.paused ? '<path d="M8 5v14l11-7z"/>' : '<path d="M6 5h4v14H6zM14 5h4v14h-4z"/>';
  $('#bTocar').setAttribute('aria-label', audio.paused ? 'Tocar' : 'Pausar');
}

const NOME_REPETIR = { nao: 'desligado', fila: 'a fila', uma: 'a faixa' };
function modos() {
  $('#bAleatorio').setAttribute('aria-pressed', String(S.aleatorio));
  $('#bRepetir').setAttribute('aria-pressed', String(S.repetir !== 'nao'));
  $('#bRepetir').setAttribute('aria-label', 'Repetir: ' + NOME_REPETIR[S.repetir]);
  $('#repUm').hidden = S.repetir !== 'uma';
}

function mostrarPlayer() {
  const f = S.fila[S.i];
  if (!f) { $('#player').hidden = true; return; }
  $('#player').hidden = false;
  $('#pCapa').src = f.capa;
  $('#pCapa').referrerPolicy = 'no-referrer';
  $('#pTitulo').textContent = f.titulo;
  $('#pSub').textContent = `${f.artista} · ${f.cd}`;
  icone();
  modos();
  marcarAtual();
  if (!$('#fila').hidden) desenharFila();
  // controles na tela de bloqueio do celular e nas teclas de midia
  if ('mediaSession' in navigator) {
    navigator.mediaSession.metadata = new MediaMetadata({ title: f.titulo, artist: f.artista, album: f.cd, artwork: [{ src: f.capa, sizes: '500x500' }] });
  }
}

function marcarAtual() {
  const atual = S.fila[S.i];
  tela.querySelectorAll('[data-faixa]').forEach((b) => {
    const f = S.lista[Number(b.dataset.faixa)];
    b.classList.toggle('atual', !!(f && atual && f.id === atual.id));
  });
}

function desenharFila() {
  const el = $('#fila');
  el.innerHTML = `<div class="fila-topo"><span>Fila · ${S.i + 1} de ${S.fila.length}</span>` +
      '<span class="fila-modos">' +
        `<button data-modo="aleatorio" aria-pressed="${S.aleatorio}">Aleatório</button>` +
        `<button data-modo="repetir" aria-pressed="${S.repetir !== 'nao'}">Repetir ${S.repetir === 'uma' ? 'a faixa' : S.repetir === 'fila' ? 'a fila' : ''}</button>` +
      (S.radio !== 'nao' ? `<button data-radio="nao">Parar rádio</button>` : '') +
      '</span><button data-limpar>Limpar</button></div>' +
    S.fila.map((f, n) => `<button class="faixa ${n === S.i ? 'atual' : ''}" data-fila="${n}">` +
      `<span class="n">${n + 1}</span><span class="t">${esc(f.titulo)}</span>` +
      (n === S.i ? '' : `<span class="x" data-tirar="${n}" aria-label="Tirar da fila">×</span>`) + '</button>').join('');
}

function alternarAleatorio() {
  S.aleatorio = !S.aleatorio;
  guardar('mus:aleatorio', S.aleatorio);
  aplicarAleatorio();
  modos();
  if (!$('#fila').hidden) desenharFila();
}
function alternarRepetir() {
  S.repetir = { nao: 'fila', fila: 'uma', uma: 'nao' }[S.repetir];
  guardar('mus:repetir', S.repetir);
  modos();
  if (!$('#fila').hidden) desenharFila();
}

$('#bTocar').onclick = () => {
  if (!audio.getAttribute('src') && S.fila[S.i]) return tocar(S.i);
  audio.paused ? audio.play() : audio.pause();
};
$('#bProxima').onclick = () => proxima(false);
$('#bAnterior').onclick = () => (audio.currentTime > 3 ? (audio.currentTime = 0) : tocar(S.i - 1));
$('#bAleatorio').onclick = alternarAleatorio;
$('#bRepetir').onclick = alternarRepetir;
$('#bFila').onclick = () => { const el = $('#fila'); el.hidden = !el.hidden; if (!el.hidden) desenharFila(); };

// arrastar ou tocar na barra pra avancar
$('#progresso').addEventListener('pointerdown', (e) => {
  const barra = e.currentTarget;
  const mover = (ev) => {
    const r = barra.getBoundingClientRect();
    if (audio.duration) audio.currentTime = Math.min(Math.max((ev.clientX - r.left) / r.width, 0), 1) * audio.duration;
  };
  mover(e);
  barra.setPointerCapture(e.pointerId);
  barra.onpointermove = mover;
  barra.onpointerup = () => { barra.onpointermove = null; };
});

if ('mediaSession' in navigator) {
  const acao = (nome, fn) => {
    // navegador que nao conhece a acao lanca; ignorar e o certo
    try { navigator.mediaSession.setActionHandler(nome, fn); } catch { /* sem essa acao */ }
  };
  acao('play', () => { audio.play(); atualizarMediaSession(); });
  acao('pause', () => { audio.pause(); atualizarMediaSession(); });
  acao('nexttrack', () => proxima(false));
  acao('previoustrack', () => (audio.currentTime > 3 ? (audio.currentTime = 0) : tocar(S.i - 1)));
  acao('stop', () => { audio.pause(); audio.currentTime = 0; atualizarMediaSession(); });
  acao('seekto', (e) => {
    if (e.fastSeek && 'fastSeek' in audio) audio.fastSeek(e.seekTime);
    else audio.currentTime = e.seekTime;
    atualizarMediaSession();
  });
  acao('seekbackward', (e) => { audio.currentTime = Math.max(0, audio.currentTime - (e.seekOffset || 10)); });
  acao('seekforward', (e) => { audio.currentTime = Math.min(audio.duration || 0, audio.currentTime + (e.seekOffset || 10)); });
}

/* Voltando do bloqueio: o navegador pode ter parado a faixa. Se o player
   estava tocando, retoma; se a assinatura venceu enquanto estava fora,
   renova a fila que vem a seguir. */
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  // o wake lock cai quando a aba sai de cena: religa ao voltar, se ainda toca
  if (!audio.paused) manterTelaAcesa(true);
  atualizarMediaSession();
  reassinar(S.fila.slice(S.i, S.i + 4)).catch(() => {});
});

/* ------------------------------------------------------------ cliques */

document.addEventListener('click', (e) => {
  const alvo = e.target.closest('[data-link],[data-artista],[data-voltar],[data-faixa],[data-tocar-lista],[data-enfileirar],[data-fila],[data-tirar],[data-limpar],[data-modo],[data-radio]');
  if (!alvo) return;
  const d = alvo.dataset;
  if (d.link) return abrirCd(d.link);
  if (d.artista) { location.hash = '#/artista/' + d.artista; return; }
  if ('voltar' in d) { history.length > 1 ? history.back() : (location.hash = '#/'); return; }
  if (d.modo) return d.modo === 'aleatorio' ? alternarAleatorio() : alternarRepetir();
  if (d.radio) {
    // tocar no modo ja ligado desliga a radio
    const novo = d.radio === S.radio ? 'nao' : d.radio;
    ligarRadio(novo, d.semente);
    if (!$('#fila').hidden) desenharFila();
    return;
  }

  // tocar uma faixa da tela: a fila vira a lista inteira, a partir dela
  if (d.faixa !== undefined && S.lista.length) return tocarLista(S.lista, Number(d.faixa));
  if ('tocarLista' in d && S.lista.length) return tocarLista(S.lista, 0);
  if ('enfileirar' in d && S.lista.length) {
    const ids = new Set(S.fila.map((f) => f.id));
    const novas = S.lista.filter((f) => !ids.has(f.id));
    S.fila.push(...novas);
    if (S.original) S.original.push(...novas);
    salvarFila();
    if (S.i < 0) { S.i = 0; mostrarPlayer(); }
    alvo.textContent = 'Na fila ✓';
    if (!$('#fila').hidden) desenharFila();
    return;
  }
  if (d.tirar !== undefined) {
    e.stopPropagation();
    const n = Number(d.tirar);
    const [saiu] = S.fila.splice(n, 1);
    if (S.original) S.original = S.original.filter((f) => f.id !== saiu.id);
    if (n < S.i) S.i--;
    salvarFila();
    return desenharFila();
  }
  if (d.fila !== undefined) return tocar(Number(d.fila));
  if ('limpar' in d) {
    audio.pause(); audio.removeAttribute('src');
    S.fila = []; S.i = -1; S.original = null; salvarFila();
    // sem isso a radio reabastece uma fila que voce acabou de limpar
    S.radio = 'nao'; salvarRadio(); atualizarBotoesRadio();
    $('#fila').hidden = true; $('#player').hidden = true;
  }
});

// a busca aceita nome de musica ou artista; se colar um link de CD, abre o CD
$('#formBusca').addEventListener('submit', (e) => {
  e.preventDefault();
  const v = $('#campoBusca').value.trim();
  if (!v) return;
  if (/suamusica\.com\.br\/[\w.-]+\/[\w.-]+/.test(v)) return abrirCd(v);
  if (v.length < 2) return;
  $('#campoBusca').blur();
  location.hash = '#/busca/' + encodeURIComponent(v);
});

window.addEventListener('hashchange', rotear);
rotear();
modos();
// volta com a fila de antes, parada (o navegador so toca depois de um toque)
if (S.fila[S.i]) mostrarPlayer();
atualizarBotoesRadio();
