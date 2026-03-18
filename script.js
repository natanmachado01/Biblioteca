const form = document.getElementById("search-form");
const input = document.getElementById("search-input");
const output = document.getElementById("output");

// Efeito de "digitação" (ms por caractere). Aumente para mais lento.
// Observação: para saídas grandes (ex.: listas de resultados), usamos delay menor.
const TYPE_DELAY_MS = 8;
const TYPE_DELAY_FAST_MS = 0;

// Fila para garantir que as linhas sejam impressas em ordem (digitadas)
let printQueue = Promise.resolve();
let isTyping = false;   // Indica se o sistema está animando um texto no momento
let skipTyping = false; // Flag para forçar a exibição imediata do texto

// Mantém em memória os últimos resultados de busca para permitir "open" por índice
let lastResults = {
  source: null, // "wikipedia" | "worldcraft" | "both"
  wikipedia: [],
  worldcraft: [],
  combined: [], // [{ id, source }]
};

// Artigo aberto atualmente (para IA / contexto)
let currentArticle = null; // { source, id, title, content }

// Histórico de comandos digitados para navegação com setas
const commandHistory = [];
let historyIndex = -1; // -1 significa "linha atual" (sem histórico carregado)

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  skipTyping = false; // Reseta a flag para o novo comando ter animação

  const raw = input.value.trim();
  if (!raw) return;

  // ecoa o comando digitado
  await printLine(raw);

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

document.addEventListener("keydown", (e) => {
  // Se a tecla for Enter e a animação estiver rodando...
  if (e.key === "Enter" && isTyping) {
    e.preventDefault(); // Evita que o form de pesquisa seja enviado
    skipTyping = true;  // Aciona o modo de exibição instantânea
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
      await printError('Uso: search <termo>');
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
          await printError("Índice inválido.");
          return;
        }
        const arr =
          src === "wikipedia" ? lastResults.wikipedia : lastResults.worldcraft;
        if (!arr[idx]) {
          await printError("Nenhum resultado com esse índice.");
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
      await printError('Uso: open <id> ou open #<indice>');
      return;
    }

    let target = null;

    if (ref.startsWith("#")) {
      const idx = parseInt(ref.slice(1), 10) - 1;
      if (Number.isNaN(idx) || idx < 0 || !lastResults.combined[idx]) {
        await printError("Nenhum resultado com esse índice.");
        return;
      }
      target = lastResults.combined[idx];
    } else {
      target = lastResults.combined.find((item) => item.id === ref) || null;
      if (!target) {
        await printError("Nenhum resultado com esse ID na última busca.");
        return;
      }
    }

    await openArticle(target.source, target.id);
    return;
  }

  if (cmd === "ask") {
    // IA (Gemini) - apenas para Worldcraft
    const question = parts.slice(1).join(" ");
    if (!question) {
      await printError('Uso: ask <pergunta> (somente Worldcraft)');
      return;
    }

    if (!currentArticle || currentArticle.source !== "worldcraft") {
      await printError(
        'Abra um artigo do Worldcraft primeiro (ex.: search <termo> e open #n).'
      );
      return;
    }

    await askWorldcraftAI(question, currentArticle);
    return;
  }

  if (cmd === "clear" || cmd === "cls") {
    output.innerHTML = "";
    return;
  }

  if (cmd === "help" || cmd === "?") {
    await printHelp();
    return;
  }

  await printError('Comando não reconhecido. Use "help" para ver os comandos.');
}

function enqueuePrint(fn) {
  printQueue = printQueue.then(fn).catch(() => {});
  return printQueue;
}

