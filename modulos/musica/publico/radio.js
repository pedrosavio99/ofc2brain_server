/* Radio, no NAVEGADOR.
 *
 * Nao existe rota de radio em lugar nenhum: tudo sai do que a API ja da.
 *   /api/cd      -> faixas assinadas + "Parecidos" (o grafo)
 *   /api/artista -> CDs do artista (modo "so este artista")
 * O resto e conta pura, e conta pura roda no celular sem servidor.
 *
 * Dois modos:
 *   artista      -> so CDs do mesmo artista, do mais tocado pro menos
 *   inteligente  -> anda pelos Parecidos, com regras de nao-monotonia
 */
(function () {
  const API = window.API_BASE || '';

  async function pedir(caminho) {
    const r = await fetch(API + caminho);
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.erro || `Falhou (${r.status})`);
    return d;
  }

  const LIXO = /vinheta|abertura|passa\s*som|agradecimento|chamada|spot|ficha\s*tecnica/i;
  const ehVinheta = (t) => LIXO.test(String(t || ''));

  function embaralhar(lista) {
    const a = lista.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  /* As 3 primeiras faixas costumam ser a musica de trabalho; o resto entra
     embaralhado, pra radio longa nao repetir sempre a mesma ordem. */
  function faixasFortes(cd, quantas) {
    const boas = (cd.faixas || []).filter((f) => f.audio && !ehVinheta(f.titulo));
    return [...boas.slice(0, 3), ...embaralhar(boas.slice(3))].slice(0, quantas);
  }

  // log normalizado: separa mil de um milhao sem deixar o hit dominar
  const popularidade = (p) => Math.min(1, Math.log10((Number(p) || 0) + 10) / 7);

  function pontuar(cd, ctx) {
    let nota = Math.pow(0.65, ctx.distancia || 0);          // cada salto tira 35%
    if (ctx.estilo && cd.estilo && cd.estilo === ctx.estilo) nota *= 1.35;
    nota *= (ctx.perfil.artistas[cd.usuario] || 1) * (ctx.perfil.estilos[cd.estilo] || 1);
    nota *= 0.6 + 0.4 * popularidade(cd.plays);
    if (ctx.tocados.includes(cd.link)) nota *= 0.15;         // ja rolou: quase fora
    const vezes = ctx.recentes.filter((u) => u === cd.usuario).length;
    return Math.max(0.0001, nota * Math.pow(0.5, vezes));
  }

  // sortear, e nao pegar o maior: e o que evita radio previsivel
  function sortear(itens, peso) {
    const total = itens.reduce((t, i) => t + peso(i), 0);
    if (total <= 0) return itens[0];
    let alvo = Math.random() * total;
    for (const i of itens) { alvo -= peso(i); if (alvo <= 0) return i; }
    return itens[itens.length - 1];
  }

  const JANELA_ARTISTA = 4;

  /* Regras que separam playlist de lista solta: no maximo 2 faixas seguidas
     do mesmo CD, artista so volta depois de 4 faixas, e 30% dos blocos vem
     do fundo do grafo (descoberta). */
  function montarSequencia({ candidatos, quantas, perfil, tocados, recentes, estilo, separarArtista }) {
    const saida = [];
    const usados = new Set();
    const janela = recentes.slice(-JANELA_ARTISTA);
    const jaTocados = tocados.slice();

    while (saida.length < quantas) {
      const descoberta = Math.random() < 0.3;
      const pool = candidatos.filter((c) => {
        if (usados.has(c.cd.link)) return false;
        if (separarArtista && janela.includes(c.cd.usuario)) return false;
        return descoberta ? c.distancia >= 2 : c.distancia <= 1;
      });
      let livres = pool.length ? pool : candidatos.filter((c) => !usados.has(c.cd.link));
      // acabou o catalogo: libera os mais antigos em vez de parar. Radio e infinita.
      if (!livres.length) { usados.clear(); janela.length = 0; livres = candidatos; }
      if (!livres.length) break;
      // artista que ainda nao apareceu neste lote entra primeiro: e o que faz
      // a mistura comecar logo, em vez de 5 faixas do mesmo cara
      const inedito = livres.filter((c) => !saida.some((f) => f.usuario === c.cd.usuario));
      if (inedito.length) livres = inedito;

      const alvo = sortear(livres, (c) => pontuar(c.cd, {
        distancia: c.distancia, estilo, perfil, tocados: jaTocados, recentes: janela,
      }));
      usados.add(alvo.cd.link);
      jaTocados.push(alvo.cd.link);

      // a semente (distancia 0) entra com 1 faixa: quem ligou a radio ja
      // conhece esse CD, a graca e o que vem depois
      const duas = alvo.distancia > 0 && Math.random() < 0.4;
      const quantasDaqui = Math.min(duas ? 2 : 1, quantas - saida.length);
      const faixas = faixasFortes(alvo.cd, quantasDaqui);
      if (!faixas.length) continue;
      faixas.forEach((f) => saida.push({ ...f, usuario: alvo.cd.usuario, estilo: alvo.cd.estilo }));
      janela.push(alvo.cd.usuario);
      while (janela.length > JANELA_ARTISTA) janela.shift();
    }
    return saida;
  }

  // cache de CD nesta aba: a radio pede o mesmo CD varias vezes
  const cache = new Map();
  function carregarCd(link) {
    if (cache.has(link)) return cache.get(link);
    const p = pedir('/api/cd?link=' + encodeURIComponent(link)).catch(() => null);
    cache.set(link, p);
    return p;
  }

  /* Busca em largura pelos Parecidos, com orcamento: cada CD e uma chamada,
     e ninguem espera 30s por uma radio. */
  async function expandirGrafo(semente, { limite = 12, prazoMs = 9000 } = {}) {
    const fim = Date.now() + prazoMs;
    const vistos = new Set();
    const achados = [];
    let fronteira = [{ link: semente, distancia: 0 }];

    for (let d = 0; d <= 2 && fronteira.length; d++) {
      const proxima = [];
      // a camada inteira em paralelo: e rede, nao CPU
      const lote = fronteira.filter((i) => !vistos.has(i.link));
      lote.forEach((i) => vistos.add(i.link));
      const cds = await Promise.all(lote.map((i) => carregarCd(i.link)));

      cds.forEach((cd, n) => {
        if (!cd || !(cd.faixas || []).length) return;
        achados.push({ cd, distancia: lote[n].distancia });
        (cd.parecidos || [])
          .slice().sort((a, b) => (b.plays || 0) - (a.plays || 0)).slice(0, 5)
          .forEach((p) => { if (!vistos.has(p.link)) proxima.push({ link: p.link, distancia: lote[n].distancia + 1 }); });
      });

      if (achados.length >= limite || Date.now() >= fim) break;
      fronteira = proxima;
    }
    return achados.slice(0, limite);
  }

  /* Os "Parecidos" do site sao quase sempre outros CDs do mesmo artista.
     Sem teto, o grafo nascia todo dele e a radio virava disco do artista. */
  function limitarPorArtista(lista, teto) {
    const conta = {};
    return lista.filter((c) => {
      const u = c.cd.usuario || '?';
      conta[u] = (conta[u] || 0) + 1;
      return conta[u] <= teto;
    });
  }

  async function candidatosDoArtista(usuario, semente) {
    const a = await pedir('/api/artista?u=' + encodeURIComponent(usuario));
    const links = (a.cds || [])
      .sort((x, y) => (y.plays || 0) - (x.plays || 0))
      .map((c) => c.link).filter((l) => l !== semente).slice(0, 8);
    const cds = (await Promise.all([semente, ...links].map(carregarCd))).filter((c) => c && c.faixas.length);
    return cds.map((cd, n) => ({ cd, distancia: n === 0 ? 0 : 1 }));
  }

  /**
   * Um lote de faixas pra emendar na fila.
   * @param {object} o { modo, semente (link do CD), quantas, perfil, tocados, recentes }
   */
  /* Intercala as faixas que faltam do CD com o que veio do grafo. Nunca
     duas do CD seguidas: a graca e ouvir o disco DENTRO da mistura, nao o
     disco inteiro e depois a mistura. */
  function intercalar(daRadio, doCd, fatia = 0.3) {
    if (!doCd.length) return daRadio;
    const quantasDoCd = Math.max(1, Math.round(daRadio.length * fatia));
    const escolhidas = embaralhar(doCd).slice(0, quantasDoCd);
    const saida = daRadio.slice();
    // espalha em posicoes separadas, comecando na 2a (a 1a e a que ja toca)
    const passo = Math.max(2, Math.floor(saida.length / (escolhidas.length + 1)));
    escolhidas.forEach((f, n) => saida.splice(Math.min(saida.length, 1 + passo * (n + 1)), 0, f));
    return saida;
  }

  async function montarLote({ modo = 'inteligente', semente, quantas = 12,
    perfil = { artistas: {}, estilos: {} }, tocados = [], recentes = [],
    faixasDoCd = [], jaNaFila = [] } = {}) {
    if (!semente) throw new Error('Sem CD de semente');
    const base = await carregarCd(semente);
    if (!base) throw new Error('Não consegui abrir o CD da rádio');

    let candidatos;
    if (modo === 'artista') {
      candidatos = await candidatosDoArtista(base.usuario, semente);
    } else {
      candidatos = limitarPorArtista(await expandirGrafo(semente), 2);
      // CD sem parecidos: completa com os destaques da home
      if (candidatos.length < 4) {
        const { destaques } = await pedir('/api/inicio').catch(() => ({ destaques: [] }));
        const extras = (await Promise.all((destaques || []).slice(0, 6).map((d) => carregarCd(d.link))))
          .filter((c) => c && c.faixas.length);
        candidatos = [...candidatos, ...extras.map((cd) => ({ cd, distancia: 2 }))];
      }
    }

    const faixas = montarSequencia({
      candidatos, quantas, perfil, tocados, recentes,
      estilo: base.estilo,
      // no modo artista, repetir o artista e o que voce pediu
      separarArtista: modo !== 'artista',
    });

    // catalogo curto demais pras regras: melhor a semente do que lista vazia
    let saida = faixas.length ? faixas
      : faixasFortes(base, quantas).map((f) => ({ ...f, usuario: base.usuario, estilo: base.estilo }));

    // o que falta do CD que voce estava ouvindo entra picado no meio
    const idsFora = new Set([...jaNaFila, ...saida.map((f) => f.id)]);
    const doCd = (faixasDoCd || [])
      .filter((f) => f && f.audio && !idsFora.has(f.id) && !ehVinheta(f.titulo))
      .map((f) => ({ ...f, usuario: base.usuario, estilo: base.estilo }));
    saida = intercalar(saida, doCd);

    return { faixas: saida, cds: [...new Set(saida.map((f) => f.link))], candidatos: candidatos.length };
  }

  window.Radio = { montarLote, faixasFortes, ehVinheta, pontuar, montarSequencia };
})();
