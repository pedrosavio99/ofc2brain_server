/* TESTE, descartavel. Botao flutuante que pergunta ao SERVIDOR do 2brain se
   ele consegue falar com a API do modulo-playlist, e mostra o resultado.

   A tag deste script fica no <head>, junto das aba-*.js, entao o body ainda
   nao existe quando ele roda: por isso espera o DOMContentLoaded. Sem isso
   o document.body.append lanca e nada aparece, que foi o que aconteceu. */
(function () {
  var API_DIRETA = 'https://modulo-playlist.vercel.app';

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function iniciar() {
    if (document.querySelector('.mt-botao')) return;

    var css = document.createElement('style');
    css.textContent = [
      '.mt-botao{position:fixed;right:16px;bottom:calc(16px + env(safe-area-inset-bottom));z-index:9999;',
      'width:52px;height:52px;border-radius:50%;border:0;background:var(--acento,#0a84ff);color:#fff;',
      'font-size:22px;box-shadow:0 6px 20px rgba(0,0,0,.28);cursor:pointer}',
      '.mt-veu{position:fixed;inset:0;z-index:9998;background:rgba(0,0,0,.5);display:none}',
      '.mt-veu.abre{display:block}',
      '.mt-caixa{position:fixed;inset:auto 0 0 0;z-index:10000;max-height:86vh;overflow:auto;display:none;',
      'background:var(--superficie,#fff);color:var(--texto,#111);border-radius:18px 18px 0 0;padding:18px 16px 28px}',
      '.mt-caixa.abre{display:block}',
      '@media(min-width:640px){.mt-caixa{inset:auto auto 0 50%;transform:translateX(-50%);width:560px;border-radius:18px;margin-bottom:24px}}',
      '.mt-caixa h3{margin:0 0 4px;font-size:18px}',
      '.mt-selo{display:inline-block;padding:4px 10px;border-radius:999px;font-size:12.5px;font-weight:700;margin:8px 0}',
      '.mt-ok{background:rgba(52,199,89,.16);color:#1c8b3a}.mt-nao{background:rgba(255,59,48,.16);color:#c22}',
      '.mt-linha{font-size:12.5px;color:var(--texto-2,#666);font-family:ui-monospace,monospace;margin:2px 0;overflow-wrap:anywhere}',
      '.mt-grade{display:grid;grid-template-columns:repeat(auto-fill,minmax(92px,1fr));gap:8px;margin-top:10px}',
      '.mt-grade img{width:100%;aspect-ratio:1;object-fit:cover;border-radius:10px}',
      '.mt-grade span{display:block;font-size:11px;margin-top:3px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.mt-acoes{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px}',
      '.mt-acoes button{padding:8px 14px;border-radius:999px;border:0;font-size:13px;font-weight:600;cursor:pointer;',
      'background:var(--superficie-2,#eee);color:var(--texto,#111)}',
    ].join('');
    document.head.appendChild(css);

    var botao = document.createElement('button');
    botao.className = 'mt-botao';
    botao.type = 'button';
    botao.title = 'Teste da API de musica';
    botao.textContent = '\u266A';

    var veu = document.createElement('div');
    veu.className = 'mt-veu';
    var caixa = document.createElement('div');
    caixa.className = 'mt-caixa';
    document.body.append(botao, veu, caixa);
    console.log('[musica-teste] botao criado');

    function fechar() { veu.classList.remove('abre'); caixa.classList.remove('abre'); }
    veu.onclick = fechar;

    function linha(nome, r) {
      if (!r) return '';
      return '<p class="mt-linha">' + esc(nome) + ': HTTP ' + r.status + ' · ' + r.ms + 'ms' +
        (r.erro ? ' · ' + esc(r.erro) : '') + '</p>';
    }

    async function testar() {
      caixa.innerHTML = '<h3>Testando…</h3><p class="mt-linha">o servidor do 2brain esta chamando a API</p>';
      try {
        var resp = await fetch('/musica-teste/api/teste', { cache: 'no-store' });
        var r = await resp.json();
        var selo = r.passou
          ? '<span class="mt-selo mt-ok">servidor passou</span>'
          : '<span class="mt-selo mt-nao">servidor barrado</span>';
        caixa.innerHTML =
          '<h3>API de música pelo servidor</h3>' + selo +
          '<p class="mt-linha">' + esc(r.api) + '</p>' +
          linha('worker saude', r.saude) + linha('worker inicio', r.inicio) + linha('worker cd', r.cd) +
          linha('vercel inicio', r.vercel) +
          (r.destaques && r.destaques.length
            ? '<div class="mt-grade">' + r.destaques.map(function (d) {
                return '<div><img src="' + esc(d.capa) + '" alt="" referrerpolicy="no-referrer" />' +
                  '<span>' + esc(d.titulo) + '</span></div>';
              }).join('') + '</div>'
            : '<p class="mt-linha">nenhum destaque veio</p>') +
          '<div class="mt-acoes">' +
            '<button data-mt="navegador">Tentar pelo navegador</button>' +
            '<button data-mt="repetir">Repetir</button>' +
            '<button data-mt="fechar">Fechar</button>' +
          '</div>';
      } catch (e) {
        caixa.innerHTML = '<h3>Falhou</h3><p class="mt-linha">' + esc(e.message) + '</p>' +
          '<div class="mt-acoes"><button data-mt="repetir">Repetir</button>' +
          '<button data-mt="fechar">Fechar</button></div>';
      }
    }

    /* O navegador ja fala com a API (o player funciona). Se aqui passa e no
       servidor nao, o bloqueio e por ser IP de datacenter. */
    async function pelaNavegador() {
      var t = Date.now();
      try {
        var r = await fetch(API_DIRETA + '/api/inicio', { cache: 'no-store' });
        var d = await r.json();
        caixa.insertAdjacentHTML('beforeend',
          '<p class="mt-linha">navegador: HTTP ' + r.status + ' · ' + (Date.now() - t) + 'ms · ' +
          ((d.destaques || []).length) + ' destaques</p>');
      } catch (e) {
        caixa.insertAdjacentHTML('beforeend', '<p class="mt-linha">navegador: ' + esc(e.message) + '</p>');
      }
    }

    botao.onclick = function () { veu.classList.add('abre'); caixa.classList.add('abre'); testar(); };
    caixa.addEventListener('click', function (e) {
      var b = e.target.closest('[data-mt]');
      if (!b) return;
      if (b.dataset.mt === 'fechar') return fechar();
      if (b.dataset.mt === 'repetir') return testar();
      if (b.dataset.mt === 'navegador') return pelaNavegador();
    });
  }

  console.log('[musica-teste] script carregado');
  if (document.body) iniciar();
  else document.addEventListener('DOMContentLoaded', iniciar);
})();
