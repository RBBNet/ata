# ATA - Análise de Vídeos com Gemini AI

Sistema de perguntas e respostas sobre vídeos do YouTube usando a API do Google Gemini.

## Descrição

Este é um proof of concept (POC) que utiliza a API do Gemini 1.5 Pro Preview para fazer perguntas sobre vídeos do YouTube através de uma interface de linha de comando.

## Requisitos

- Node.js (versão 18 ou superior)
- Chave da API do Google Gemini
- Conexão com a internet

## Instalação

1. Clone o repositório:
```bash
git clone https://github.com/RBBNet/ata.git
cd ata
```

2. Instale as dependências:
```bash
npm install
```

3. Configure o arquivo `.env`:
```bash
cp .env.example .env
```

4. Edite o arquivo `.env` e adicione:
   - Sua chave da API do Gemini em `GEMINI_API_KEY`
   - A URL do vídeo do YouTube em `YOUTUBE_URL`

## Uso

Execute o programa:
```bash
npm start
```

O sistema irá:
1. Carregar as configurações do arquivo `.env`
2. Exibir a URL do vídeo configurado
3. Solicitar que você digite uma pergunta sobre o vídeo
4. Enviar a pergunta para a API do Gemini
5. Exibir a resposta

Para sair do programa, digite `sair` ou `exit`.

## Exemplo

```
Sistema de Perguntas sobre Vídeos do YouTube com Gemini AI
============================================================

Vídeo configurado: https://www.youtube.com/watch?v=exemplo

Digite sua pergunta sobre o vídeo (ou "sair" para encerrar)

Sua pergunta: Qual é o tema principal do vídeo?

Processando sua pergunta...

------------------------------------------------------------
Resposta:
------------------------------------------------------------
[A resposta do Gemini será exibida aqui]
------------------------------------------------------------
```

## Estrutura do Projeto

```
ata/
├── index.js           # Arquivo principal da aplicação
├── package.json       # Configuração do projeto e dependências
├── .env.example       # Exemplo de arquivo de configuração
├── .env              # Arquivo de configuração (não versionado)
├── .gitignore        # Arquivos ignorados pelo Git
└── README.md         # Este arquivo
```

## Tecnologias Utilizadas

- Node.js
- Google Generative AI SDK (@google/generative-ai)
- dotenv (para gerenciamento de variáveis de ambiente)

## Licença

ISC
