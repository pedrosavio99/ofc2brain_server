/* Segundo cerebro - visao sinaptica (Three.js).
   Depende de app.js: usa $, esc, corDaArea, relsDe, porLigacoes, S e abrirDetalhe.
   Por isso precisa ser carregado DEPOIS do app.js. */

/* ============================================================
   VISAO SINAPTICA (Three.js)
   Neuronios = notas (tamanho pelo grau, cor pela area).
   Axonios = ligacoes, com pulsos viajando de vez em quando.
   Layout por simulacao de forcas: repulsao geral, mola nas
   ligacoes e coesao por area, entao cada area vira um lóbulo.
   ============================================================ */
var G = {
  iniciado: false, carregandoLib: false,
  cena: null, cam: null, renderizador: null, raycaster: null, mouse: null,
  nos: {}, arestas: [], selecionado: null,
  camTheta: 0.6, camPhi: 1.2, camDist: 520,
  arrastando: false, moveu: false, ultimoX: 0, ultimoY: 0,
  texGlow: {}, texPulso: null, rodando: false, ultimoT: 0,
  // filtros e densidade da propria visao
  area: null, periodo: "tudo", densidade: 60, vizinhos: {},
  emLoop: false, energia: 1, quadro: 0,
};

/* O tema decide a TECNICA de desenho, nao so a cor:
   - escuro: blending aditivo (os neuronios somam luz e brilham)
   - claro: blending normal com cor solida, porque somar luz sobre fundo claro
     nao gera contraste nenhum (o pixel ja esta no maximo) e tudo sumiria. */
function temaEscuro() {
  var t = document.documentElement.dataset.tema;
  if (t === "escuro") return true;
  if (t === "claro") return false;
  return !!(window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches);
}

/* Cor do neuronio por area. No claro escurecemos e saturamos, senao o tom
   pastel do tema escuro fica ilegivel sobre fundo claro. */
function corDaAreaGrafo(area, escuro) {
  var chave = area || "sem-área", h = 0;
  for (var i = 0; i < chave.length; i++) h = (h * 31 + chave.charCodeAt(i)) >>> 0;
  return escuro
    ? "hsl(" + (h % 360) + ", 60%, 62%)"
    : "hsl(" + (h % 360) + ", 62%, 42%)";
}

function fundoDoGrafo(escuro) { return escuro ? 0x05060B : 0xEEF0F5; }

/* Aplica fundo e neblina conforme o tema (a cena e criada uma vez so). */
function aplicarTemaSinapse() {
  if (!G.iniciado) return;
  var escuro = temaEscuro();
  var cor = fundoDoGrafo(escuro);
  G.renderizador.setClearColor(cor, 1);
  if (G.cena.fog) G.cena.fog.color = new THREE.Color(cor);
}

function carregarThree() {
  if (window.THREE) return Promise.resolve(true);
  if (G.carregandoLib) return G.carregandoLib;
  G.carregandoLib = new Promise(function (resolve) {
    var s = document.createElement("script");
    s.src = "https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js";
    s.onload = function () { resolve(true); };
    s.onerror = function () { resolve(false); };
    document.head.appendChild(s);
  });
  return G.carregandoLib;
}

function abrirSinapse() {
  var el = $("#sinapse");
  el.classList.add("aberta");
  ajustarTravaScroll();
  $("#sinapseCarregando").classList.remove("oculto");
  $("#sinapseCarregando").textContent = "calibrando sinapses…";
  montarControlesSinapse(); // nao depende do 3D ter carregado

  carregarThree().then(function (ok) {
    if (!ok) {
      $("#sinapseCarregando").textContent = "não deu pra carregar a biblioteca 3D (sem internet?)";
      return;
    }
    iniciarSinapse();
    aplicarTemaSinapse();
    reconstruirGrafo();
  });
}

