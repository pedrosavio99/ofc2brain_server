/**
 * Papel: Motor de inteligencia do TrendRadar AI com suporte a Google Gemini (2.5 Flash / 2.5 Pro / 2.0 Flash), Groq opcional e fallback heuristico local.
 * Suporta rodizio de multiplas chaves separadas por virgula (padrao do Segundo Cerebro).
 * O que NAO faz: Nao importa o host, nao inventa numeros da serie temporal e nunca falha sem retornar o fallback local.
 */

export const MODELOS_DISPONIVEIS = [
  { id: "gemini-2.5-flash", provedor: "gemini", rotulo: "Gemini 2.5 Flash (Recomendado - Rapido e Preciso)" },
  { id: "gemini-2.5-pro", provedor: "gemini", rotulo: "Gemini 2.5 Pro (Raciocinio Profundo)" },
  { id: "gemini-2.0-flash", provedor: "gemini", rotulo: "Gemini 2.0 Flash (Baixa Latencia)" },
  { id: "groq", provedor: "groq", rotulo: "Groq Cloud (Alternativo)" },
  { id: "local", provedor: "local", rotulo: "Heuristica Deterministica Local (Sem gastar cota)" }
];

function extrairListaChaves(bruto) {
  return String(bruto || "")
    .split(",")
    .map((c) => c.trim())
    .filter((c) => c && c !== "coloque_sua_chave_aqui");
}

