#!/usr/bin/env node

"use strict";

const readline = require("readline");
const fs = require("fs");
const path = require("path");

// Carrega configuração
const configPath = path.join(__dirname, "config.json");

if (!fs.existsSync(configPath)) {
  console.error("Erro: arquivo config.json não encontrado.");
  console.error("Crie um config.json com geminiApiKey, videoUrl e model.");
  process.exit(1);
}

const config = JSON.parse(fs.readFileSync(configPath, "utf8"));

if (!config.geminiApiKey || config.geminiApiKey === "SUA_CHAVE_API_AQUI") {
  console.error("Erro: configure sua chave da API do Gemini em config.json.");
  process.exit(1);
}

const { GoogleGenerativeAI } = require("@google/generative-ai");

const genAI = new GoogleGenerativeAI(config.geminiApiKey);

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

function pergunta(prompt) {
  return new Promise((resolve) => {
    rl.question(prompt, (resposta) => resolve(resposta.trim()));
  });
}

async function main() {
  console.log("\n=== Perguntas sobre Vídeo com Gemini ===\n");

  // Mostra URL do vídeo e permite alterar
  console.log(`URL do vídeo atual: ${config.videoUrl}`);
  const novaUrl = await pergunta('Pressione Enter para confirmar ou digite uma nova URL: ');
  const videoUrl = novaUrl || config.videoUrl;
  console.log(`\nUsando vídeo: ${videoUrl}\n`);

  const modelName = config.model || "gemini-2.5-pro-preview-03-25";
  const model = genAI.getGenerativeModel({ model: modelName });

  // Loop de perguntas
  while (true) {
    const questao = await pergunta('Sua pergunta (ou "sair" para encerrar): ');

    if (!questao || questao.toLowerCase() === "sair") {
      console.log("\nAté logo!");
      break;
    }

    console.log("\nConsultando Gemini...\n");

    try {
      const result = await model.generateContent([
        {
          fileData: {
            fileUri: videoUrl,
          },
        },
        questao,
      ]);

      const resposta = result.response.text();
      console.log("Resposta:\n");
      console.log(resposta);
      console.log("\n" + "─".repeat(60) + "\n");
    } catch (err) {
      console.error("Erro ao consultar a API:", err.message || err);
      console.log();
    }
  }

  rl.close();
}

main().catch((err) => {
  console.error("Erro fatal:", err.message || err);
  rl.close();
  process.exit(1);
});
