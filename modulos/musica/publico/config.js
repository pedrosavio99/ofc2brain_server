// Onde fica a API da musica: o Worker da Cloudflare, chamado pelo NAVEGADOR.
//
// Medido, nao suposto: o servidor do 2brain na Vercel e barrado pelo Sua
// Musica (502 em 150ms, IP de datacenter), e o navegador passa nos dois
// ambientes. Por isso nao ha condicional de localhost aqui: e sempre o Worker.
window.API_BASE = 'https://teste-sm.pedro-sarmento-455.workers.dev';