function extrairJsonSeguro(texto) {
  const limpo = String(texto || "").replace(/```json/gi, "").replace(/```/g, "").trim();
  if (!limpo) return null;
  try {
    return JSON.parse(limpo);
  } catch {
    const ini = limpo.indexOf("{");
    const fim = limpo.lastIndexOf("}");
    if (ini !== -1 && fim > ini) {
      try {
        return JSON.parse(limpo.slice(ini, fim + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}

/* ==========================================================================
   1. HEURISTICA DETERMINISTICA LOCAL (FALLBACK OBRIGATORIO)
   ========================================================================== */
export function heuristica(itens = []) {
  const copia = Array.isArray(itens) ? [...itens] : [];
  copia.sort((a, b) => {
    const scoreA =
      Number(a.pontuacao || 0) * 0.5 +
      Number(a.consistenciaScore || 0) * 0.3 +
      Number(a.crescimentoPct || 0) * 0.2;
    const scoreB =
      Number(b.pontuacao || 0) * 0.5 +
      Number(b.consistenciaScore || 0) * 0.3 +
      Number(b.crescimentoPct || 0) * 0.2;
    return scoreB - scoreA;
  });
  return copia.map((item) => item.id);
}

export function gerarSinteseLocal(itens = [], objetivoFoco = "todos") {
  const ordenados = heuristica(itens)
    .map((id) => itens.find((x) => x.id === id))
    .filter(Boolean);

  const lider = ordenados[0] || null;
  const consistentes = ordenados.filter((x) => Number(x.consistenciaScore || 0) >= 75);
  const picos = ordenados.filter((x) => Number(x.consistenciaScore || 0) < 60);

  if (!lider) {
    return {
      fonte: "local",
      modelo: "",
      ordem: [],
      resumoExecutivo: "Nenhuma oportunidade carregada no momento. Importe um CSV do Google Trends ou pesquise um alvo.",
      hipotesePrincipal: "Adicione termos de pesquisa para cruzar sinais de busca, noticias e reclamacoes.",
      riscosCriticos: ["Sem dados suficientes para comparacao historica."],
      validacaoSugerida: "Importar serie historica via CSV ou pesquisar um novo alvo.",
      recomendacaoPorObjetivo: {
        carreira: "Construa o pipeline de ingestao e validacao de series temporais.",
        saas: "Mapeie nichos B2B com dores operacionais repetitivas.",
        empresas: "Ofereca diagnostico de tendencias baseado em dados reais.",
        agente: "Configure a rotina de coleta e gere dossies executivos em Markdown e PDF."
      }
    };
  }

  const focoTexto = {
    carreira: "Destaque de Portfólio: demonstre o cruzamento de fontes independentes e deteccao de sazonalidade em " + lider.nome + ".",
    saas: "Oportunidade de SaaS: " + lider.nome + " apresenta score " + lider.pontuacao + "/100 com alta recorrencia e dor clara em PMEs.",
    empresas: "Servico B2B: aborde empresas afetadas por '" + (lider.reclamacoes?.[0]?.dor || "gargalos manuais") + "' oferecendo piloto de 14 dias.",
    agente: "Monitoramento Autonomo: crescimento de " + lider.crescimentoPct + "% com indice de consistencia de " + lider.consistenciaScore + "%."
  };

  return {
    fonte: "local",
    modelo: "",
    ordem: ordenados.map((x) => x.id),
    resumoExecutivo:
      "Analise heuristica local sobre " +
      ordenados.length +
      " oportunidades monitoradas nas 6 frentes. A oportunidade lider e '" +
      lider.nome +
      "' (score " +
      lider.pontuacao +
      "/100, variacao de " +
      lider.crescimentoPct +
      "%, consistencia " +
      lider.consistenciaScore +
      "%). " +
      consistentes.length +
      " tendencias mostram crescimento consistente sustentado por multiplas fontes, enquanto " +
      picos.length +
      " exigem cautela por comportamento de pico.",
    hipotesePrincipal:
      focoTexto[objetivoFoco] ||
      "A convergencia entre aumento de buscas por '" +
        lider.nome +
        "' e reclamacoes recorrentes sobre '" +
        (lider.reclamacoes?.[0]?.dor || "processos manuais lentos") +
        "' indica demanda reprimida por uma ferramenta focada em " +
        (lider.icpPagador || "operacoes B2B") +
        ".",
    riscosCriticos: [
      picos.length > 0
        ? "Evitar construir produto completo para '" + picos[0].nome + "' antes de confirmar retencao pos-pico."
        : "Risco de entrar com escopo amplo demais; recorte o MVP para uma unica dor critica.",
      "Dependencia de fonte unica: mantenha o cruzamento entre buscas, noticias e reclamacoes de usuarios."
    ],
    validacaoSugerida:
      lider.testeComercial ||
      "Entrevistar 5 gestores do segmento e testar interesse real com pagina de diagnostico ou projeto-piloto pago.",
    recomendacaoPorObjetivo: {
      carreira: lider.objetivos?.carreira || focoTexto.carreira,
      saas: lider.objetivos?.saas || focoTexto.saas,
      empresas: lider.objetivos?.empresas || focoTexto.empresas,
      agente: lider.objetivos?.agente || focoTexto.agente
    }
  };
}

/* ==========================================================================
   2. CHAMADA AUXILIAR AO GOOGLE GEMINI E GROQ (COM RODIZIO DE CHAVES)
   ========================================================================== */
async function chamarGeminiJson(promptTexto, cfg, modeloOverride = "") {
  const chaves = extrairListaChaves(cfg.geminiKey);
  if (!chaves.length) return null;

  const modelosEnv = String(process.env.GEMINI_MODELOS || cfg.geminiModel || "")
    .split(",")
    .map((m) => m.trim())
    .filter(Boolean);

  const candidatos = [];
  if (modeloOverride && modeloOverride.startsWith("gemini-")) {
    candidatos.push(modeloOverride);
  }
  for (const m of [...modelosEnv, "gemini-2.5-flash", "gemini-2.5-flash-lite", "gemini-2.0-flash"]) {
    if (m && !candidatos.includes(m)) candidatos.push(m);
  }

  let ultimoStatus = 0;
  let ultimoModelo = candidatos[0] || "gemini-2.5-flash";

  for (const modelo of candidatos) {
    ultimoModelo = modelo;
    const generationConfig = {
      temperature: 0.25,
      responseMimeType: "application/json"
    };
    if (modelo.includes("2.5-flash")) {
      generationConfig.thinkingConfig = { thinkingBudget: 0 };
    }

    for (const chave of chaves) {
      const url =
        "https://generativelanguage.googleapis.com/v1beta/models/" +
        encodeURIComponent(modelo) +
        ":generateContent?key=" +
        encodeURIComponent(chave);

      const controlador = new AbortController();
      const timeout = setTimeout(() => controlador.abort(), 22000);

      try {
        const resp = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: controlador.signal,
          body: JSON.stringify({
            contents: [{ role: "user", parts: [{ text: promptTexto }] }],
            generationConfig
          })
        });
        clearTimeout(timeout);

        if (!resp.ok) {
          ultimoStatus = resp.status;
          // Se o modelo nao existe (404), pula para o proximo modelo candidato
          if (resp.status === 404) break;
          continue;
        }

        const json = await resp.json();
        const partes = json?.candidates?.[0]?.content?.parts || [];
        const texto = partes.filter((p) => !p.thought).map((p) => p.text || "").join("") || partes[0]?.text || "";
        const dados = extrairJsonSeguro(texto);
        if (dados) {
          return { ok: true, modelo, dados };
        }
      } catch (_err) {
        clearTimeout(timeout);
      }
    }
  }

  if (ultimoStatus) {
    return { erroStatus: ultimoStatus, modelo: ultimoModelo };
  }
  return null;
}

async function chamarGroqJson(promptSistema, promptUsuario, cfg) {
  const chaves = extrairListaChaves(cfg.groqKey);
  if (!chaves.length) return null;

  const modeloGroq = cfg.groqModel || "llama-3.3-70b-versatile";
  let ultimoStatus = 0;

  for (const chave of chaves) {
    const controlador = new AbortController();
    const timeout = setTimeout(() => controlador.abort(), 14000);

    try {
      const resp = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + chave
        },
        signal: controlador.signal,
        body: JSON.stringify({
          model: modeloGroq,
          temperature: 0.25,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: promptSistema },
            { role: "user", content: promptUsuario }
          ]
        })
      });
      clearTimeout(timeout);

      if (!resp.ok) {
        ultimoStatus = resp.status;
        continue;
      }
      const json = await resp.json();
      const texto = json?.choices?.[0]?.message?.content || "";
      const dados = extrairJsonSeguro(texto);
      if (dados) {
        return { ok: true, modelo: modeloGroq, dados };
      }
    } catch (_err) {
      clearTimeout(timeout);
    }
  }

  if (ultimoStatus) {
    return { erroStatus: ultimoStatus, modelo: modeloGroq };
  }
  return null;
}

