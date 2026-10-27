// nonogram/app.js — shell, options panel, tool button gestures, settings

const DEFAULT_PUZZLE_TEXT = `
kafushy, Heart, 2026-10-26, v1
#0f172a #1e293b 180 / #38bdf8 90
/1 1.5.5.3.1/2.4.4.4.2
`;

const DEFAULT_SETTINGS = {
  autoMark: false,
  autoGray: true,
  surroundedOnly: false,
  tileBorders: true,
  gridLineEvery: 5,
  dragCounterThreshold: 0,
  markSymbol: "×",
  gamepad: false,
};

const MARK_OPTIONS = ["×", "•", "/", "-", "+", "●", "○"];

// ---- persistence ----
function loadSettings() {
  try {
    const raw = localStorage.getItem("nono_settings");
    if (!raw) return { ...DEFAULT_SETTINGS };
    return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch { return { ...DEFAULT_SETTINGS }; }
}
function saveSettings(s) { try { localStorage.setItem("nono_settings", JSON.stringify(s)); } catch {} }

function loadPuzzleText() {
  return localStorage.getItem("nono_puzzleText") || DEFAULT_PUZZLE_TEXT;
}
function savePuzzleText(t) { try { localStorage.setItem("nono_puzzleText", t); } catch {} }

function loadSavedState(puzzleText) {
  try {
    const raw = localStorage.getItem("nono_state");
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed.puzzleText !== puzzleText) return null;
    return parsed;
  } catch { return null; }
}
function persistState() {
  if (!currentGame) return;
  try {
    localStorage.setItem("nono_state", JSON.stringify({
      puzzleText: currentPuzzleText,
      state: currentGame.state,
      marks: currentGame.marks,
    }));
  } catch {}
}
function clearSavedState() { try { localStorage.removeItem("nono_state"); } catch {} }

// ---- globals ----
let currentGame = null;
let currentPuzzleText = loadPuzzleText();
let settings = loadSettings();

// ---- DOM refs (populated after DOM ready) ----
let gameWrap, toolBtn, toolLabel, statusEl, ghostEl;

// ---- boot ----
document.addEventListener("DOMContentLoaded", () => {
  gameWrap = document.getElementById("game-wrap");
  toolBtn = document.getElementById("tool-btn");
  toolLabel = document.getElementById("tool-label");
  statusEl = document.getElementById("status");
  ghostEl = document.getElementById("ghost");

  buildOptionsPanel();
  wireHeader();
  wireTabs();
  wireSettingsControls();
  wireToolButton();
  loadPuzzle(currentPuzzleText, loadSavedState(currentPuzzleText));
});

// ---- header ----
function wireHeader() {
  document.getElementById("header").addEventListener("click", () => {
    const opts = document.getElementById("options");
    opts.classList.toggle("hidden");
  });
}

// ---- options panel ----
function buildOptionsPanel() {
  // Nothing to build statically — controls are wired in wireSettingsControls
  // Tab content for Mode and Make are static placeholders in index.html
}

function wireTabs() {
  document.querySelectorAll(".tabs button").forEach(btn => {
    btn.addEventListener("click", () => {
      const tab = btn.dataset.tab;
      document.querySelectorAll(".tabs button").forEach(b => b.classList.toggle("active", b === btn));
      document.querySelectorAll(".tab-content").forEach(tc => {
        tc.classList.toggle("hidden", tc.id !== "tab-" + tab);
      });
    });
  });
}

// ---- settings controls ----
function wireSettingsControls() {
  const bindToggle = (id, key) => {
    const el = document.getElementById(id);
    el.checked = !!settings[key];
    el.addEventListener("change", () => {
      settings[key] = el.checked;
      saveSettings(settings);
      if (currentGame) currentGame.setSettings(settings);
    });
  };
  const bindNumber = (id, key, min, max) => {
    const el = document.getElementById(id);
    el.value = settings[key];
    el.min = min; el.max = max;
    el.addEventListener("change", () => {
      let v = parseInt(el.value) || 0;
      v = Math.max(min, Math.min(max, v));
      el.value = v;
      settings[key] = v;
      saveSettings(settings);
      if (currentGame) currentGame.setSettings(settings);
    });
  };

  bindToggle("set-autoMark", "autoMark");
  bindToggle("set-autoGray", "autoGray");
  bindToggle("set-surroundedOnly", "surroundedOnly");
  bindToggle("set-tileBorders", "tileBorders");
  bindNumber("set-gridLineEvery", "gridLineEvery", 0, 20);
  bindNumber("set-dragCounterThreshold", "dragCounterThreshold", 0, 50);

  const markSel = document.getElementById("set-markSymbol");
  MARK_OPTIONS.forEach(m => {
    const o = document.createElement("option");
    o.value = m; o.textContent = m;
    if (settings.markSymbol === m) o.selected = true;
    markSel.appendChild(o);
  });
  markSel.addEventListener("change", () => {
    settings.markSymbol = markSel.value;
    saveSettings(settings);
    if (currentGame) currentGame.setSettings(settings);
  });

  // Gamepad stub
  const gp = document.getElementById("set-gamepad");
  gp.checked = !!settings.gamepad;
  gp.addEventListener("change", () => {
    settings.gamepad = gp.checked;
    saveSettings(settings);
    // no-op for now
  });
}

