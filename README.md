# ata
Gera atas do Comitê Executivo

## Configuração

- Crie/edite o arquivo `.env` com `GEMINI_API_KEY=...`
- Mantenha `config.json` com `videoUrl`, `model`, `fastModel` e `headerTemplate`
- O `headerTemplate` define o conteúdo da Seção 00 (cabeçalho da ata)

### Proxy (opcional)

Ordem de precedência:

1. Se existir `proxy` no `config.json`, ele é usado
2. Se não existir no `config.json`, o sistema tenta `HTTPS_PROXY`/`HTTP_PROXY` (e `NO_PROXY`) do ambiente
3. Se não houver em nenhum dos dois, roda sem proxy

Exemplo de `config.json` com proxy (sem autenticação):

```json
{
	"videoUrl": "https://...",
	"model": "gemini-3-pro-preview",
	"fastModel": "gemini-3-flash-preview",
	"headerTemplate": "...",
	"proxy": {
		"url": "http://proxy.empresa.local:8080",
		"noProxy": ["localhost", "127.0.0.1", ".interna.local"]
	}
}
```

Para desabilitar explicitamente o uso de proxy no `config.json`:

```json
{
	"proxy": {
		"enabled": false
	}
}
```

> Dica: se seu sistema já tiver `HTTP_PROXY`/`HTTPS_PROXY` definidos e você quiser ignorá-los neste projeto, use `"proxy": { "enabled": false }`.

## Interface Web

- Instale dependências: `npm install`
- Inicie a interface: `npm run start:web`
- Abra no navegador: `http://localhost:3000`

## Saída em arquivos

- Ao aceitar, o sistema gera `secao00.md`, `secao01.md`, etc. em `result/`
- Para gerar `ata.docx`, o `pandoc` é baixado automaticamente via dependência npm (`pandoc-bin`). Se preferir, também funciona com `pandoc` instalado no PATH.
