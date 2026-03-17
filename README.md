## WikiTerminal (localhost)

Interface tipo CMD para pesquisar e ler artigos da Wikipedia (pt) e de uma base local chamada Worldcraft.

### Rodar em localhost

```bash
npm install
npm start
```

Abra no navegador `http://localhost:3000`.

### Comandos (no terminal do site)

- `search <termo>`: pesquisa em Wikipedia e Worldcraft
- `open #<n>`: abre o resultado n da última busca (lista combinada)
- `open <id>`: abre por ID da última busca
- `clear` / `cls`: limpa a tela
- `help` / `?`: ajuda

### Base Worldcraft

Edite `worldcraft-db.json` para adicionar artigos. Campos recomendados:

- `id` (string única)
- `title`
- `summary`
- `content`
- `tags` (array)

### IA (Gemini) para Worldcraft

O projeto inclui um endpoint que usa Gemini para responder perguntas **sobre Worldcraft**.

#### 1) Criar `.env`

Copie `.env.example` para `.env` e coloque sua chave:

- `GEMINI_API_KEY`: chave da API do Gemini
- `GEMINI_MODEL` (opcional): padrão `gemini-1.5-flash`

#### 2) Uso no frontend

O frontend chama `POST /api/ai/worldcraft` com:

- `question`: pergunta do usuário
- `context` (opcional): trecho do artigo/conteúdo do Worldcraft

Observação: não commite seu `.env`.