// ---- info section ----
function renderInfo(puzzle) {
  const el = document.getElementById("tab-settings-info");
  if (!el || !puzzle) return;
  const strict = puzzle.strict ? "yes" : "no";
  const palette = puzzle.fg.palette.map(c =>
    `<div style="background:${c}"></div>`).join("");
  el.innerHTML = `
    <h3>Info</h3>
    <div class="info-row"><span>Author</span><span>${esc(puzzle.author)}</span></div>
    <div class="info-row"><span>Title</span><span>${esc(puzzle.title || "—")}</span></div>
    <div class="info-row"><span>Date</span><span>${esc(puzzle.date || "—")}</span></div>
    <div class="info-row"><span>Version</span><span>${esc(puzzle.version || "—")}</span></div>
    <div class="info-row"><span>Size</span><span>${puzzle.sections[1].length}×${puzzle.sections[0].length}</span></div>
    <div class="info-row"><span>Colors</span><span class="palette-dots">${palette}</span></div>
    <div class="info-row"><span>Strict</span><span>${strict}</span></div>
    <button class="danger-btn" id="reset-puzzle">Reset this puzzle</button>
  `;
  document.getElementById("reset-puzzle").addEventListener("click", () => {
    if (currentGame) currentGame.reset();
    clearSavedState();
  });
}

function esc(s) { return String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c])); }

// ---- puzzle loading ----
function loadPuzzle(text, savedState) {
  let puzzle;
  try { puzzle = parseNonogram(text); }
  catch (e) { showStatus("Error: " + e.message, true); return; }

  if (currentGame) { currentGame.destroy(); currentGame = null; }
  gameWrap.innerHTML = "";

  document.getElementById("creator").textContent = puzzle.author || "";
  document.getElementById("title").textContent = puzzle.title || "Nonogram";

  const canvas = document.createElement("canvas");
  gameWrap.appendChild(canvas);

  try {
    currentGame = new NonogramGame(puzzle, canvas, settings, statusEl);
    if (savedState && savedState.state && savedState.marks) {
      currentGame.state = savedState.state;
      currentGame.marks = savedState.marks;
      currentGame.render();
    }
    currentGame.onStateChange = () => persistState();
    currentGame.setupPointerEvents();
  } catch (e) { showStatus("Error: " + e.message, true); return; }

  currentPuzzleText = text;
  savePuzzleText(text);
  renderInfo(puzzle);
  showStatus("");
}

function showStatus(msg, isError) {
  if (!msg) { statusEl.classList.add("hidden"); return; }
  statusEl.classList.remove("hidden");
  statusEl.textContent = msg;
  statusEl.classList.toggle("error", !!isError);
}

// ---- unified tool button ----
function wireToolButton() {
  let gesture = {
    active: false, startX: 0, startY: 0,
    moved: false, dragMode: false, resetFired: false,
    resetTimer: null, overGrid: false,
  };

  const updateToolLabel = () => {
    if (!currentGame) return;
    toolLabel.textContent = currentGame.tool === "mark"
      ? `Mark ${settings.markSymbol}`
      : "Fill";
  };

  // update on initial
  updateToolLabel();

  toolBtn.addEventListener("pointerdown", e => {
    e.preventDefault();
    gesture.active = true;
    gesture.startX = e.clientX; gesture.startY = e.clientY;
    gesture.moved = false; gesture.dragMode = false; gesture.resetFired = false;
    gesture.overGrid = false;

    gesture.resetTimer = setTimeout(() => {
      if (!gesture.moved && currentGame) {
        gesture.resetFired = true;
        currentGame.reset();
        clearSavedState();
        if (navigator.vibrate) navigator.vibrate(30);
      }
    }, 1000);

    try { toolBtn.setPointerCapture(e.pointerId); } catch {}
  });

  toolBtn.addEventListener("pointermove", e => {
    if (!gesture.active) return;
    const dx = e.clientX - gesture.startX;
    const dy = e.clientY - gesture.startY;
    const dist = Math.hypot(dx, dy);

    if (!gesture.moved && dist > 10) {
      gesture.moved = true;
      clearTimeout(gesture.resetTimer);
      gesture.dragMode = true;
      toolBtn.classList.add("dragging");
      ghostEl.classList.remove("hidden");
    }

    if (gesture.dragMode && !gesture.resetFired) {
      ghostEl.style.left = e.clientX + "px";
      ghostEl.style.top = e.clientY + "px";
      ghostEl.textContent = "×";
      if (currentGame) currentGame.eraseAt(e.clientX, e.clientY);
    }
  });

  const end = e => {
    if (!gesture.active) return;
    clearTimeout(gesture.resetTimer);

    if (!gesture.moved && !gesture.resetFired && currentGame) {
      currentGame.setTool(currentGame.tool === "fill" ? "mark" : "fill");
      updateToolLabel();
    }

    gesture.active = false;
    gesture.dragMode = false;
    toolBtn.classList.remove("dragging");
    ghostEl.classList.add("hidden");
  };

  toolBtn.addEventListener("pointerup", end);
  toolBtn.addEventListener("pointercancel", end);
}