function fecharSinapse() {
  $("#sinapse").classList.remove("aberta");
  G.rodando = false;
  ajustarTravaScroll();
  G.selecionado = null;
  G.vizinhos = {};
  fichaNeuronio(null);
}
$("#btnSinapse").addEventListener("click", abrirSinapse);
$("#btnFechaSinapse").addEventListener("click", fecharSinapse);

function iniciarSinapse() {
  if (G.iniciado) { G.rodando = true; aquecer(); ligarLoop(); return; }
  var canvas = $("#telaSinapse");
  G.cena = new THREE.Scene();
  // Neblina só pra dar noção de profundidade. Estava em 0.0016, que engolia 50%
  // da cena na distância padrão e 99% no zoom máximo: era o "desfoque" que
  // apagava as ligações. Em 0.00028 fica em ~2% perto e ~14% bem longe.
  G.cena.fog = new THREE.FogExp2(fundoDoGrafo(temaEscuro()), 0.00028);
  G.cam = new THREE.PerspectiveCamera(55, 1, 1, 4000);
  G.renderizador = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, alpha: true });
  G.renderizador.setClearColor(fundoDoGrafo(temaEscuro()), 1);
  G.raycaster = new THREE.Raycaster();
  G.mouse = new THREE.Vector2(-2, -2);

  ajustarTamanho();
  window.addEventListener("resize", ajustarTamanho);
  ligarControles(canvas);
  G.iniciado = true;
  G.rodando = true;
  G.ultimoT = performance.now();
  ligarLoop();
}

/* Um loop, e so um. Sem esta trava, abrir e fechar a visao varias vezes deixava
   varias cadeias de requestAnimationFrame vivas ao mesmo tempo (cada uma
   rodando a fisica O(n^2)), e a interface inteira engasgava. */
function ligarLoop() {
  if (G.emLoop) return;
  G.emLoop = true;
  G.ultimoT = performance.now();
  requestAnimationFrame(animar);
}

/* "Reaquece" a simulacao: usado quando o grafo muda ou o usuario interage. */
function aquecer() { G.energia = 1; }

function ajustarTamanho() {
  if (!G.renderizador) return;
  var l = window.innerWidth, a = window.innerHeight;
  G.renderizador.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  G.renderizador.setSize(l, a, false);
  G.cam.aspect = l / a;
  G.cam.updateProjectionMatrix();
}

function texturaGlow(cor, escuro) {
  var chave = cor + (escuro ? "|d" : "|l");
  if (G.texGlow[chave]) return G.texGlow[chave];
  var tam = 128, c = document.createElement("canvas");
  c.width = c.height = tam;
  var ctx = c.getContext("2d");
  var t = new THREE.Color(cor);
  var r = Math.round(t.r * 255), g = Math.round(t.g * 255), b = Math.round(t.b * 255);
  var grad = ctx.createRadialGradient(tam / 2, tam / 2, 0, tam / 2, tam / 2, tam / 2);
  // nucleo compacto + halo curto: com um degrade muito difuso, varios neuronios
  // proximos somavam brilho (blending aditivo) e viravam uma mancha unica.
  if (escuro) {
    // nucleo compacto + halo curto (o halo e o que da o brilho)
    grad.addColorStop(0, "rgba(" + r + "," + g + "," + b + ",1)");
    grad.addColorStop(0.16, "rgba(" + r + "," + g + "," + b + ",0.92)");
    grad.addColorStop(0.4, "rgba(" + r + "," + g + "," + b + ",0.3)");
    grad.addColorStop(1, "rgba(" + r + "," + g + "," + b + ",0)");
  } else {
    // no claro: disco solido com borda suave, sem halo (halo sumiria no branco)
    grad.addColorStop(0, "rgba(" + r + "," + g + "," + b + ",1)");
    grad.addColorStop(0.62, "rgba(" + r + "," + g + "," + b + ",1)");
    grad.addColorStop(0.82, "rgba(" + r + "," + g + "," + b + ",0.55)");
    grad.addColorStop(1, "rgba(" + r + "," + g + "," + b + ",0)");
  }
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, tam, tam);
  var tex = new THREE.CanvasTexture(c);
  G.texGlow[chave] = tex;
  return tex;
}

