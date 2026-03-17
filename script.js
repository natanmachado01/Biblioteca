const form = document.getElementById("search-form");
const input = document.getElementById("search-input");
const output = document.getElementById("output");

// Mantém em memória os últimos resultados de busca para permitir "open" por índice
let lastResults = {
  source: null, // "wikipedia" | "worldcraft" | "both"
  wikipedia: [],
  worldcraft: [],
  combined: [], // [{ id, source }]
};

// Histórico de comandos digitados para navegação com setas
const commandHistory = [];
let historyIndex = -1; // -1 significa "linha atual" (sem histórico carregado)

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const raw = input.value.trim();
  if (!raw) return;

  // ecoa o comando digitado
  printLine(raw);

  // adiciona ao histórico
  commandHistory.push(raw);
  historyIndex = -1;

  input.value = "";

  await handleCommand(raw);
});

// Navegação no histórico com setas para cima/baixo
input.addEventListener("keydown", (e) => {
  if (e.key === "ArrowUp") {
    e.preventDefault();
    if (!commandHistory.length) return;

    if (historyIndex === -1) {
      historyIndex = commandHistory.length - 1;
    } else if (historyIndex > 0) {
      historyIndex--;
    }

    input.value = commandHistory[historyIndex] || "";
    // Move o cursor para o final
    input.setSelectionRange(input.value.length, input.value.length);
  }

  if (e.key === "ArrowDown") {
    e.preventDefault();
    if (!commandHistory.length) return;

    if (historyIndex === -1) {
      return;
    }

    if (historyIndex < commandHistory.length - 1) {
      historyIndex++;
      input.value = commandHistory[historyIndex] || "";
    } else {
      historyIndex = -1;
      input.value = "";
    }
    input.setSelectionRange(input.value.length, input.value.length);
  }
});

async function handleCommand(raw) {
  const parts = raw.split(/\s+/);
  const cmd = (parts[0] || "").toLowerCase();

  if (cmd === "search") {
    // Novo formato simples:
    // search <termo>
    const term = parts.slice(1).join(" ");
    if (!term) {
      printError('Uso: search <termo>');
      return;
    }
    await search(term, "both");
    return;
  }

  if (cmd === "open") {
    // Formatos aceitos agora:
    // open <id>
    // open #<indice>
    // (opcional) open wikipedia <id> / open worldcraft <id>

    // Caso com fonte explícita (mantido por compatibilidade)
    if (parts.length >= 3 &&
      (parts[1].toLowerCase() === "wikipedia" ||
        parts[1].toLowerCase() === "worldcraft")) {
      const src = parts[1].toLowerCase();
      const ref = parts[2];
      let id = ref;
      if (ref.startsWith("#")) {
        const idx = parseInt(ref.slice(1), 10) - 1;
        if (Number.isNaN(idx) || idx < 0) {
          printError("Índice inválido.");
          return;
        }
        const arr =
          src === "wikipedia" ? lastResults.wikipedia : lastResults.worldcraft;
        if (!arr[idx]) {
          printError("Nenhum resultado com esse índice.");
          return;
        }
        id = arr[idx].id;
      }
      await openArticle(src, id);
      return;
    }

    // Forma simples: open <id> ou open #<indice>
    const ref = parts[1];
    if (!ref) {
      printError('Uso: open <id> ou open #<indice>');
      return;
    }

    let target = null;

    if (ref.startsWith("#")) {
      const idx = parseInt(ref.slice(1), 10) - 1;
      if (Number.isNaN(idx) || idx < 0 || !lastResults.combined[idx]) {
        printError("Nenhum resultado com esse índice.");
        return;
      }
      target = lastResults.combined[idx];
    } else {
      target = lastResults.combined.find((item) => item.id === ref) || null;
      if (!target) {
        printError("Nenhum resultado com esse ID na última busca.");
        return;
      }
    }

    await openArticle(target.source, target.id);
    return;
  }

  if (cmd === "clear" || cmd === "cls") {
    output.innerHTML = "";
    return;
  }

  if (cmd === "help" || cmd === "?") {
    printHelp();
    return;
  }

  printError('Comando não reconhecido. Use "help" para ver os comandos.');
}

