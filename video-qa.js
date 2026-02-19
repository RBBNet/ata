#!/usr/bin/env node

"use strict";

const readline = require("readline");
const fs = require("fs");
const path = require("path");

function carregarEnv() {
  const envPath = path.join(__dirname, ".env");

  if (!fs.existsSync(envPath)) return;

  const linhas = fs.readFileSync(envPath, "utf8").split(/\r?\n/);

  for (const linhaBruta of linhas) {
    const linha = linhaBruta.trim();
    if (!linha || linha.startsWith("#")) continue;

    const idx = linha.indexOf("=");
    if (idx === -1) continue;

    const chave = linha.slice(0, idx).trim();
    const valorRaw = linha.slice(idx + 1).trim();
    const valor = valorRaw.replace(/^['"]|['"]$/g, "");

    if (!process.env[chave]) {
      process.env[chave] = valor;
    }
  }
}

carregarEnv();

// Carrega configuração
const configPath = path.join(__dirname, "config.json");

if (!fs.existsSync(configPath)) {
  console.error("Erro: arquivo config.json não encontrado.");
  console.error("Crie um config.json com videoUrl, model e fastModel.");
  process.exit(1);
}

const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
const geminiApiKey = process.env.GEMINI_API_KEY;

if (!geminiApiKey || geminiApiKey === "SUA_CHAVE_API_AQUI") {
  console.error("Erro: configure GEMINI_API_KEY no arquivo .env.");
  process.exit(1);
}

const { GoogleGenerativeAI } = require("@google/generative-ai");

const genAI = new GoogleGenerativeAI(geminiApiKey);

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

function pergunta(prompt) {
  return new Promise((resolve) => {
    rl.question(prompt, (resposta) => resolve(resposta.trim()));
  });
}

// ─── Parsing ────────────────────────────────────────────────────────────────

const SEP_ITEM = "<<<ITEM>>>";
const SEP_EXTRA = "<<<EXTRA_PAUTA>>>";

function parseItens(resposta) {
  // Separa o bloco de extra-pauta (se houver) do restante
  const [parteItens, parteExtra] = resposta.split(SEP_EXTRA);

  const itens = parteItens
    .split(SEP_ITEM)
    .map((s) => s.trim())
    .filter(Boolean);

  const extra = parteExtra ? parteExtra.trim() : null;

  return { itens, extra };
}

function exibirItens({ itens, extra }) {
  console.log("\n" + "═".repeat(60));
  itens.forEach((item, i) => {
    console.log(`\n── Item ${String(i + 1).padStart(2, "0")} ${"─".repeat(48)}\n`);
    console.log(item);
  });
  if (extra) {
    console.log(`\n── Extra-Pauta ${"─".repeat(44)}\n`);
    console.log(extra);
  }
  console.log("\n" + "═".repeat(60) + "\n");
}

// ─── Arquivos ────────────────────────────────────────────────────────────────

const RESULT_DIR = path.join(__dirname, "result");
const ANT_DIR = path.join(RESULT_DIR, "ant");

function salvarArquivos({ itens, extra }) {
  // Se já há arquivos em result/, move para ant/
  if (fs.existsSync(RESULT_DIR)) {
    const existentes = fs
      .readdirSync(RESULT_DIR)
      .filter((f) => fs.statSync(path.join(RESULT_DIR, f)).isFile());

    if (existentes.length > 0) {
      // Limpa ant/ e recria
      if (fs.existsSync(ANT_DIR)) {
        fs.readdirSync(ANT_DIR).forEach((f) =>
          fs.rmSync(path.join(ANT_DIR, f), { force: true })
        );
      } else {
        fs.mkdirSync(ANT_DIR, { recursive: true });
      }
      existentes.forEach((f) =>
        fs.renameSync(path.join(RESULT_DIR, f), path.join(ANT_DIR, f))
      );
      console.log(`  Arquivos anteriores movidos para result/ant/`);
    }
  } else {
    fs.mkdirSync(RESULT_DIR, { recursive: true });
  }

  const criados = [];

  itens.forEach((item, i) => {
    const nome = `item${String(i + 1).padStart(2, "0")}.md`;
    fs.writeFileSync(path.join(RESULT_DIR, nome), item, "utf8");
    criados.push(nome);
  });

  if (extra) {
    fs.writeFileSync(path.join(RESULT_DIR, "extra-pauta.md"), extra, "utf8");
    criados.push("extra-pauta.md");
  }

  console.log(`  Arquivos criados em result/: ${criados.join(", ")}\n`);
}

// ─── Gemini ──────────────────────────────────────────────────────────────────

function partesVideo(videoUrl) {
  return {
    fileData: { fileUri: videoUrl },
    videoMetadata: { fps: 0.25 },
  };
}

async function chamarGemini(model, partes) {
  const result = await model.generateContent(partes);
  return result.response.text();
}

// ─── Prompts ─────────────────────────────────────────────────────────────────

const INSTRUCOES_FORMATO = `
\`\`\`
## Regras de formato de saída — OBRIGATÓRIAS

- A resposta deve conter EXCLUSIVAMENTE os itens delimitados pelas marcações abaixo.
- NÃO inclua cabeçalho, texto introdutório, conclusão ou qualquer conteúdo fora das marcações.
- Cada item da pauta deve começar exatamente com a linha: <<<ITEM>>>
- Se houver discussões genuinamente extra-pauta, inclua-as em uma única seção final iniciada exatamente com a linha: <<<EXTRA_PAUTA>>>
- A seção <<<EXTRA_PAUTA>>> é opcional: omita-a se não houver discussões completamente fora da pauta.

## Exemplo do formato esperado (siga exatamente este padrão)
\`\`\`
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
  return `Você é um assistente especializado em reuniões. Abaixo estão os itens de pauta de uma reunião que você já analisou anteriormente, seguidos de uma pergunta do usuário.

## Itens da pauta (contexto do que foi gerado)

${itensTexto}

## Pergunta do usuário

${perguntaUsuario}

## Instrução

Responda apenas à pergunta acima. NÃO regenere os itens de pauta nem produza uma ata. Seja direto e objetivo. Se a pergunta exigir referência a algum item, cite-o brevemente.`;
}

function promptAjusteSemVideo(ajuste, itensTexto) {
  return `Você é um assistente especializado em atas de reunião. Abaixo estão os itens de pauta de uma reunião que você gerou anteriormente, seguidos de uma solicitação de ajuste do usuário.

## Itens atuais da pauta

${itensTexto}

## Solicitação de ajuste

${ajuste}

## Instrução

Aplique o ajuste solicitado e retorne os itens atualizados. Mantenha todos os padrões:
- Placeholders consistentes para nomes não identificados (<Pessoa 1>, <Pessoa 2>, etc.)
- O mesmo estilo e nível de detalhe dos itens originais

${INSTRUCOES_FORMATO}`;
}

function promptAjusteComVideo(ajuste, itensTexto) {
  return `Você é um assistente especializado em atas de reunião. Você analisou o vídeo de uma reunião e gerou os itens de pauta abaixo. O usuário está solicitando um ajuste, e você deve usar tanto o vídeo quanto os itens gerados como contexto para produzir uma versão atualizada.

## Itens atuais da pauta (gerados anteriormente)

${itensTexto}

## Solicitação de ajuste

${ajuste}

## Instrução

Revise os itens tendo o vídeo da reunião como referência primária. O ajuste pode incluir: inclusão de novo item, alteração de conteúdo, correção de nome, mudança de ordem, etc. Produza a lista completa e atualizada de itens.

${INSTRUCOES_FORMATO}`;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function itensParaTexto({ itens, extra }) {
  let texto = itens.map((item) => `${SEP_ITEM}\n${item}`).join("\n\n");
  if (extra) texto += `\n\n${SEP_EXTRA}\n${extra}`;
  return texto;
}

// ─── Loop principal ───────────────────────────────────────────────────────────

async function menuLoop(videoUrl, model, fastModel, parsed) {
  while (true) {
    exibirItens(parsed);
    const opcao = await pergunta("[o] Aceitar  [a] Ajustar  [p] Pergunta  [s] Sair\n> ");

    if (opcao.toLowerCase() === "s") {
      console.log("\nAté logo!");
      break;
    }

    if (opcao.toLowerCase() === "o") {
      salvarArquivos(parsed);
      continue;
    }

    if (opcao.toLowerCase() === "p") {
      const q = await pergunta("\nSua pergunta: ");
      if (!q) continue;

      console.log("\nConsultando Gemini...\n");
      try {
        const resposta = await chamarGemini(model, [
          partesVideo(videoUrl),
          promptPergunta(q, itensParaTexto(parsed)),
        ]);

        console.log("\n" + "╔" + "═".repeat(58) + "╗");
        console.log("║  RESPOSTA À PERGUNTA" + " ".repeat(37) + "║");
        console.log("╚" + "═".repeat(58) + "╝\n");
        console.log(resposta);
        console.log("\n" + "╔" + "═".repeat(58) + "╗");
        console.log("║  ITENS DA PAUTA (não alterados)" + " ".repeat(26) + "║");
        console.log("╚" + "═".repeat(58) + "╝");
      } catch (err) {
        console.error("Erro ao consultar a API:", err.message || err);
      }
      continue;
    }

    if (opcao.toLowerCase() === "a") {
      const ajuste = await pergunta("\nDescreva o ajuste desejado: ");
      if (!ajuste) continue;

      const comVideoResp = await pergunta("\nIncluir o vídeo no contexto? (s/n): ");
      const comVideo = comVideoResp.toLowerCase() === "s";

      console.log("\nConsultando Gemini...\n");
      try {
        let partes;
        let modeloEscolhido;
        if (comVideo) {
          modeloEscolhido = model;
          partes = [
            partesVideo(videoUrl),
            promptAjusteComVideo(ajuste, itensParaTexto(parsed)),
          ];
        } else {
          modeloEscolhido = fastModel;
          partes = [promptAjusteSemVideo(ajuste, itensParaTexto(parsed))];
        }

        const resposta = await chamarGemini(modeloEscolhido, partes);
        parsed = parseItens(resposta);
        console.log("\nItens atualizados:\n");
      } catch (err) {
        console.error("Erro ao consultar a API:", err.message || err);
      }
      continue;
    }

    console.log("\nOpção inválida. Use o, a, p ou s.\n");
  }
}

// ─── Entrada ──────────────────────────────────────────────────────────────────

async function main() {
  console.log("\n=== Gerador de Ata de Reunião ===\n");

  console.log(`URL do vídeo atual: ${config.videoUrl}`);
  const novaUrl = await pergunta("Pressione Enter para confirmar ou digite uma nova URL: ");
  const videoUrl = novaUrl || config.videoUrl;
  console.log(`\nUsando vídeo: ${videoUrl}\n`);

  const modelName = config.model || "gemini-2.5-pro-preview-03-25";
  const model = genAI.getGenerativeModel({ model: modelName });
  const fastModelName = config.fastModel || "gemini-2.0-flash";
  const fastModel = genAI.getGenerativeModel({ model: fastModelName });

  console.log("Analisando o vídeo e gerando ata...\n");

  let parsed;
  try {
    const resposta = await chamarGemini(model, [
      partesVideo(videoUrl),
      promptInicial(),
    ]);
    parsed = parseItens(resposta);
  } catch (err) {
    console.error("Erro ao consultar a API:", err.message || err);
    rl.close();
    return;
  }

  await menuLoop(videoUrl, model, fastModel, parsed);

  rl.close();
}

main().catch((err) => {
  console.error("Erro fatal:", err.message || err);
  rl.close();
  process.exit(1);
});
