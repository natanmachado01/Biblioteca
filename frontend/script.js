// ==========================================
// REFERÊNCIAS DA INTERFACE
// ==========================================

// Screens
const screenLogin    = document.getElementById("screen-login");
const screenDesktop  = document.getElementById("screen-desktop");
const screenTerminal = document.getElementById("screen-terminal");
const screenDatabase = document.getElementById("screen-database");
const screenDbDetail = document.getElementById("screen-db-detail");

// Login
const loginForm  = document.getElementById("login-form");
const loginUser  = document.getElementById("login-user");
const loginPass  = document.getElementById("login-pass");
const loginError = document.getElementById("login-error");

// Desktop
const deskUser      = document.getElementById("desk-user");
const deskWelcome   = document.getElementById("desk-welcome");
const deskFileCount = document.getElementById("desk-filecount");

// Terminal
const searchForm  = document.getElementById("search-form");
const searchInput = document.getElementById("search-input");
const output      = document.getElementById("output");

// Database
const dbSearch = document.getElementById("db-search");
const dbTbody  = document.getElementById("db-tbody");
const dbCount  = document.getElementById("db-count");

// ==========================================
// ESTADO GLOBAL
// ==========================================

const TYPE_DELAY_MS      = 8;
const TYPE_DELAY_FAST_MS = 0;

let printQueue = Promise.resolve();
let isTyping   = false;
let skipTyping = false;

let currentUser          = null;
let terminalInitialized  = false;

let lastResults = {
  source: null,
  wikipedia: [],
  worldcraft: [],
  combined: [],
};

let currentArticle = null;
const commandHistory = [];
let historyIndex = -1;

// Database
let dbRecords  = [];
let dbFiltered = [];

// ==========================================
// RELÓGIO EM TEMPO REAL
// ==========================================

function updateClock() {
  const now  = new Date();
  const time = now.toLocaleTimeString("pt-BR", { hour12: false });
  const date = now.toLocaleDateString("pt-BR");
  const str  = `${date}  ${time}`;
  document.querySelectorAll(".os-clock").forEach(el => (el.textContent = str));
}
setInterval(updateClock, 1000);
updateClock();

// ==========================================
// NAVEGAÇÃO ENTRE TELAS
// ==========================================

function showScreen(id) {
  document.querySelectorAll(".screen").forEach(s => s.classList.add("hidden"));
  document.getElementById(id).classList.remove("hidden");
}

function openProgram(name) {
  if (name === "terminal") {
    showScreen("screen-terminal");
    searchInput.focus();
    if (!terminalInitialized) {
      terminalInitialized = true;
      output.innerHTML = "";
      printLine(`Acesso concedido. Bem-vindo(a), ${currentUser.name}.`, "success-message");
      printLine(`Nível de Acesso: [${currentUser.role.toUpperCase()}]`);
      printLine(`Hora de conexão: ${new Date().toLocaleString("pt-BR")}`);
      printLine(``);
      printLine(`Digite 'help' para ver os comandos disponíveis.`);
    }
  } else if (name === "database") {
    showScreen("screen-database");
    loadDatabase();
    if (dbSearch) {
      dbSearch.focus();
      dbSearch.select();
    }
  }
}

function closeProgram() {
  showScreen("screen-desktop");
}

// ==========================================
// TECLA ESC — navegar para trás
// ==========================================

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    if (screenDbDetail && !screenDbDetail.classList.contains("hidden")) {
      showScreen("screen-database");
      return;
    }
    if (screenDatabase && !screenDatabase.classList.contains("hidden")) {
      closeProgram();
      return;
    }
    if (screenTerminal && !screenTerminal.classList.contains("hidden")) {
      closeProgram();
      return;
    }
  }
  // Pula animação de digitação ao apertar Enter
  if (e.key === "Enter" && isTyping) {
    e.preventDefault();
    skipTyping = true;
  }
});

// ==========================================
// LOGIN
// ==========================================

if (loginForm) {
  loginForm.addEventListener("submit", async (e) => {
    e.preventDefault();

    const user = loginUser.value.trim();
    const pass = loginPass.value.trim();

    try {
      const response = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: user, password: pass }),
      });

      const data = await response.json();

      if (response.ok && data.success) {
        currentUser = data.user;
        loginError.classList.add("hidden");

        // Atualiza informações do desktop
        if (deskUser) {
          deskUser.textContent = `${currentUser.name.toUpperCase()}  |  NÍVEL: ${currentUser.role.toUpperCase()}`;
        }
        if (deskWelcome) {
          deskWelcome.textContent = `  BEM-VINDO(A), ${currentUser.name.toUpperCase()}  — ACESSO CONCEDIDO`;
        }

        showScreen("screen-desktop");

        // Pré-carrega contagem de registros em background
        fetch("/api/worldcraft/all")
          .then((r) => r.json())
          .then((d) => {
            const count = (d.records || []).length;
            if (deskFileCount) deskFileCount.textContent = `REGISTROS: ${count}`;
          })
          .catch(() => {});
      } else {
        throw new Error(data.message || "Acesso negado.");
      }
    } catch (err) {
      loginError.classList.remove("hidden");
      loginError.querySelector("span").textContent = `[ERRO] ${err.message}`;
      loginPass.value = "";
      loginPass.focus();
    }
  });
}