function printLine(text, cssClass) {
  const line = document.createElement("div");
  line.className = "line";
  if (cssClass) line.classList.add(cssClass);

  const promptSpan = document.createElement("span");
  promptSpan.className = "prompt";
  promptSpan.textContent = "C:\\>";

  const textSpan = document.createElement("span");
  textSpan.textContent = text;

  line.appendChild(promptSpan);
  line.appendChild(textSpan);
  output.appendChild(line);
  output.scrollTop = output.scrollHeight;
}

function printResultItem(index, title, snippet) {
  const line = document.createElement("div");
  line.className = "line";

  const promptSpan = document.createElement("span");
  promptSpan.className = "prompt";
  promptSpan.textContent = "C:\\>";

  const textSpan = document.createElement("span");
  const safeSnippet = (snippet || "")
    .replace(/<\/?[^>]+(>|$)/g, "")
    .replace(/\s+/g, " ")
    .trim();

  textSpan.innerHTML =
    `[#${index}] ` +
    `<span class="result-title">${title}</span> - ` +
    `<span class="result-snippet">${safeSnippet}</span>`;

  line.appendChild(promptSpan);
  line.appendChild(textSpan);
  output.appendChild(line);
  output.scrollTop = output.scrollHeight;
}


function printError(message) {
  printLine(message, "error-message");
}

async function search(term, source) {
  lastResults = { source, wikipedia: [], worldcraft: [], combined: [] };

  if (source === "wikipedia" || source === "both") {
    await searchWikipedia(term);
  }
  if (source === "worldcraft" || source === "both") {
    await searchWorldcraft(term);
  }
}

async function searchWikipedia(term) {
  try {
    const res = await fetch(
      `/api/search/wikipedia?term=${encodeURIComponent(term)}`
    );
    if (!res.ok) throw new Error("HTTP " + res.status);
    const data = await res.json();
    const results = data.results || [];

    if (!results.length) {
      printLine("Nenhum resultado encontrado.", "result-snippet");
      return;
    }

    lastResults.wikipedia = results;

    results.forEach((item) => {
      const index = lastResults.combined.length + 1;
      lastResults.combined.push({
        id: item.id,
        source: "wikipedia",
      });
      printResultItem(index, item.title, item.snippet);
    });
  } catch (err) {
    printError("Erro ao buscar na Wikipedia: " + err.message);
  }
}

async function searchWorldcraft(term) {
  try {
    const res = await fetch(
      `/api/search/worldcraft?term=${encodeURIComponent(term)}`
    );
    if (!res.ok) throw new Error("HTTP " + res.status);
    const data = await res.json();
    const results = data.results || [];

    if (!results.length) {
      printLine("Nenhum resultado encontrado.", "result-snippet");
      return;
    }

    lastResults.worldcraft = results;

    results.forEach((item) => {
      const index = lastResults.combined.length + 1;
      lastResults.combined.push({
        id: item.id,
        source: "worldcraft",
      });
      printResultItem(index, item.title, item.snippet);
    });
  } catch (err) {
    printError("Erro ao buscar na Worldcraft: " + err.message);
  }
}

async function openArticle(source, id) {
  try {
    const res = await fetch(`/api/article/${source}/${encodeURIComponent(id)}`);
    if (!res.ok) throw new Error("HTTP " + res.status);
    const data = await res.json();

    if (!data || !data.title) {
      printError("Artigo não encontrado.");
      return;
    }

    printLine(`=== ${data.title} ===`);
    const lines = (data.content || "").split(/\r?\n/);
    lines.forEach((line) => {
      printLine(line);
    });
    printLine("=== fim do artigo ===");
  } catch (err) {
    printError("Erro ao abrir artigo: " + err.message);
  }
}

function printHelp() {
  printLine("Comandos disponíveis:");
  printLine('  search <termo>           -> busca em Wikipedia e Worldcraft');
  printLine('  open <id> ou open #<n>   -> abre artigo da última busca');
  printLine('  clear / cls  -> limpa a tela');
  printLine('  help / ?     -> mostra esta ajuda');
}

// Foco inicial no input
window.addEventListener("load", () => input.focus());