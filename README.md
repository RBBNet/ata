# ata
Gera atas do Comitê Executivo

## Configuração

- Crie/edite o arquivo `.env` com `GEMINI_API_KEY=...`
- Mantenha `config.json` com `videoUrl`, `model`, `fastModel` e `headerTemplate`
- O `headerTemplate` define o conteúdo da Seção 00 (cabeçalho da ata)

## Interface Web

- Instale dependências: `npm install`
- Inicie a interface: `npm run start:web`
- Abra no navegador: `http://localhost:3000`

## Saída em arquivos

- Ao aceitar, o sistema gera `secao00.md`, `secao01.md`, etc. em `result/`