// ==========================================
// DATABASE — carregar e renderizar
// ==========================================

async function loadDatabase() {
  // Só recarrega se ainda não tiver dados
  if (dbRecords.length > 0) {
    renderDatabase();
    return;
  }

  if (dbTbody) {
    dbTbody.innerHTML =
      '<tr><td colspan="3" class="dim loading-cell">Carregando registros...</td></tr>';
  }

  try {
    const res = await fetch("/api/worldcraft/all");
    if (!res.ok) throw new Error("HTTP " + res.status);
    const data = await res.json();

    dbRecords  = data.records || [];
    dbFiltered = [...dbRecords];

    renderDatabase();

    if (dbCount)  dbCount.textContent  = `${dbRecords.length} registros`;
    if (deskFileCount) deskFileCount.textContent = `REGISTROS: ${dbRecords.length}`;
  } catch (err) {
    if (dbTbody) {
      dbTbody.innerHTML = `<tr><td colspan="3" class="error loading-cell">Erro ao carregar database: ${err.message}</td></tr>`;
    }
  }
}

function renderDatabase() {
  if (!dbTbody) return;

  if (!dbFiltered.length) {
    dbTbody.innerHTML =
      '<tr><td colspan="3" class="dim loading-cell">Nenhum registro encontrado.</td></tr>';
    if (dbCount) dbCount.textContent = "0 registros";
    return;
  }

  dbTbody.innerHTML = "";

  dbFiltered.forEach((record) => {
    const tr  = document.createElement("tr");
    const tags = (record.tags || []).join(", ") || "—";

    tr.innerHTML = `
      <td class="col-cat">${escapeHtml(record.categoria || "—")}</td>
      <td class="col-title">${escapeHtml(record.title)}</td>
      <td class="col-tags">${escapeHtml(tags)}</td>
    `;

    tr.addEventListener("click", () => openDbRecord(record.id));
    dbTbody.appendChild(tr);
  });

  if (dbCount) dbCount.textContent = `${dbFiltered.length} registros`;
}

// Filtro de busca na database
if (dbSearch) {
  dbSearch.addEventListener("input", function () {
    const term = this.value.toLowerCase().trim();
    dbFiltered = term
      ? dbRecords.filter(
          (r) =>
            r.title.toLowerCase().includes(term) ||
            (r.categoria || "").toLowerCase().includes(term) ||
            (r.tags || []).join(" ").toLowerCase().includes(term)
        )
      : [...dbRecords];
    renderDatabase();
  });
}

// ==========================================
// DATABASE — abrir registro individual
// ==========================================

async function openDbRecord(id) {
  showScreen("screen-db-detail");

  const titleEl   = document.getElementById("detail-prog-title");
  const metaEl    = document.getElementById("detail-meta");
  const contentEl = document.getElementById("detail-content");

  if (titleEl)   titleEl.textContent  = "DATABASE.EXE — CARREGANDO...";
  if (metaEl)    metaEl.innerHTML     = "";
  if (contentEl) contentEl.innerHTML  = '<div class="line dim">Aguardando dados...</div>';

  try {
    const res = await fetch(`/api/article/worldcraft/${encodeURIComponent(id)}`);
    if (!res.ok) throw new Error("HTTP " + res.status);
    const data = await res.json();

    const record = dbRecords.find((r) => r.id === id);

    if (titleEl) {
      titleEl.textContent = `DATABASE.EXE — ${data.title.toUpperCase()}`;
    }

    if (metaEl) {
      metaEl.innerHTML = `
        <div class="meta-row">
          <span class="meta-label">TÍTULO    :</span>
          <span class="meta-value">${escapeHtml(data.title)}</span>
        </div>
        <div class="meta-row">
          <span class="meta-label">CATEGORIA :</span>
          <span class="meta-value">${escapeHtml(record?.categoria || "—")}</span>
        </div>
        <div class="meta-row">
          <span class="meta-label">TAGS      :</span>
          <span class="meta-value">${escapeHtml((record?.tags || []).join(", ") || "—")}</span>
        </div>
      `;
    }

    if (contentEl) {
      contentEl.innerHTML = "";
      const lines = (data.content || "Sem conteúdo disponível.").split(/\r?\n/);
      lines.forEach((lineText) => {
        const div = document.createElement("div");
        div.className = "line";
        div.textContent = lineText;
        contentEl.appendChild(div);
      });
      contentEl.scrollTop = 0;
    }
  } catch (err) {
    if (titleEl)   titleEl.textContent  = "DATABASE.EXE — ERRO";
    if (contentEl) contentEl.innerHTML  =
      `<div class="line error">Erro ao carregar registro: ${escapeHtml(err.message)}</div>`;
  }
}