/* ==========================================================================
   3. SINTESE GERAL DO RADAR (GEMINI PRIMARIO -> GROQ -> LOCAL)
   ========================================================================== */
export async function sintetizarInteligencia(itens = [], cfg = {}, opcoes = {}) {
  const objetivoFoco = opcoes.objetivo || "todos";
  const preferencia = opcoes.modeloPreferido || cfg.modeloPreferido || cfg.geminiModel || "gemini-2.5-flash";
  const baseLocal = gerarSinteseLocal(itens, objetivoFoco);

  if (preferencia === "local" || (!cfg.geminiKey && !cfg.groqKey)) {
    return baseLocal;
  }

  const resumoDados = itens.slice(0, 10).map((item) => ({
    id: item.id,
    nome: item.nome,
    categoria: item.categoria,
    crescimentoPct: item.crescimentoPct,
    consistenciaScore: item.consistenciaScore,
    classificacaoCurva: item.classificacaoCurva,
    pontuacao: item.pontuacao,
    reclamacaoPrincipal: item.reclamacoes?.[0]?.dor || "",
    icpPagador: item.icpPagador
  }));

  const promptSistema =
    "Voce e o motor analitico do TrendRadar AI. Sua funcao e interpretar evidencias reais fornecidas no JSON sem inventar numeros. " +
    "Responda EXCLUSIVAMENTE em JSON valido em portugues com as chaves: " +
    "{\"ordem\": [ids ordenados por prioridade], \"resumoExecutivo\": \"string\", \"hipotesePrincipal\": \"string\", " +
    "\"riscosCriticos\": [\"string\"], \"validacaoSugerida\": \"string\", " +
    "\"recomendacaoPorObjetivo\": {\"carreira\": \"string\", \"saas\": \"string\", \"empresas\": \"string\", \"agente\": \"string\"}}. " +
    "Nao use travessao longo em nenhum texto.";

  const promptUsuario =
    "Objetivo em foco: " +
    objetivoFoco +
    "\nDados coletados e normalizados:\n" +
    JSON.stringify(resumoDados);

  // 1. Prioriza Google Gemini (a menos que o usuario tenha escolhido explicitamente 'groq')
  if (preferencia !== "groq" && cfg.geminiKey) {
    const resGemini = await chamarGeminiJson(
      promptSistema + "\n\n" + promptUsuario,
      cfg,
      preferencia.startsWith("gemini-") ? preferencia : cfg.geminiModel
    );
    if (resGemini && resGemini.ok && resGemini.dados) {
      const interpretado = resGemini.dados;
      return {
        fonte: "gemini",
        modelo: resGemini.modelo,
        ordem: Array.isArray(interpretado.ordem) && interpretado.ordem.length
          ? interpretado.ordem
          : baseLocal.ordem,
        resumoExecutivo: String(interpretado.resumoExecutivo || baseLocal.resumoExecutivo).replace(/\u2014/g, "-"),
        hipotesePrincipal: String(interpretado.hipotesePrincipal || baseLocal.hipotesePrincipal).replace(/\u2014/g, "-"),
        riscosCriticos: Array.isArray(interpretado.riscosCriticos)
          ? interpretado.riscosCriticos.map((r) => String(r).replace(/\u2014/g, "-"))
          : baseLocal.riscosCriticos,
        validacaoSugerida: String(interpretado.validacaoSugerida || baseLocal.validacaoSugerida).replace(/\u2014/g, "-"),
        recomendacaoPorObjetivo: {
          carreira: String(interpretado.recomendacaoPorObjetivo?.carreira || baseLocal.recomendacaoPorObjetivo.carreira).replace(/\u2014/g, "-"),
          saas: String(interpretado.recomendacaoPorObjetivo?.saas || baseLocal.recomendacaoPorObjetivo.saas).replace(/\u2014/g, "-"),
          empresas: String(interpretado.recomendacaoPorObjetivo?.empresas || baseLocal.recomendacaoPorObjetivo.empresas).replace(/\u2014/g, "-"),
          agente: String(interpretado.recomendacaoPorObjetivo?.agente || baseLocal.recomendacaoPorObjetivo.agente).replace(/\u2014/g, "-")
        }
      };
    }
  }

  // 2. Backup via Groq
  if (cfg.groqKey) {
    const resGroq = await chamarGroqJson(promptSistema, promptUsuario, cfg);
    if (resGroq && resGroq.ok && resGroq.dados) {
      const interpretado = resGroq.dados;
      return {
        fonte: "groq",
        modelo: resGroq.modelo,
        ordem: Array.isArray(interpretado.ordem) && interpretado.ordem.length
          ? interpretado.ordem
          : baseLocal.ordem,
        resumoExecutivo: String(interpretado.resumoExecutivo || baseLocal.resumoExecutivo).replace(/\u2014/g, "-"),
        hipotesePrincipal: String(interpretado.hipotesePrincipal || baseLocal.hipotesePrincipal).replace(/\u2014/g, "-"),
        riscosCriticos: Array.isArray(interpretado.riscosCriticos)
          ? interpretado.riscosCriticos.map((r) => String(r).replace(/\u2014/g, "-"))
          : baseLocal.riscosCriticos,
        validacaoSugerida: String(interpretado.validacaoSugerida || baseLocal.validacaoSugerida).replace(/\u2014/g, "-"),
        recomendacaoPorObjetivo: {
          carreira: String(interpretado.recomendacaoPorObjetivo?.carreira || baseLocal.recomendacaoPorObjetivo.carreira).replace(/\u2014/g, "-"),
          saas: String(interpretado.recomendacaoPorObjetivo?.saas || baseLocal.recomendacaoPorObjetivo.saas).replace(/\u2014/g, "-"),
          empresas: String(interpretado.recomendacaoPorObjetivo?.empresas || baseLocal.recomendacaoPorObjetivo.empresas).replace(/\u2014/g, "-"),
          agente: String(interpretado.recomendacaoPorObjetivo?.agente || baseLocal.recomendacaoPorObjetivo.agente).replace(/\u2014/g, "-")
        }
      };
    }
  }

  return baseLocal;
}