function createLine(cssClass) {
  const line = document.createElement("div");
  line.className = "line";
  if (cssClass) line.classList.add(cssClass);

  const promptSpan = document.createElement("span");
  promptSpan.className = "prompt";
  promptSpan.textContent = "C:\\>";

  const textSpan = document.createElement("span");
  textSpan.textContent = "";

  line.appendChild(promptSpan);
  line.appendChild(textSpan);
  output.appendChild(line);
  output.scrollTop = output.scrollHeight;
  return { line, textSpan };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function typeText(el, text, delayMs = TYPE_DELAY_MS) {
  isTyping = true; // Informa ao sistema que a animação começou
  
  const s = String(text ?? "");
  for (let i = 0; i < s.length; i++) {
    // Se o usuário apertou Enter (skipTyping virou true), joga todo o resto do texto na tela
    if (skipTyping) {
      el.textContent += s.slice(i);
      break; // Encerra o loop instantaneamente
    }
    
    el.textContent += s[i];
    if (delayMs > 0) await sleep(delayMs);
  }
  
  isTyping = false; // Informa que terminou de digitar a linha
}
// --------------------------------------------

function printLine(text, cssClass) {
  return enqueuePrint(async () => {
    const { textSpan } = createLine(cssClass);
    await typeText(textSpan, text, TYPE_DELAY_MS);
    output.scrollTop = output.scrollHeight;
  });
}

function printLineFast(text, cssClass) {
  return enqueuePrint(async () => {
    const { textSpan } = createLine(cssClass);
    await typeText(textSpan, text, TYPE_DELAY_FAST_MS);
    output.scrollTop = output.scrollHeight;
  });
}

function printResultItem(index, title, snippet) {
  const safeSnippet = (snippet || "")
    .replace(/<\/?[^>]+(>|$)/g, "")
    .replace(/\s+/g, " ")
    .trim();
  // Resultados podem ser muitos/longos; imprime sem delay para não "esconder" Worldcraft.
  return printLineFast(`[#${index}] ${title} - ${safeSnippet}`);
}


function printError(message) {
  return printLine(message, "error-message");
}

async function search(term, source) {
  lastResults = { source, wikipedia: [], worldcraft: [], combined: [] };
  currentArticle = null;

  // Faz as buscas em paralelo, para evitar que uma saída longa atrase a outra.
  const tasks = [];
  if (source === "wikipedia" || source === "both") tasks.push(searchWikipedia(term));
  if (source === "worldcraft" || source === "both") tasks.push(searchWorldcraft(term));
  await Promise.all(tasks);
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
      await printLine("Nenhum resultado encontrado.");
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
    await printQueue;
  } catch (err) {
    await printError("Erro ao buscar na Wikipedia: " + err.message);
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
      await printLine("Nenhum resultado encontrado.");
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
    await printQueue;
  } catch (err) {
    await printError("Erro ao buscar no repositório da Lógica: " + err.message);
  }
}

async function openArticle(source, id) {
  try {
    const res = await fetch(`/api/article/${source}/${encodeURIComponent(id)}`);
    if (!res.ok) throw new Error("HTTP " + res.status);
    const data = await res.json();

    if (!data || !data.title) {
      await printError("Artigo não encontrado.");
      return;
    }

    currentArticle = {
      source,
      id: String(data.id ?? id),
      title: data.title,
      content: data.content || "",
    };

    await printLine(`=== ${data.title} ===`);
    const lines = (data.content || "").split(/\r?\n/);
    for (const line of lines) {
      await printLine(line);
    }
    await printLine("=== fim ===");

    if (source === "worldcraft") {
      await printLine('---------------');
    }
  } catch (err) {
    await printError("Erro ao abrir artigo: " + err.message);
  }
}

async function askWorldcraftAI(question, article) {
  await printLine("Consultando IA...");
  try {
    const res = await fetch("/api/ai/worldcraft", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        question,
        context: `Título: ${article.title}\n\nConteúdo:\n${article.content}`.slice(
          0,
          12000
        ),
      }),
    });
    if (!res.ok) throw new Error("HTTP " + res.status);
    const data = await res.json();
    const text = (data && data.text) || "";
    if (!text.trim()) {
      await printError("A IA não retornou texto.");
      return;
    }
    const lines = String(text).split(/\r?\n/);
    for (const line of lines) {
      await printLine(line);
    }
  } catch (err) {
    await printError("Falha ao consultar a Lógica: " + err.message);
  }
}

async function printHelp() {
  await printLine("Comandos disponíveis:");
  await printLine('  search <termo>           -> busca no repositório da Lógica');
  await printLine('  open <id> ou open #<n>   -> abre informação da última busca');
  await printLine('  ask <pergunta>           -> Lógica (somente no repositório da Lógica, requer open)');
  await printLine('  clear / cls  -> limpa a tela');
  await printLine('  help / ?     -> mostra esta ajuda');
}

// Foco inicial no input
window.addEventListener("load", () => input.focus());