/* semente por area: cada area nasce num canto da esfera */
function ancoraDaArea(area) {
  var chave = area || "sem-área", h = 2166136261;
  for (var i = 0; i < chave.length; i++) { h ^= chave.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  var theta = (h % 1000) / 1000 * Math.PI * 2;
  var phi = Math.acos(2 * ((h >>> 10) % 1000) / 1000 - 1);
  return new THREE.Vector3(Math.sin(phi) * Math.cos(theta), Math.sin(phi) * Math.sin(theta), Math.cos(phi));
}

function reconstruirGrafo() {
  if (!G.iniciado || !window.THREE) return;
  var carr = $("#sinapseCarregando");
  carr.classList.remove("oculto");

  Object.keys(G.nos).forEach(function (id) { G.cena.remove(G.nos[id].grupo); });
  G.arestas.forEach(function (a) {
    G.cena.remove(a.linha);
    if (a.pulso) G.cena.remove(a.pulso);
  });
  G.nos = {};
  G.arestas = [];
  G.selecionado = null;
  fichaNeuronio(null);

  var escuro = temaEscuro();
  var modo = escuro ? THREE.AdditiveBlending : THREE.NormalBlending;
  // pulso: branco brilha no escuro; no claro precisa ser escuro pra aparecer
  G.texPulso = texturaGlow(escuro ? "#ffffff" : "#2A2E45", escuro);

  var ideias = notasDoGrafo();
  var total = S.notas.length;
  $("#sinapseSub").textContent = ideias.length + (ideias.length === 1 ? " neurônio" : " neurônios") +
    (ideias.length < total ? " de " + total : "");
  montarControlesSinapse();
  if (!ideias.length) {
    carr.textContent = "sem notas ainda — guarde a primeira pra ver as sinapses.";
    return;
  }

  // grau = quantas ligacoes validas cada nota tem
  var grau = {}, existe = {};
  ideias.forEach(function (i) { grau[i.id] = 0; existe[i.id] = true; });
  ideias.forEach(function (i) {
    relsDe(i).forEach(function (r) {
      if (existe[relId(r)]) grau[i.id] = (grau[i.id] || 0) + 1;
    });
  });

  ideias.forEach(function (ideia) {
    var g = grau[ideia.id] || 0;
    var cor = corDaAreaGrafo(ideia.area, escuro);
    // Quanto mais conectado, maior o neuronio. Raiz quadrada porque area cresce
    // com o quadrado do raio: assim o tamanho percebido acompanha o numero de
    // ligacoes sem que os hubs virem manchas gigantes.
    var tamanho = Math.min(64, 14 + 12 * Math.sqrt(g));
    var mat = new THREE.SpriteMaterial({
      map: texturaGlow(cor, escuro), blending: modo, depthWrite: false, transparent: true,
    });
    var sprite = new THREE.Sprite(mat);
    sprite.scale.set(tamanho, tamanho, 1);
    var grupo = new THREE.Group();
    grupo.add(sprite);
    var base = ancoraDaArea(ideia.area).multiplyScalar(150 + Math.random() * 60);
    grupo.position.set(base.x + (Math.random() - .5) * 40, base.y + (Math.random() - .5) * 40, base.z + (Math.random() - .5) * 40);
    G.cena.add(grupo);
    G.nos[ideia.id] = {
      ideia: ideia, grupo: grupo, sprite: sprite, cor: cor,
      vel: new THREE.Vector3(), tamanho: tamanho,
    };
  });

  // arestas sem duplicar o par
  var vistos = {};
  ideias.forEach(function (i) {
    relsDe(i).forEach(function (r) {
      var outro = relId(r);
      if (!G.nos[outro] || outro === i.id) return;
      var chave = [i.id, outro].sort().join("|");
      if (vistos[chave]) return;
      vistos[chave] = true;
      var geo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
      var mat = new THREE.LineBasicMaterial({
        color: new THREE.Color(G.nos[i.id].cor).lerp(new THREE.Color(G.nos[outro].cor), .5),
        transparent: true, opacity: escuro ? .38 : .5, blending: modo,
      });
      var linha = new THREE.Line(geo, mat);
      G.cena.add(linha);
      G.arestas.push({ a: i.id, b: outro, linha: linha, pulsoT: -1, proximoPulso: Math.random() * 5, pulso: null });
    });
  });

  montarLegenda();
  aquecer(); // grafo novo: precisa se organizar de novo
  carr.classList.add("oculto");
}

/* Quais notas entram no grafo. Com a base grande, mostrar tudo vira novelo:
   filtramos por area e periodo, e cortamos pelas N mais conectadas. Nota sem
   nenhuma ligacao nao acrescenta leitura, entao sai primeiro. */
function notasDoGrafo() {
  var lista = S.notas.slice();

  if (G.area) lista = lista.filter(function (n) { return (n.area || "Sem área") === G.area; });

  if (G.periodo !== "tudo") {
    var dias = { "7d": 7, "30d": 30, "90d": 90 }[G.periodo];
    if (dias) {
      var corte = Date.now() - dias * 86400000;
      lista = lista.filter(function (n) {
        var t = new Date(n.criado_em).getTime();
        return !isNaN(t) && t >= corte;
      });
    }
  }

  if (G.densidade && lista.length > G.densidade) {
    lista = lista.slice().sort(porLigacoes).slice(0, G.densidade);
  }
  return lista;
}

function montarControlesSinapse() {
  var areas = {};
  S.notas.forEach(function (n) { areas[n.area || "Sem área"] = true; });
  var listaAreas = Object.keys(areas);

  var periodos = [{ id: "tudo", r: "Tudo" }, { id: "90d", r: "90d" }, { id: "30d", r: "30d" }, { id: "7d", r: "7d" }];
  var densidades = [{ id: 30, r: "30" }, { id: 60, r: "60" }, { id: 0, r: "Todas" }];

  var html = '<div class="sc-linha">' +
    '<span class="sc-rot">período</span>' +
    periodos.map(function (p) {
      return '<button class="sc-chip' + (G.periodo === p.id ? " on" : "") + '" data-g-periodo="' + p.id + '">' + p.r + "</button>";
    }).join("") +
    '<span class="sc-rot">mostrar</span>' +
    densidades.map(function (dd) {
      return '<button class="sc-chip' + (G.densidade === dd.id ? " on" : "") + '" data-g-dens="' + dd.id + '">' + dd.r + "</button>";
    }).join("") +
    "</div>";

  if (listaAreas.length > 1) {
    html += '<div class="sc-linha">' +
      '<button class="sc-chip' + (!G.area ? " on" : "") + '" data-g-area="">Todas as áreas</button>' +
      listaAreas.map(function (a) {
        return '<button class="sc-chip' + (G.area === a ? " on" : "") + '" data-g-area="' + esc(a) + '">' +
          '<i style="background:' + corDaAreaGrafo(a === "Sem área" ? null : a, temaEscuro()) + '"></i>' + esc(a) + "</button>";
      }).join("") + "</div>";
  }

  $("#sinapseControles").innerHTML = html;
}

/* Modo foco: ao selecionar um neuronio, so ele e os vizinhos diretos ficam
   acesos. E o que permite ler uma vizinhanca sem perder o mapa inteiro. */
function calcularVizinhos(id) {
  var viz = {};
  if (!id) return viz;
  viz[id] = true;
  G.arestas.forEach(function (a) {
    if (a.a === id) viz[a.b] = true;
    if (a.b === id) viz[a.a] = true;
  });
  return viz;
}

function montarLegenda() {
  var areas = {};
  S.notas.forEach(function (n) { areas[n.area || "Sem área"] = true; });
  var lista = Object.keys(areas).slice(0, 8);
  $("#legendaAreas").innerHTML = lista.map(function (a) {
    return '<span><i style="background:' + corDaAreaGrafo(a === "Sem área" ? null : a, temaEscuro()) + '"></i>' + esc(a) + "</span>";
  }).join("");
}

function passoSimulacao() {
  var ids = Object.keys(G.nos);
  if (!ids.length) return 0;
  var REPULSAO = 5600, MOLA = 0.0020, DIST_IDEAL = 150, CENTRO = 0.0022;
  var COESAO = 0.010, AMORT = 0.86, VEL_MAX = 9;

  var soma = {}, cont = {};
  ids.forEach(function (id) {
    var a = G.nos[id].ideia.area || "sem-área";
    if (!soma[a]) { soma[a] = new THREE.Vector3(); cont[a] = 0; }
    soma[a].add(G.nos[id].grupo.position);
    cont[a]++;
  });
  var centroide = {};
  Object.keys(soma).forEach(function (a) { centroide[a] = soma[a].clone().multiplyScalar(1 / cont[a]); });

  for (var i = 0; i < ids.length; i++) {
    var ni = G.nos[ids[i]];
    var forca = new THREE.Vector3();
    for (var j = 0; j < ids.length; j++) {
      if (i === j) continue;
      var nj = G.nos[ids[j]];
      var dir = new THREE.Vector3().subVectors(ni.grupo.position, nj.grupo.position);
      var distSq = Math.max(400, dir.lengthSq());
      dir.normalize().multiplyScalar(REPULSAO / distSq);
      forca.add(dir);
    }
    forca.add(ni.grupo.position.clone().multiplyScalar(-CENTRO));
    var c = centroide[ni.ideia.area || "sem-área"];
    if (c) forca.add(new THREE.Vector3().subVectors(c, ni.grupo.position).multiplyScalar(COESAO));
    ni.vel.add(forca);
  }

  G.arestas.forEach(function (a) {
    var na = G.nos[a.a], nb = G.nos[a.b];
    if (!na || !nb) return;
    var d = new THREE.Vector3().subVectors(nb.grupo.position, na.grupo.position);
    var dist = Math.max(1, d.length());
    var f = d.normalize().multiplyScalar((dist - DIST_IDEAL) * MOLA);
    na.vel.add(f);
    nb.vel.add(f.clone().multiplyScalar(-1));
  });

  var soma_mov = 0;
  ids.forEach(function (id) {
    var n = G.nos[id];
    n.vel.multiplyScalar(AMORT);
    if (n.vel.length() > VEL_MAX) n.vel.setLength(VEL_MAX);
    n.grupo.position.add(n.vel);
    soma_mov += n.vel.length();
  });
  var movimentoMedio = soma_mov / ids.length;

  G.arestas.forEach(function (a) {
    var na = G.nos[a.a], nb = G.nos[a.b];
    if (!na || !nb) return;
    var pos = a.linha.geometry.attributes.position;
    pos.setXYZ(0, na.grupo.position.x, na.grupo.position.y, na.grupo.position.z);
    pos.setXYZ(1, nb.grupo.position.x, nb.grupo.position.y, nb.grupo.position.z);
    pos.needsUpdate = true;
  });

  return movimentoMedio;
}

function atualizarPulso(a, dt) {
  var na = G.nos[a.a], nb = G.nos[a.b];
  if (!na || !nb) return;
  if (a.pulsoT < 0) {
    a.proximoPulso -= dt;
    if (a.proximoPulso <= 0) a.pulsoT = 0;
    if (a.pulso) a.pulso.visible = false;
    return;
  }
  a.pulsoT += dt * 0.9;
  if (!a.pulso) {
    var spr = new THREE.Sprite(new THREE.SpriteMaterial({
      map: G.texPulso, blending: temaEscuro() ? THREE.AdditiveBlending : THREE.NormalBlending,
      depthWrite: false, transparent: true,
    }));
    spr.scale.set(13, 13, 1);
    G.cena.add(spr);
    a.pulso = spr;
  }
  var p = Math.min(1, a.pulsoT);
  a.pulso.visible = true;
  a.pulso.position.lerpVectors(na.grupo.position, nb.grupo.position, p);
  a.pulso.material.opacity = Math.sin(p * Math.PI);
  if (a.pulsoT >= 1) {
    a.pulsoT = -1;
    a.proximoPulso = 1 + Math.random() * 4;
    a.pulso.visible = false;
  }
}

function animar() {
  if (!G.rodando) { G.emLoop = false; return; }
  requestAnimationFrame(animar);
  var agora = performance.now();
  var dt = Math.min(0.05, (agora - G.ultimoT) / 1000);
  G.ultimoT = agora;

  // A fisica so roda enquanto o grafo esta "quente". Quando ele assenta, paramos
  // de calcular O(n^2) por quadro e deixamos so a camera e os pulsos, que sao baratos.
  if (G.energia > 0.02) {
    var mov = passoSimulacao();
    G.energia = mov;
  }
  G.arestas.forEach(function (a) { atualizarPulso(a, dt); });

  // camera orbital
  var x = G.camDist * Math.sin(G.camPhi) * Math.cos(G.camTheta);
  var y = G.camDist * Math.cos(G.camPhi);
  var z = G.camDist * Math.sin(G.camPhi) * Math.sin(G.camTheta);
  G.cam.position.set(x, y, z);
  G.cam.lookAt(0, 0, 0);

  // modo foco: selecionado grande e aceso, vizinhos acesos, o resto apagado
  var focando = !!G.selecionado;
  Object.keys(G.nos).forEach(function (id) {
    var n = G.nos[id];
    var ehAlvo = G.selecionado === id;
    var ehVizinho = focando && G.vizinhos[id];
    var alvo = ehAlvo ? n.tamanho * 1.5 : (ehVizinho ? n.tamanho * 1.15 : n.tamanho);
    var atual = n.sprite.scale.x + (alvo - n.sprite.scale.x) * 0.18;
    n.sprite.scale.set(atual, atual, 1);
    var opAlvo = !focando ? 1 : (ehAlvo ? 1 : (ehVizinho ? 0.85 : 0.12));
    n.sprite.material.opacity += (opAlvo - n.sprite.material.opacity) * 0.18;
  });

  // arestas: so as que tocam o selecionado ficam visiveis no modo foco
  G.arestas.forEach(function (a) {
    var ligada = !focando || a.a === G.selecionado || a.b === G.selecionado;
    var base = temaEscuro() ? 0.38 : 0.5;
    var opAlvo = focando ? (ligada ? 0.9 : 0.06) : base;
    a.linha.material.opacity += (opAlvo - a.linha.material.opacity) * 0.18;
    if (a.pulso && focando && !ligada) a.pulso.visible = false;
  });

  G.renderizador.render(G.cena, G.cam);
}

function ligarControles(canvas) {
  function aoDown(x, y) { G.arrastando = true; G.moveu = false; G.ultimoX = x; G.ultimoY = y; }
  function aoMove(x, y) {
    if (!G.arrastando) return;
    var dx = x - G.ultimoX, dy = y - G.ultimoY;
    if (Math.abs(dx) + Math.abs(dy) > 2) G.moveu = true;
    aquecer();
    G.camTheta -= dx * 0.006;
    G.camPhi = Math.min(Math.PI - 0.15, Math.max(0.15, G.camPhi - dy * 0.006));
    G.ultimoX = x; G.ultimoY = y;
  }
  function aoUp(x, y) {
    G.arrastando = false;
    if (!G.moveu) aoClique(x, y, canvas);
  }
  canvas.addEventListener("mousedown", function (e) { aoDown(e.clientX, e.clientY); });
  window.addEventListener("mousemove", function (e) { aoMove(e.clientX, e.clientY); });
  window.addEventListener("mouseup", function (e) { if (G.arrastando) aoUp(e.clientX, e.clientY); });
  canvas.addEventListener("touchstart", function (e) { var t = e.touches[0]; aoDown(t.clientX, t.clientY); }, { passive: true });
  canvas.addEventListener("touchmove", function (e) { var t = e.touches[0]; aoMove(t.clientX, t.clientY); }, { passive: true });
  canvas.addEventListener("touchend", function (e) { var t = e.changedTouches[0]; aoUp(t.clientX, t.clientY); });
  canvas.addEventListener("wheel", function (e) {
    e.preventDefault();
    G.camDist = Math.min(1400, Math.max(120, G.camDist + e.deltaY * 0.4));
  }, { passive: false });
}

function aoClique(x, y, canvas) {
  var r = canvas.getBoundingClientRect();
  G.mouse.x = ((x - r.left) / r.width) * 2 - 1;
  G.mouse.y = -((y - r.top) / r.height) * 2 + 1;
  G.raycaster.setFromCamera(G.mouse, G.cam);
  var sprites = Object.keys(G.nos).map(function (id) { return G.nos[id].sprite; });
  var hits = G.raycaster.intersectObjects(sprites, false);
  if (!hits.length) { G.selecionado = null; G.vizinhos = {}; fichaNeuronio(null); return; }
  var alvo = hits[0].object;
  var achado = Object.keys(G.nos).filter(function (id) { return G.nos[id].sprite === alvo; })[0];
  G.selecionado = achado || null;
  G.vizinhos = calcularVizinhos(G.selecionado);
  fichaNeuronio(achado ? G.nos[achado].ideia : null);
}

function fichaNeuronio(ideia) {
  var antiga = document.querySelector(".ficha-neuronio");
  if (antiga) antiga.remove();
  $("#legendaAreas").style.display = ideia ? "none" : "flex";
  if (!ideia) return;

  var lig = relsDe(ideia).length;
  var acesos = Math.max(0, Object.keys(G.vizinhos).length - 1);
  var div = document.createElement("div");
  div.className = "ficha-neuronio";
  div.innerHTML =
    '<p class="rot">' + esc(ideia.area || "sem área") + " · " + lig + (lig === 1 ? " ligação" : " ligações") +
      (acesos ? " · " + acesos + " no foco" : "") + "</p>" +
    "<h4>" + esc(ideia.resumo || ideia.texto_original) + "</h4>" +
    "<p>" + esc(ideia.texto_original) + "</p>" +
    '<div class="acoes"><button class="primario" id="fichaAbrir">Abrir nota</button>' +
    '<button id="fichaFechar">Fechar</button></div>';
  $("#sinapse").appendChild(div);
  div.querySelector("#fichaAbrir").addEventListener("click", function () {
    fecharSinapse();
    abrirDetalhe(ideia.id);
  });
  div.querySelector("#fichaFechar").addEventListener("click", function () {
    G.selecionado = null;
    G.vizinhos = {};
    fichaNeuronio(null);
  });
}

/* Se o tema for "sistema" e o usuario mudar o modo do aparelho com a visao
   aberta, redesenha na hora tambem. */
if (window.matchMedia) {
  var mq = window.matchMedia("(prefers-color-scheme: dark)");
  var aoMudarSistema = function () {
    if (document.documentElement.dataset.tema !== "sistema") return;
    if (!document.getElementById("sinapse").classList.contains("aberta")) return;
    aplicarTemaSinapse();
    reconstruirGrafo();
  };
  if (mq.addEventListener) mq.addEventListener("change", aoMudarSistema);
  else if (mq.addListener) mq.addListener(aoMudarSistema);
}