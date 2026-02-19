"use strict";

const fs = require("fs");
const path = require("path");
const { GoogleGenerativeAI } = require("@google/generative-ai");

const SEP_ITEM = "<<<ITEM>>>";
const SEP_EXTRA = "<<<EXTRA_PAUTA>>>";
const SEP_CABECALHO = "<<<CABECALHO>>>";

function carregarEnv(baseDir) {
    const envPath = path.join(baseDir, ".env");

    if (!fs.existsSync(envPath)) return;

    const linhas = fs.readFileSync(envPath, "utf8").split(/\r?\n/);

    for (const linhaBruta of linhas) {
        const linha = linhaBruta.trim();
        if (!linha || linha.startsWith("#")) continue;

        const idx = linha.indexOf("=");
        if (idx === -1) continue;

        const chave = linha.slice(0, idx).trim();
        const valorRaw = linha.slice(idx + 1).trim();
        const valor = valorRaw.replace(/^['\"]|['\"]$/g, "");

        if (!process.env[chave]) {
            process.env[chave] = valor;
        }
    }
}

function parseCabecalhoMeta(resposta) {
    const inicio = resposta.indexOf(SEP_CABECALHO);
    if (inicio === -1) return { meta: null, semCabecalho: resposta };

    const depois = resposta.slice(inicio + SEP_CABECALHO.length);
    const fimIdxRel = depois.search(new RegExp(`${SEP_ITEM}|${SEP_EXTRA}`));
    const bloco = (fimIdxRel === -1 ? depois : depois.slice(0, fimIdxRel)).trim();
    const semCabecalho =
        resposta.slice(0, inicio) + (fimIdxRel === -1 ? "" : depois.slice(fimIdxRel));

    const meta = {
        numAta: "",
        diaReuniao: "",
        mesReuniaoPorExtenso: "",
        anoReuniao: "",
    };

    bloco.split(/\r?\n/).forEach((linha) => {
        const idx = linha.indexOf(":");
        if (idx === -1) return;
        const chave = linha.slice(0, idx).trim().toLowerCase();
        const valor = linha.slice(idx + 1).trim();

        if (chave === "num_ata") meta.numAta = valor;
        if (chave === "dia_reuniao") meta.diaReuniao = valor;
        if (chave === "mes_reuniao_por_extenso") meta.mesReuniaoPorExtenso = valor;
        if (chave === "ano_reuniao") meta.anoReuniao = valor;
    });

    return { meta, semCabecalho };
}

function montarSecaoCabecalho(template, meta) {
    const valores = {
        "<num_ata>": meta?.numAta || "<num_ata>",
        "<dia_reunião>": meta?.diaReuniao || "<dia_reunião>",
        "<mês_reunião_por_extenso>":
            meta?.mesReuniaoPorExtenso || "<mês_reunião_por_extenso>",
        "<ano_reunião>": meta?.anoReuniao || "<ano_reunião>",
    };

    let texto = template;
    Object.entries(valores).forEach(([placeholder, valor]) => {
        texto = texto.split(placeholder).join(valor);
    });

    return texto;
}

function parseItens(resposta) {
    const { meta, semCabecalho } = parseCabecalhoMeta(resposta);
    const [parteItens, parteExtra] = semCabecalho.split(SEP_EXTRA);

    const itens = parteItens
        .split(SEP_ITEM)
        .map((s) => s.trim())
        .filter(Boolean);

    const extra = parteExtra ? parteExtra.trim() : null;

    return { itens, extra, metaCabecalho: meta };
}

function itensParaTexto(parsed) {
    const { itens, extra } = parsed;
    let texto = itens.map((item) => `${SEP_ITEM}\n${item}`).join("\n\n");
    if (extra) texto += `\n\n${SEP_EXTRA}\n${extra}`;
    return texto;
}

function partesVideo(videoUrl) {
    return {
        fileData: { fileUri: videoUrl },
        videoMetadata: { fps: 0.25 },
    };
}

const INSTRUCOES_FORMATO = `
\`\`\`
## Regras de formato de saída — OBRIGATÓRIAS

- A resposta deve conter EXCLUSIVAMENTE os itens delimitados pelas marcações abaixo.
- NÃO inclua cabeçalho, texto introdutório, conclusão ou qualquer conteúdo fora das marcações.
- Antes dos itens, inclua um bloco de metadados iniciado pela linha: <<<CABECALHO>>>
- Dentro de <<<CABECALHO>>>, informe exatamente estes campos (um por linha):
    num_ata: valor ou <num_ata>
    dia_reuniao: valor ou <dia_reunião>
    mes_reuniao_por_extenso: valor ou <mês_reunião_por_extenso>
    ano_reuniao: valor ou <ano_reunião>
- Cada item da pauta deve começar exatamente com a linha: <<<ITEM>>>
- Se houver discussões genuinamente extra-pauta, inclua-as em uma única seção final iniciada exatamente com a linha: <<<EXTRA_PAUTA>>>
- A seção <<<EXTRA_PAUTA>>> é opcional: omita-a se não houver discussões completamente fora da pauta.

## Exemplo do formato esperado (siga exatamente este padrão)
\`\`\`
<<<CABECALHO>>>
num_ata: 42
dia_reuniao: 19
mes_reuniao_por_extenso: fevereiro
ano_reuniao: 2026

<<<ITEM>>>
**Nome:** Aprovação da ata anterior
**Status:** abordado
**Resumo:** A ata foi aprovada por unanimidade. <Pessoa 1> sugeriu uma correção no item 3, que foi aceita.

<<<ITEM>>>
**Nome:** Planejamento do próximo trimestre
**Status:** retirado da pauta
**Justificativa:** O responsável não estava presente. O item será retomado na próxima reunião.

<<<EXTRA_PAUTA>>>
**Assunto:** Confraternização de fim de ano
**Resumo:** <Pessoa 2> trouxe a ideia de organizar um evento. Ficou de enviar uma proposta por e-mail.
\`\`\`
`;

function promptInicial() {
    return `Você é um assistente especializado em geração de atas de reunião. Sua tarefa é analisar o vídeo da reunião e produzir um relatório estruturado em português.

Também tente identificar, se possível, os seguintes dados da reunião: número da ata, dia, mês por extenso e ano.
Se não for possível identificar com confiança, mantenha os placeholders informados nas regras de formato.

## Regra fundamental — classificação dos itens da pauta

Antes de classificar qualquer discussão, siga este raciocínio em ordem:

1. Identifique todos os itens previstos na pauta da reunião.
2. Para cada discussão que ocorreu, pergunte-se: "Esta discussão aconteceu dentro do contexto de um item da pauta, mesmo que tangencialmente?" Se sim, ela pertence àquele item da pauta — inclua-a no resumo desse item. NÃO a classifique como extra-pauta.
3. Apenas classifique uma discussão como extra-pauta se ela for completamente independente de todos os itens da pauta e tiver surgido de forma autônoma, sem relação com nenhum dos tópicos pautados.
4. Em caso de dúvida, prefira encaixar a discussão no item de pauta mais relacionado.

## Conteúdo de cada item da pauta

Para cada item previsto na pauta, use exatamente os campos abaixo:
- **Nome:** nome do item
- **Status:** abordado | retirado da pauta | não abordado
- **Justificativa:** (somente se retirado da pauta) motivo, ou "não informado" se não houve justificativa
- **Resumo:** o que foi discutido e decidido, incluindo discussões relacionadas que ocorreram no contexto desse item. Cite brevemente quem falou o quê quando relevante.
- Quando não for possível identificar o nome do participante, use placeholders consistentes ao longo de todo o documento (ex: <Pessoa 1>, <Pessoa 2> — sempre o mesmo identificador para a mesma pessoa).

## Conteúdo da seção extra-pauta (somente se existir)

- **Assunto:** descrição do tema
- **Resumo:** o que foi discutido, com atribuição de falas relevantes (usando os mesmos placeholders)

${INSTRUCOES_FORMATO}`;
}

function promptPergunta(perguntaUsuario, itensTexto) {
    return `Você é um assistente especializado em reuniões. Abaixo estão as seções da ata de uma reunião que você já analisou anteriormente, seguidos de uma pergunta do usuário.

## Seções atuais da ata (contexto)

${itensTexto}

## Pergunta do usuário

${perguntaUsuario}

## Instrução

Responda apenas à pergunta acima. NÃO regenere as seções da ata nem produza uma nova ata. Seja direto e objetivo. Se a pergunta exigir referência a alguma seção, cite-a brevemente.`;
}

function promptAjusteSemVideo(ajuste, itensTexto) {
    return `Você é um assistente especializado em atas de reunião. Abaixo estão as seções da ata que você gerou anteriormente, seguidos de uma solicitação de ajuste do usuário.

## Seções atuais da ata

${itensTexto}

## Solicitação de ajuste

${ajuste}

## Instrução

Aplique o ajuste solicitado e retorne as seções atualizadas. Mantenha todos os padrões:
- Placeholders consistentes para nomes não identificados (<Pessoa 1>, <Pessoa 2>, etc.)
- O mesmo estilo e nível de detalhe das seções originais

${INSTRUCOES_FORMATO}`;
}

function promptAjusteComVideo(ajuste, itensTexto) {
    return `Você é um assistente especializado em atas de reunião. Você analisou o vídeo de uma reunião e gerou as seções da ata abaixo. O usuário está solicitando um ajuste, e você deve usar tanto o vídeo quanto as seções geradas como contexto para produzir uma versão atualizada.

## Seções atuais da ata (geradas anteriormente)

${itensTexto}

## Solicitação de ajuste

${ajuste}

## Instrução

Revise as seções tendo o vídeo da reunião como referência primária. O ajuste pode incluir: inclusão de nova seção, alteração de conteúdo, correção de nome, mudança de ordem, etc. Produza a lista completa e atualizada de seções.

${INSTRUCOES_FORMATO}`;
}

function salvarArquivos(baseDir, parsed) {
    const resultDir = path.join(baseDir, "result");
    const antDir = path.join(resultDir, "ant");

    if (fs.existsSync(resultDir)) {
        const existentes = fs
            .readdirSync(resultDir)
            .filter((f) => fs.statSync(path.join(resultDir, f)).isFile());

        if (existentes.length > 0) {
            if (fs.existsSync(antDir)) {
                fs.readdirSync(antDir).forEach((f) =>
                    fs.rmSync(path.join(antDir, f), { force: true })
                );
            } else {
                fs.mkdirSync(antDir, { recursive: true });
            }
            existentes.forEach((f) =>
                fs.renameSync(path.join(resultDir, f), path.join(antDir, f))
            );
        }
    } else {
        fs.mkdirSync(resultDir, { recursive: true });
    }

    const criados = [];
    parsed.itens.forEach((item, i) => {
        const nome = `secao${String(i).padStart(2, "0")}.md`;
        fs.writeFileSync(path.join(resultDir, nome), item, "utf8");
        criados.push(nome);
    });

    if (parsed.extra) {
        fs.writeFileSync(path.join(resultDir, "extra-pauta.md"), parsed.extra, "utf8");
        criados.push("extra-pauta.md");
    }

    return criados;
}

function createAtaService(baseDir) {
    carregarEnv(baseDir);

    const configPath = path.join(baseDir, "config.json");
    if (!fs.existsSync(configPath)) {
        throw new Error("arquivo config.json não encontrado.");
    }

    const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
    const headerTemplate =
        config.headerTemplate ||
        "# ATA <num_ata> DE REUNIÃO DO COMITÊ EXECUTIVO\n\nÀs 10:30h do dia <dia_reunião> de <mês_reunião_por_extenso> de <ano_reunião> reuniram-se remotamente os representantes dos Partícipes da Rede Blockchain Brasil – RBB, conforme lista de presença ao final, para tratar dos assuntos constantes da Ordem do Dia abaixo, com apresentação de apoio para a reunião contida no Anexo 1.\n\n## Ordem do Dia\nObservadas as cláusulas do Acordo de Cooperação n° D-121.2.0014.22, celebrado entre os Partícipes para a criação e manutenção da RBB, e sem prejuízo do que vier a dispor o Regulamento da RBB:";
    const geminiApiKey = process.env.GEMINI_API_KEY;

    if (!geminiApiKey || geminiApiKey === "SUA_CHAVE_API_AQUI") {
        throw new Error("configure GEMINI_API_KEY no arquivo .env.");
    }

    const genAI = new GoogleGenerativeAI(geminiApiKey);
    const modelName = config.model || "gemini-2.5-pro-preview-03-25";
    const fastModelName = config.fastModel || "gemini-2.0-flash";
    const model = genAI.getGenerativeModel({ model: modelName });
    const fastModel = genAI.getGenerativeModel({ model: fastModelName });

    async function chamarGemini(modelo, partes) {
        const result = await modelo.generateContent(partes);
        return result.response.text();
    }

    return {
        getDefaultVideoUrl() {
            return config.videoUrl;
        },

        async gerarSecoes(videoUrl) {
            const resposta = await chamarGemini(model, [
                partesVideo(videoUrl),
                promptInicial(),
            ]);

            const parsed = parseItens(resposta);
            if (!parsed.itens.length) {
                throw new Error("A resposta do Gemini não retornou seções no formato esperado.");
            }

            const secaoCabecalho = montarSecaoCabecalho(
                headerTemplate,
                parsed.metaCabecalho
            );
            parsed.itens.unshift(secaoCabecalho);

            return parsed;
        },

        async perguntar(videoUrl, parsed, pergunta) {
            return chamarGemini(model, [
                partesVideo(videoUrl),
                promptPergunta(pergunta, itensParaTexto(parsed)),
            ]);
        },

        async ajustar(videoUrl, parsed, ajuste, incluirVideo) {
            if (incluirVideo) {
                const resposta = await chamarGemini(model, [
                    partesVideo(videoUrl),
                    promptAjusteComVideo(ajuste, itensParaTexto(parsed)),
                ]);
                return parseItens(resposta);
            }

            const resposta = await chamarGemini(fastModel, [
                promptAjusteSemVideo(ajuste, itensParaTexto(parsed)),
            ]);
            return parseItens(resposta);
        },

        aceitar(parsed) {
            return salvarArquivos(baseDir, parsed);
        },
    };
}

module.exports = {
    createAtaService,
};