/* ==========================================================================
   4. GERADOR PROFUNDO DE DOSSIE DE PESQUISA (PARA QUALQUER TERMO PESQUISADO)
   ========================================================================== */
function gerarDossieLocalPlausivel(termo, tipoEntidade, metricas, payload = {}) {
  const tLower = termo.toLowerCase();
  let titulo = "Solucao B2B e Automacao Inteligente para " + termo;
  let frente = "fintech";
  let categoria = "Automacao & Inteligencia B2B";
  let entidades = [termo, "PMEs Brasileiras", "Decisores B2B"];
  let reclamacoes = [
    {
      dor:
        String(payload.dor || "").trim() ||
        "Equipes perdem horas semanais com planilhas manuais, dados desatualizados e falta de automacao pratica em " + termo + ".",
      frequencia: "Muito Alta",
      fonte: "Pesquisa de Mercado B2B & Comunidades",
      gravidade: "Critica"
    },
    {
      dor: "Ferramentas atuais do mercado sao caras, complexas de implantar e nao entregam retorno rapido para PMEs.",
      frequencia: "Alta",
      fonte: "Avaliacoes de Usuarios / ReclameAqui",
      gravidade: "Alta"
    }
  ];
  let concorrentes = [
    {
      nome: "Ferramentas Tradicionais e Planilhas Manuais",
      lacuna: "Exigem operacao manual constante e nao possuem inteligencia preditiva ou integracao nativa.",
      precoMedio: "R$ 250 a R$ 900/mes"
    }
  ];
  let icp =
    String(payload.icpPagador || "").trim() ||
    "Empresas de pequeno e medio porte (PMEs), agencias e gestores que dependem de " + termo + " para gerar receita ou reduzir custos.";

  if (/prospec|lead|venda|comercial|sdr|outbound|crm|client/.test(tLower)) {
    titulo = "Automacao de Prospeccao B2B, Enriquecimento de Leads e Follow-up Inteligente (" + termo + ")";
    frente = "fintech";
    categoria = "Vendas B2B, CRM & Revenue Operations";
    entidades = ["RD Station", "Exact Sales", "Apollo.io", "Speedio", "SDRs e Gestores Comerciais"];
    reclamacoes = [
      {
        dor: "Vendedores e SDRs gastam 65% do tempo garimpando CNPJ, telefone e decisor desatualizado em vez de conversar com clientes prontos para comprar.",
        frequencia: "Muito Alta",
        fonte: "Comunidades de Vendas B2B & LinkedIn",
        gravidade: "Critica"
      },
      {
        dor: "Abordagens frias genericas (cold mail/WhatsApp) tem taxa de resposta abaixo de 2% porque nao personalizam a dor real da empresa prospectada.",
        frequencia: "Muito Alta",
        fonte: "Pesquisas de Outbound Marketing Brasil",
        gravidade: "Critica"
      },
      {
        dor: "Mais de 50% dos leads quentes esfriam porque o vendedor esquece de fazer o 3o e 4o follow-up no momento certo.",
        frequencia: "Alta",
        fonte: "Benchmarks de Inside Sales",
        gravidade: "Alta"
      }
    ];
    concorrentes = [
      {
        nome: "Plataformas de Dados B2B (Econodata / Speedio / Apollo)",
        lacuna: "Vendem listas caras com contratos anuais pesados, mas nao fazem a pesquisa automatica do momento atual do cliente nem redigem a abordagem contextualizada.",
        precoMedio: "R$ 600 a R$ 2.500/mes"
      },
      {
        nome: "CRMs Tradicionais (Pipedrive / RD Station CRM)",
        lacuna: "Dependem que o vendedor preencha tudo na mao; funcionam como cobradores de tarefas e nao como geradores automaticos de oportunidades.",
        precoMedio: "R$ 150 a R$ 500/usuario"
      }
    ];
    icp =
      String(payload.icpPagador || "").trim() ||
      "Agencias B2B, empresas de software (SaaS), consultorias, contabilidades e distribuidoras com time comercial de 2 a 20 vendedores.";
  }

  return {
    nome: titulo,
    frente,
    categoria,
    entidadesRelacionadas: entidades,
    reclamacoes,
    concorrentes,
    icpPagador: icp,
    testeComercial:
      "Selecionar 10 empresas do público-alvo, entregar gratuitamente uma lista/auditoria com 20 oportunidades mapeadas em PDF e oferecer assinatura mensal ou setup de automação.",
    evidenciasConfirmadas: [
      "Busca ativa analisada para '" + termo + "' com consistencia estatistica de " + metricas.consistenciaScore + "%.",
      "Dor ligada diretamente a geracao de receita ou economia de tempo operacional (ROI facil de provar ao decisor)."
    ],
    evidenciasFaltantes: [
      "Validar em 5 conversas comerciais se o cliente prefere contratar como software self-service (SaaS) ou servico gerenciado (Done-For-You)."
    ],
    objetivos: {
      carreira: "Construir pipeline completo de enriquecimento de dados B2B + classificacao de relevancia com IA + exportacao de dossies em Markdown/PDF.",
      saas: "Micro-SaaS B2B com cobranca recorrente (R$ 197 a R$ 497/mes) focado em resolver a dor n.1 sem complexidade de ERP.",
      empresas: "Vender implantacao de maquina automatizada de '" + termo + "' para empresas (setup de R$ 2.000 a R$ 5.000 + mensalidade).",
      agente: "Agente autonomo que monitora sinais de mercado diariamente e prepara os dossies prontos para tomada de decisao."
    }
  };
}

