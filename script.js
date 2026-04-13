// ==========================================
// REFERÊNCIAS DA INTERFACE
// ==========================================

// Elementos da Tela de Login
const loginScreen = document.getElementById("login-screen");
const loginForm = document.getElementById("login-form");
const loginUser = document.getElementById("login-user");
const loginPass = document.getElementById("login-pass");
const loginError = document.getElementById("login-error");

// Elementos da Tela do Terminal
const terminalScreen = document.getElementById("terminal-screen");
const searchForm = document.getElementById("search-form");
const searchInput = document.getElementById("search-input");
const output = document.getElementById("output");

// ==========================================
// CONFIGURAÇÕES GERAIS E ESTADO
// ==========================================

const TYPE_DELAY_MS = 8;
const TYPE_DELAY_FAST_MS = 0;

let printQueue = Promise.resolve();
let isTyping = false;
let skipTyping = false;

let currentUser = null; // Guardará quem logou (para o prompt do terminal)

let lastResults = {
  source: null,
  wikipedia: [],
  worldcraft: [],
  combined: [],
};

let currentArticle = null;

const commandHistory = [];
let historyIndex = -1;

// ==========================================
// LÓGICA DE LOGIN
// ==========================================

// Precisamos checar se o formulário existe na tela (para não dar erro)
if (loginForm) {
  loginForm.addEventListener("submit", async (e) => {
    e.preventDefault();
  
    const user = loginUser.value.trim();
    const pass = loginPass.value.trim();
  
    try {
      // 1. Envia os dados para o seu server.js verificar
      const response = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: user, password: pass })
      });
  
      const data = await response.json();
  
      // 2. Verifica a resposta do servidor
      if (response.ok && data.success) {
        // Guarda os dados que o servidor confirmou
        currentUser = data.user;
  
        if (loginError) loginError.classList.add("hidden");
  
        // Transição de telas
        loginScreen.classList.add("hidden");
        terminalScreen.classList.remove("hidden");
        searchInput.focus();
        output.innerHTML = "";
  
        // Mensagem personalizada usando o nome verdadeiro que veio do users.json
        await printLine(`Acesso concedido. Bem-vindo(a), ${currentUser.name}.`, "success-message");
        await printLine(`Nível de Acesso: [${currentUser.role.toUpperCase()}]`);
        await printLine("Digite 'help' para ver os comandos disponíveis.");
      } else {
        // Se o servidor recusou (senha errada ou usuário não existe)
        throw new Error(data.message || "Acesso Negado.");
      }
    } catch (err) {
      // Mostra o erro na tela
      if (loginError) {
        loginError.classList.remove("hidden");
        // Você pode até exibir o texto do erro que o servidor mandou
        loginError.querySelector("span").textContent = `[ERRO] ${err.message}`;
      }
      loginPass.value = "";
      loginPass.focus();
    }
  });
}

// ==========================================
// LÓGICA DO TERMINAL (EVENTOS)
// ==========================================

searchForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  skipTyping = false;

  const raw = searchInput.value.trim();
  if (!raw) return;

  await printLine(raw);

  commandHistory.push(raw);
  historyIndex = -1;

  searchInput.value = "";

  await handleCommand(raw);
});

searchInput.addEventListener("keydown", (e) => {
  if (e.key === "ArrowUp") {
    e.preventDefault();
    if (!commandHistory.length) return;

    if (historyIndex === -1) {
      historyIndex = commandHistory.length - 1;
    } else if (historyIndex > 0) {
      historyIndex--;
    }

    searchInput.value = commandHistory[historyIndex] || "";
    searchInput.setSelectionRange(searchInput.value.length, searchInput.value.length);
  }

  if (e.key === "ArrowDown") {
    e.preventDefault();
    if (!commandHistory.length) return;

    if (historyIndex === -1) {
      return;
    }

    if (historyIndex < commandHistory.length - 1) {
      historyIndex++;
      searchInput.value = commandHistory[historyIndex] || "";
    } else {
      historyIndex = -1;
      searchInput.value = "";
    }
    searchInput.setSelectionRange(searchInput.value.length, searchInput.value.length);
  }
});

document.addEventListener("keydown", (e) => {
  // Pula a animação ao apertar Enter
  if (e.key === "Enter" && isTyping) {
    e.preventDefault();
    skipTyping = true;
  }
});

// ==========================================
// COMANDOS DO TERMINAL
// ==========================================

async function handleCommand(raw) {
  const parts = raw.split(/\s+/);
  const cmd = (parts[0] || "").toLowerCase();

  if (cmd === "search") {
    const term = parts.slice(1).join(" ");
    if (!term) {
      await printError('Uso: search <termo>');
      return;
    }
    await search(term, "both");
    return;
  }

  if (cmd === "open") {
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
        const arr = src === "wikipedia" ? lastResults.wikipedia : lastResults.worldcraft;
        if (!arr[idx]) {
          await printError("Nenhum resultado com esse índice.");
          return;
        }
        id = arr[idx].id;
      }
      await openArticle(src, id);
      return;
    }

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

// ==========================================
// FUNÇÕES DE EXIBIÇÃO
// ==========================================

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
  // Muda o visual do prompt dependendo de quem logou
  promptSpan.textContent = "sistema@temperança> ";

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
  isTyping = true;
  const s = String(text ?? "");
  for (let i = 0; i < s.length; i++) {
    if (skipTyping) {
      el.textContent += s.slice(i);
      break;
    }
    el.textContent += s[i];
    if (delayMs > 0) await sleep(delayMs);
  }
  isTyping = false;
}

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
  return printLineFast(`[#${index}] ${title} - ${safeSnippet}`);
}

function printError(message) {
  return printLine(message, "error-message");
}

// ==========================================
// INTEGRAÇÕES COM O SERVIDOR
// ==========================================

async function search(term, source) {
  lastResults = { source, wikipedia: [], worldcraft: [], combined: [] };
  currentArticle = null;

  const tasks = [];
  if (source === "wikipedia" || source === "both") tasks.push(searchWikipedia(term));
  if (source === "worldcraft" || source === "both") tasks.push(searchWorldcraft(term));
  await Promise.all(tasks);
}

async function searchWikipedia(term) {
  try {
    const res = await fetch(`/api/search/wikipedia?term=${encodeURIComponent(term)}`);
    if (!res.ok) throw new Error("HTTP " + res.status);
    const data = await res.json();
    const results = data.results || [];

    if (!results.length) {
      await printLine("Nenhum resultado encontrado na Wikipedia.");
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
    const res = await fetch(`/api/search/worldcraft?term=${encodeURIComponent(term)}`);
    if (!res.ok) throw new Error("HTTP " + res.status);
    const data = await res.json();
    const results = data.results || [];

    if (!results.length) {
      await printLine("Nenhum registro encontrado no sistema Temperança.");
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

  } catch (err) {
    await printError("Erro ao abrir artigo: " + err.message);
  }
}

async function printHelp() {
  await printLine("Comandos disponíveis:");
  await printLine('  search <termo>           -> busca nos registros');
  await printLine('  open <id> ou open #<n>   -> abre informação da última busca');
  await printLine('  clear / cls              -> limpa a tela');
  await printLine('  help / ?                 -> mostra esta ajuda');
}

// Inicialização
window.addEventListener("load", () => {
  if (loginUser && !loginScreen.classList.contains("hidden")) {
    loginUser.focus();
  } else if (searchInput) {
    searchInput.focus();
  }
});