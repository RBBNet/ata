import { GoogleGenerativeAI } from '@google/generative-ai';
import * as dotenv from 'dotenv';
import * as readline from 'readline';

// Carrega variáveis de ambiente do arquivo .env
dotenv.config();

// Configuração
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const YOUTUBE_URL = process.env.YOUTUBE_URL;

if (!GEMINI_API_KEY) {
  console.error('Erro: GEMINI_API_KEY não está configurada no arquivo .env');
  console.error('Por favor, copie .env.example para .env e adicione sua chave da API');
  process.exit(1);
}

if (!YOUTUBE_URL) {
  console.error('Erro: YOUTUBE_URL não está configurada no arquivo .env');
  console.error('Por favor, copie .env.example para .env e adicione a URL do vídeo do YouTube');
  process.exit(1);
}

// Inicializa o Gemini AI
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);

// Interface para ler entrada do usuário
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

/**
 * Faz uma pergunta sobre o vídeo do YouTube usando Gemini
 */
async function askAboutVideo(question) {
  try {
    // Usa o modelo Gemini 1.5 Pro que suporta vídeos do YouTube
    const model = genAI.getGenerativeModel({ model: 'gemini-1.5-pro-latest' });

    // Cria o prompt com o vídeo do YouTube e a pergunta
    const prompt = `Analise este vídeo do YouTube: ${YOUTUBE_URL}\n\nPergunta: ${question}`;

    console.log('\nProcessando sua pergunta...\n');

    // Gera a resposta
    const result = await model.generateContent(prompt);
    const response = await result.response;
    const text = response.text();

    return text;
  } catch (error) {
    console.error('Erro ao processar a pergunta:', error.message);
    throw error;
  }
}

/**
 * Loop principal do programa
 */
async function main() {
  console.log('='.repeat(60));
  console.log('Sistema de Perguntas sobre Vídeos do YouTube com Gemini AI');
  console.log('='.repeat(60));
  console.log(`\nVídeo configurado: ${YOUTUBE_URL}`);
  console.log('\nDigite sua pergunta sobre o vídeo (ou "sair" para encerrar)\n');

  const askQuestion = () => {
    rl.question('Sua pergunta: ', async (question) => {
      if (question.toLowerCase() === 'sair' || question.toLowerCase() === 'exit') {
        console.log('\nEncerrando o programa. Até logo!\n');
        rl.close();
        return;
      }

      if (!question.trim()) {
        console.log('Por favor, digite uma pergunta válida.\n');
        askQuestion();
        return;
      }

      try {
        const answer = await askAboutVideo(question);
        console.log('\n' + '-'.repeat(60));
        console.log('Resposta:');
        console.log('-'.repeat(60));
        console.log(answer);
        console.log('-'.repeat(60) + '\n');
      } catch (error) {
        console.error('\nNão foi possível obter uma resposta. Tente novamente.\n');
      }

      askQuestion();
    });
  };

  askQuestion();
}

// Executa o programa principal
main().catch(console.error);
