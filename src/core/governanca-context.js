"use strict";

const fs = require("fs");
const path = require("path");
const { fetch } = require("undici");

const DEFAULT_SOURCES = [
    "https://github.com/RBBNet/rbb/blob/master/governanca/reunioes_comite_executivo/README.md",
    "https://github.com/RBBNet/rbb/blob/master/governanca/README.md",
];

function normalizarChave(texto) {
    return String(texto || "")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, " ")
        .trim();
}

function limparNomePessoa(texto) {
    return String(texto || "")
        .replace(/\s*\([^)]*\)\s*/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

function extrairCategoriasGovernanca(markdown) {
    const resultado = {
        comDireitoVoto: {},
        semDireitoVoto: {},
    };

    if (!markdown) return resultado;

    const linhas = String(markdown).split(/\r?\n/);
    let modo = null;

    for (const linhaBruta of linhas) {
        const linha = linhaBruta.trim();
        if (!linha) continue;

        const chave = normalizarChave(linha);

        if (chave.includes("participes patronos")) {
            modo = "com";
            continue;
        }

        if (chave.includes("participes aderentes associados")) {
            modo = "com";
            continue;
        }

        if (chave.includes("participes aderentes parceiros")) {
            modo = "sem";
            continue;
        }

        if (!modo) continue;

        const item = linha.replace(/^[\-•◦*]+\s*/, "").trim();
        if (!item) continue;

        // Para de coletar ao entrar em seções fora da lista de partícipes.
        if (item.startsWith("#") || item.toLowerCase().startsWith("na terceira reunião")) {
            modo = null;
            continue;
        }

        const orgKey = normalizarChave(item);
        if (!orgKey) continue;

        if (modo === "com") {
            resultado.comDireitoVoto[orgKey] = item;
        } else if (modo === "sem") {
            resultado.semDireitoVoto[orgKey] = item;
        }
    }

    return resultado;
}

function extrairRepresentantesComite(markdown) {
    const representantes = {};
    if (!markdown) return representantes;

    const linhas = String(markdown).split(/\r?\n/);
    let emSecaoRepresentantes = false;
    let orgAtual = null;

    for (const linhaBruta of linhas) {
        const linha = linhaBruta.trim();
        if (!linha) continue;

        if (linha.startsWith("# ")) {
            const chaveHeading = normalizarChave(linha);
            if (chaveHeading.includes("representantes dos participes no comite executivo")) {
                emSecaoRepresentantes = true;
                orgAtual = null;
                continue;
            }

            if (
                emSecaoRepresentantes &&
                chaveHeading.includes("reunioes do comite executivo realizadas")
            ) {
                break;
            }
        }

        if (!emSecaoRepresentantes) continue;
        if (/^permalink:/i.test(linha)) continue;

        const ehBullet = /^[\-•◦*]+\s+/.test(linha);
        if (!ehBullet) {
            orgAtual = linha;
            const orgKey = normalizarChave(orgAtual);
            if (orgKey && !representantes[orgKey]) {
                representantes[orgKey] = {
                    org: orgAtual,
                    pessoas: {},
                };
            }
            continue;
        }

        if (!orgAtual) continue;

        const nome = limparNomePessoa(linha.replace(/^[\-•◦*]+\s*/, ""));
        if (!nome) continue;

        const orgKey = normalizarChave(orgAtual);
        const nomeKey = normalizarChave(nome);
        if (!orgKey || !nomeKey) continue;

        representantes[orgKey].pessoas[nomeKey] = nome;
    }

    return representantes;
}

function gerarBlocoEstruturadoPrompt(dados) {
    const linhas = [];

    linhas.push("## Referência estruturada (normalizada)");
    linhas.push("");
    linhas.push("### Partícipes com direito a voto");
    const comDireito = Object.values(dados.comDireitoVoto || {});
    if (comDireito.length) {
        comDireito.forEach((org) => linhas.push(`- ${org}`));
    } else {
        linhas.push("- Não identificado no contexto externo.");
    }

    linhas.push("");
    linhas.push("### Partícipes sem direito a voto");
    const semDireito = Object.values(dados.semDireitoVoto || {});
    if (semDireito.length) {
        semDireito.forEach((org) => linhas.push(`- ${org}`));
    } else {
        linhas.push("- Não identificado no contexto externo.");
    }

    linhas.push("");
    linhas.push("### Representantes oficiais no Comitê Executivo (resumo)");
    const reps = Object.values(dados.representantes || {});
    if (!reps.length) {
        linhas.push("- Não identificado no contexto externo.");
    } else {
        reps.forEach((registro) => {
            const nomes = Object.values(registro.pessoas || {}).slice(0, 6);
            if (nomes.length) {
                linhas.push(`- ${registro.org}: ${nomes.join(", ")}`);
            }
        });
    }

    return linhas.join("\n");
}

function construirDadosEstruturados(rawPorFonte) {
    const dados = {
        comDireitoVoto: {},
        semDireitoVoto: {},
        representantes: {},
    };

    const entradas = Object.entries(rawPorFonte || {});
    for (const [sourceUrl, markdown] of entradas) {
        if (!markdown) continue;

        if (/\/governanca\/readme\.md$/i.test(sourceUrl)) {
            const categorias = extrairCategoriasGovernanca(markdown);
            Object.assign(dados.comDireitoVoto, categorias.comDireitoVoto);
            Object.assign(dados.semDireitoVoto, categorias.semDireitoVoto);
        }

        if (/\/governanca\/reunioes_comite_executivo\/readme\.md$/i.test(sourceUrl)) {
            const reps = extrairRepresentantesComite(markdown);
            Object.assign(dados.representantes, reps);
        }
    }

    return dados;
}

function normalizarLista(fontes) {
    if (!fontes) return [];
    if (Array.isArray(fontes)) {
        return fontes.map((item) => String(item || "").trim()).filter(Boolean);
    }
    if (typeof fontes === "string") {
        return fontes
            .split(",")
            .map((item) => item.trim())
            .filter(Boolean);
    }
    return [];
}

function paraUrlRaw(url) {
    if (!url) return "";

    const limpa = String(url).trim();
    const githubBlob = limpa.match(
        /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/blob\/([^/]+)\/(.+)$/i
    );

    if (githubBlob) {
        const [, owner, repo, branch, filePath] = githubBlob;
        return `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${filePath}`;
    }

    return limpa;
}

function lerCache(cachePath) {
    if (!fs.existsSync(cachePath)) return {};

    try {
        return JSON.parse(fs.readFileSync(cachePath, "utf8"));
    } catch (_err) {
        return {};
    }
}

function salvarCache(cachePath, cache) {
    const cacheDir = path.dirname(cachePath);
    if (!fs.existsSync(cacheDir)) {
        fs.mkdirSync(cacheDir, { recursive: true });
    }

    fs.writeFileSync(cachePath, JSON.stringify(cache, null, 2), "utf8");
}

function normalizarTextoMarkdown(texto, maxChars) {
    const limpo = String(texto || "")
        .replace(/\r/g, "")
        .replace(/\t/g, "    ")
        .replace(/\n{3,}/g, "\n\n")
        .trim();

    if (!maxChars || limpo.length <= maxChars) {
        return limpo;
    }

    return `${limpo.slice(0, maxChars)}\n\n[conteúdo truncado]`;
}

async function baixarMarkdown(url, timeoutMs) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
        const response = await fetch(url, {
            signal: controller.signal,
            headers: { "User-Agent": "ata-service" },
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        return await response.text();
    } finally {
        clearTimeout(timer);
    }
}

async function carregarContextoGovernanca(baseDir, config) {
    const externalConfig = config?.externalContext || {};
    const fontes = normalizarLista(externalConfig.sources);
    const sources = fontes.length ? fontes : DEFAULT_SOURCES;
    const timeoutMs = Number(externalConfig.timeoutMs) || 20000;
    const maxCharsPerSource = Number(externalConfig.maxCharsPerSource) || 12000;

    const cachePath = path.join(baseDir, "result", "governanca-context-cache.json");
    const cache = lerCache(cachePath);

    const avisos = [];
    const blocos = [];
    const rawPorFonte = {};
    let houveAtualizacao = false;

    for (const source of sources) {
        const sourceUrl = paraUrlRaw(source);
        if (!sourceUrl) continue;

        try {
            const markdown = await baixarMarkdown(sourceUrl, timeoutMs);
            cache[sourceUrl] = {
                markdown,
                updatedAt: new Date().toISOString(),
            };
            houveAtualizacao = true;
            rawPorFonte[sourceUrl] = markdown;

            blocos.push({
                sourceUrl,
                texto: normalizarTextoMarkdown(markdown, maxCharsPerSource),
            });
        } catch (err) {
            const cacheEntry = cache[sourceUrl];
            if (cacheEntry?.markdown) {
                rawPorFonte[sourceUrl] = cacheEntry.markdown;
                avisos.push(
                    `Falha ao atualizar ${sourceUrl}; usando cache salvo em ${cacheEntry.updatedAt || "data desconhecida"}.`
                );
                blocos.push({
                    sourceUrl,
                    texto: normalizarTextoMarkdown(cacheEntry.markdown, maxCharsPerSource),
                });
            } else {
                avisos.push(
                    `Falha ao carregar ${sourceUrl} e não há cache local (${err.message || err}).`
                );
            }
        }
    }

    if (houveAtualizacao) {
        salvarCache(cachePath, cache);
    }

    const dadosEstruturados = construirDadosEstruturados(rawPorFonte);
    const blocoEstruturado = gerarBlocoEstruturadoPrompt(dadosEstruturados);

    const textoBruto = blocos.length
        ? blocos
              .map(
                  (bloco) =>
                      `### Fonte\n${bloco.sourceUrl}\n\n### Conteúdo\n${bloco.texto}`
              )
              .join("\n\n---\n\n")
        : "Não foi possível carregar o contexto externo de governança.";

    const textoPrompt = `${blocoEstruturado}\n\n---\n\n${textoBruto}`;

    return {
        textoPrompt,
        avisos,
        dadosEstruturados,
    };
}

module.exports = {
    carregarContextoGovernanca,
};
