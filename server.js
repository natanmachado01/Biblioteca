const express = require("express");
const fs = require("fs");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

// Caminho para o "banco" estático de artigos Worldcraft
const WORLCRAFT_DB_PATH = path.join(__dirname, "worldcraft-db.json");

// Carrega o JSON de artigos Worldcraft em memória
function loadWorldcraftDB() {
  try {
    const raw = fs.readFileSync(WORLCRAFT_DB_PATH, "utf8");
    return JSON.parse(raw);
  } catch (err) {
    console.error("Erro ao carregar worldcraft-db.json:", err);
    return [];
  }
}

// Middleware estático para servir index.html, script.js, style.css, etc.
app.use(express.static(__dirname));

// --- Rotas de API ---

// Busca na Wikipedia (proxy simples)
app.get("/api/search/wikipedia", async (req, res) => {
  const term = (req.query.term || "").toString();
  if (!term) {
    return res.status(400).json({ error: "Parâmetro 'term' é obrigatório." });
  }

  const wikipediaApi =
    "https://pt.wikipedia.org/w/api.php?action=query&list=search&format=json&origin=*";

  try {
    const url = `${wikipediaApi}&srsearch=${encodeURIComponent(term)}`;
    const response = await fetch(url);
    if (!response.ok) {
      return res
        .status(response.status)
        .json({ error: "Falha ao consultar Wikipedia." });
    }

    const data = await response.json();
    const results = (data.query && data.query.search) || [];

    const normalized = results.slice(0, 10).map((item) => ({
      id: String(item.pageid),
      title: item.title,
      snippet: item.snippet,
    }));

    res.json({ results: normalized });
  } catch (err) {
    console.error("Erro na busca Wikipedia:", err);
    res.status(500).json({ error: "Erro interno ao consultar Wikipedia." });
  }
});

// Leitura de artigo completo na Wikipedia (resumo)
app.get("/api/article/wikipedia/:pageId", async (req, res) => {
  const pageId = req.params.pageId;
  if (!pageId) {
    return res.status(400).json({ error: "Parâmetro 'pageId' é obrigatório." });
  }

  const url = `https://pt.wikipedia.org/w/api.php?action=query&prop=extracts&explaintext=1&pageids=${encodeURIComponent(
    pageId
  )}&format=json&origin=*`;

  try {
    const response = await fetch(url);
    if (!response.ok) {
      return res
        .status(response.status)
        .json({ error: "Falha ao carregar artigo da Wikipedia." });
    }
    const data = await response.json();
    const pages = data.query && data.query.pages;
    const page = pages && pages[pageId];

    if (!page) {
      return res.status(404).json({ error: "Artigo não encontrado." });
    }

    res.json({
      id: String(page.pageid),
      title: page.title,
      content: page.extract || "",
    });
  } catch (err) {
    console.error("Erro ao buscar artigo Wikipedia:", err);
    res.status(500).json({ error: "Erro interno ao carregar artigo." });
  }
});

// Busca nos artigos estáticos de Worldcraft
app.get("/api/search/worldcraft", (req, res) => {
  const term = (req.query.term || "").toString().toLowerCase();
  if (!term) {
    return res.status(400).json({ error: "Parâmetro 'term' é obrigatório." });
  }

  const db = loadWorldcraftDB();
  const results = db.filter((item) => {
    const haystack =
      `${item.title} ${item.summary} ${item.content} ${(item.tags || []).join(
        " "
      )}`.toLowerCase();
    return haystack.includes(term);
  });

  res.json({
    results: results.map((item) => ({
      id: item.id,
      title: item.title,
      snippet: item.summary || "",
    })),
  });
});

// Leitura de artigo completo Worldcraft
app.get("/api/article/worldcraft/:id", (req, res) => {
  const id = req.params.id;
  if (!id) {
    return res.status(400).json({ error: "Parâmetro 'id' é obrigatório." });
  }

  const db = loadWorldcraftDB();
  const article = db.find((item) => item.id === id);
  if (!article) {
    return res.status(404).json({ error: "Artigo não encontrado." });
  }

  res.json({
    id: article.id,
    title: article.title,
    content: article.content,
  });
});

app.listen(PORT, () => {
  console.log(`Servidor rodando em http://localhost:${PORT}`);
});