export async function gerarDossiePesquisaIA(termo, tipoEntidade, metricas, sinaisExternos = {}, payload = {}, cfg = {}) {
  const basePlausivel = gerarDossieLocalPlausivel(termo, tipoEntidade, metricas, payload);
  const preferencia = cfg.modeloPreferido || cfg.geminiModel || "gemini-2.5-flash";

  if (preferencia === "local" || (!cfg.geminiKey && !cfg.groqKey)) {
    return basePlausivel;
  }

  const promptSistema =
    "Voce e um estrategista senior de produto SaaS, inteligencia B2B e engenharia de software no Brasil. " +
    "O usuario pesquisou um alvo no TrendRadar AI e precisa de um dossie de oportunidade de negocio REALISTA, PROFUNDO, PLAUSIVEL e ACIONAVEL para o mercado brasileiro. " +
    "Ignore manchetes de noticias aleatorias que nao tenham relacao com dores reais de software/negocios. " +
    "Responda EXCLUSIVAMENTE em JSON valido (sem travessao longo) com esta estrutura exata:\n" +
    "{\n" +
    "  \"nome\": \"Titulo executivo claro da oportunidade de software/servico em torno do termo\",\n" +
    "  \"frente\": \"saude | fintech | regtech | govtech | operacoes | ia_devtools\",\n" +
    "  \"categoria\": \"Nome do setor/subnicho B2B\",\n" +
    "  \"entidadesRelacionadas\": [\"3 a 5 empresas, ferramentas ou cargos reais ligados a esse tema no Brasil\"],\n" +
    "  \"reclamacoes\": [\n" +
    "    {\"dor\": \"Dor real, especifica e muito comum que empresas/profissionais sofrem nesse tema\", \"frequencia\": \"Muito Alta\", \"fonte\": \"Onde essa reclamacao ocorre (ex: Foruns B2B, ReclameAqui, Operacao Comercial)\", \"gravidade\": \"Critica\"},\n" +
    "    {\"dor\": \"Segunda dor operacional ou tecnica recorrente que um software resolveria\", \"frequencia\": \"Alta\", \"fonte\": \"Fonte real\", \"gravidade\": \"Alta\"}\n" +
    "  ],\n" +
    "  \"concorrentes\": [\n" +
    "    {\"nome\": \"Concorrentes reais que atuam nisso no Brasil\", \"lacuna\": \"Qual o ponto fraco deles que podemos explorar\", \"precoMedio\": \"Faixa em R$/mes\"}\n" +
    "  ],\n" +
    "  \"icpPagador\": \"Quem exatamente tem dinheiro e urgencia para pagar por essa solucao no Brasil\",\n" +
    "  \"testeComercial\": \"Passo a passo pratico para validar e vender um piloto em 7 dias sem gastar dinheiro\",\n" +
    "  \"evidenciasConfirmadas\": [\"2 evidencias reais de mercado que sustentam a oportunidade\"],\n" +
    "  \"evidenciasFaltantes\": [\"2 pontos que precisam ser validados antes de escalar\"],\n" +
    "  \"objetivos\": {\n" +
    "    \"carreira\": \"O que construir tecnicamente para impressionar recrutadores e demonstrar engenharia de ponta\",\n" +
    "    \"saas\": \"Como empacotar isso em um Micro-SaaS recorrente e quanto cobrar\",\n" +
    "    \"empresas\": \"Qual servico/consultoria ou projeto-piloto vender imediatamente para empresas\",\n" +
    "    \"agente\": \"O que o agente autonomo deve monitorar e automatizar continuamente nesse nicho\"\n" +
    "  }\n" +
    "}";

  const promptUsuario =
    "Termo pesquisado: " + termo + "\n" +
    "Tipo de entidade: " + tipoEntidade + "\n" +
    "ICP sugerido pelo usuario: " + (payload.icpPagador || "Nao informado") + "\n" +
    "Dor sugerida pelo usuario: " + (payload.dor || "Nao informada") + "\n" +
    "Metricas Google Trends obtidas: crescimento=" + metricas.crescimentoPct + "%, consistencia=" + metricas.consistenciaScore + "% (" + metricas.classificacaoCurva + ")\n" +
    "Sinais coletados nas APIs (use apenas se fizerem sentido para o negocio, descarte ruido): " + JSON.stringify(sinaisExternos);

  if (preferencia !== "groq" && cfg.geminiKey) {
    const resGemini = await chamarGeminiJson(
      promptSistema + "\n\n" + promptUsuario,
      cfg,
      preferencia.startsWith("gemini-") ? preferencia : cfg.geminiModel
    );
    if (resGemini && resGemini.ok && resGemini.dados && resGemini.dados.nome) {
      const d = resGemini.dados;
      return {
        nome: String(d.nome || basePlausivel.nome).replace(/\u2014/g, "-"),
        frente: ["saude", "fintech", "regtech", "govtech", "operacoes", "ia_devtools"].includes(d.frente)
          ? d.frente
          : basePlausivel.frente,
        categoria: String(d.categoria || basePlausivel.categoria).replace(/\u2014/g, "-"),
        entidadesRelacionadas: Array.isArray(d.entidadesRelacionadas) && d.entidadesRelacionadas.length
          ? d.entidadesRelacionadas.map((x) => String(x).replace(/\u2014/g, "-"))
          : basePlausivel.entidadesRelacionadas,
        reclamacoes: Array.isArray(d.reclamacoes) && d.reclamacoes.length
          ? d.reclamacoes.map((r) => ({
              dor: String(r.dor || "").replace(/\u2014/g, "-"),
              frequencia: String(r.frequencia || "Alta"),
              fonte: String(r.fonte || "Pesquisa Setorial"),
              gravidade: String(r.gravidade || "Alta")
            }))
          : basePlausivel.reclamacoes,
        concorrentes: Array.isArray(d.concorrentes) && d.concorrentes.length
          ? d.concorrentes.map((c) => ({
              nome: String(c.nome || "").replace(/\u2014/g, "-"),
              lacuna: String(c.lacuna || "").replace(/\u2014/g, "-"),
              precoMedio: String(c.precoMedio || "R$ 200 a R$ 800/mes")
            }))
          : basePlausivel.concorrentes,
        icpPagador: String(d.icpPagador || basePlausivel.icpPagador).replace(/\u2014/g, "-"),
        testeComercial: String(d.testeComercial || basePlausivel.testeComercial).replace(/\u2014/g, "-"),
        evidenciasConfirmadas: Array.isArray(d.evidenciasConfirmadas) && d.evidenciasConfirmadas.length
          ? d.evidenciasConfirmadas.map((x) => String(x).replace(/\u2014/g, "-"))
          : basePlausivel.evidenciasConfirmadas,
        evidenciasFaltantes: Array.isArray(d.evidenciasFaltantes) && d.evidenciasFaltantes.length
          ? d.evidenciasFaltantes.map((x) => String(x).replace(/\u2014/g, "-"))
          : basePlausivel.evidenciasFaltantes,
        objetivos: {
          carreira: String(d.objetivos?.carreira || basePlausivel.objetivos.carreira).replace(/\u2014/g, "-"),
          saas: String(d.objetivos?.saas || basePlausivel.objetivos.saas).replace(/\u2014/g, "-"),
          empresas: String(d.objetivos?.empresas || basePlausivel.objetivos.empresas).replace(/\u2014/g, "-"),
          agente: String(d.objetivos?.agente || basePlausivel.objetivos.agente).replace(/\u2014/g, "-")
        },
        geradoPorIa: "gemini (" + resGemini.modelo + ")"
      };
    }
  }

  if (cfg.groqKey) {
    const resGroq = await chamarGroqJson(promptSistema, promptUsuario, cfg);
    if (resGroq && resGroq.ok && resGroq.dados && resGroq.dados.nome) {
      const d = resGroq.dados;
      return {
        ...basePlausivel,
        nome: String(d.nome || basePlausivel.nome).replace(/\u2014/g, "-"),
        categoria: String(d.categoria || basePlausivel.categoria).replace(/\u2014/g, "-"),
        icpPagador: String(d.icpPagador || basePlausivel.icpPagador).replace(/\u2014/g, "-"),
        testeComercial: String(d.testeComercial || basePlausivel.testeComercial).replace(/\u2014/g, "-"),
        geradoPorIa: "groq (" + resGroq.modelo + ")"
      };
    }
  }

  return basePlausivel;
}