// ==========================================
// TERMINAL — eventos de input
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
    if (historyIndex === -1) historyIndex = commandHistory.length - 1;
    else if (historyIndex > 0) historyIndex--;
    searchInput.value = commandHistory[historyIndex] || "";
    searchInput.setSelectionRange(searchInput.value.length, searchInput.value.length);
  }

  if (e.key === "ArrowDown") {
    e.preventDefault();
    if (!commandHistory.length) return;
    if (historyIndex === -1) return;
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

// ==========================================
// COMANDOS DO TERMINAL
// ==========================================

async function handleCommand(raw) {
  const parts = raw.split(/\s+/);
  const cmd   = (parts[0] || "").toLowerCase();

  if (cmd === "search") {
    const term = parts.slice(1).join(" ");
    if (!term) {
      await printError("Uso: search <termo>");
      return;
    }
    await search(term, "both");
    return;
  }

  if (cmd === "open") {
    if (
      parts.length >= 3 &&
      (parts[1].toLowerCase() === "wikipedia" ||
        parts[1].toLowerCase() === "worldcraft")
    ) {
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

    const ref = parts[1];
    if (!ref) {
      await printError("Uso: open <id> ou open #<indice>");
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
// FUNÇÕES DE EXIBIÇÃO (terminal)
// ==========================================

function enqueuePrint(fn) {
  printQueue = printQueue.then(fn).catch(() => {});
  return printQueue;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createLine(cssClass) {
  const div = document.createElement("div");
  div.className = "line";
  if (cssClass) div.classList.add(cssClass);

  const promptSpan = document.createElement("span");
  promptSpan.className = "prompt";
  promptSpan.textContent = "sistema@temperança> ";

  const textSpan = document.createElement("span");
  textSpan.textContent = "";

  div.appendChild(promptSpan);
  div.appendChild(textSpan);
  output.appendChild(div);
  output.scrollTop = output.scrollHeight;
  return { line: div, textSpan };
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
  return printLineFast(`[#${index}] ${title} — ${safeSnippet}`);
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
      lastResults.combined.push({ id: item.id, source: "wikipedia" });
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
      await printLine("Nenhum registro encontrado no sistema Temperança.");
      return;
    }

    lastResults.worldcraft = results;
    results.forEach((item) => {
      const index = lastResults.combined.length + 1;
      lastResults.combined.push({ id: item.id, source: "worldcraft" });
      printResultItem(index, item.title, item.snippet);
    });
    await printQueue;
  } catch (err) {
    await printError("Erro ao buscar no repositório: " + err.message);
  }
}

async function openArticle(source, id) {
  try {
    const res = await fetch(
      `/api/article/${source}/${encodeURIComponent(id)}`
    );
    if (!res.ok) throw new Error("HTTP " + res.status);
    const data = await res.json();

    if (!data || !data.title) {
      await printError("Artigo não encontrado.");
      return;
    }

    currentArticle = {
      source,
      id:      String(data.id ?? id),
      title:   data.title,
      content: data.content || "",
    };

    await printLine(`=== ${data.title} ===`);
    const lines = (data.content || "").split(/\r?\n/);
    for (const lineText of lines) {
      await printLine(lineText);
    }
    await printLine("=== fim ===");
  } catch (err) {
    await printError("Erro ao abrir artigo: " + err.message);
  }
}

async function printHelp() {
  await printLine("Comandos disponíveis:");
  await printLine("  search <termo>          -> busca nos registros");
  await printLine("  open <id> ou open #<n>  -> abre resultado da última busca");
  await printLine("  clear / cls             -> limpa a tela");
  await printLine("  help / ?                -> mostra esta ajuda");
}

// ==========================================
// UTILITÁRIO — escape de HTML
// ==========================================

function escapeHtml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ==========================================
// INICIALIZAÇÃO
// ==========================================

window.addEventListener("load", () => {
  if (loginUser) loginUser.focus();
});
