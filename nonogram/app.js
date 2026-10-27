// nonogram/app.js

const DEFAULT_PUZZLE_TEXT = `
kafushy, Heart, 2026-10-26, v1
#0f172a 3 #1e293b 1 90 / #ef4444 90
/1 1.5.5.3.1/2.4.4.4.2
`;

const DEFAULT_SETTINGS = {
  autoMark: false,
  autoGray: true,
  surroundedOnly: false,
  marksBlockFill: true,
  tileBorders: true,
  gridLineEvery: 5,
  dragCounterThreshold: 0,
  markSymbol: "×",
  pageBgColor: "#0f172a",
  gamepadScale: 1,
  gamepadPosition: "bottom-left",
  gamepadColor: "#1e293b",
  cursorColorAuto: true,
  cursorColorValue: "#fbbf24",
  cursorWrap: false,
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
function saveSettings(s) {
  try { localStorage.setItem("nono_settings", JSON.stringify(s)); } catch {}
}
function loadPuzzleText() {
  return localStorage.getItem("nono_puzzleText") || DEFAULT_PUZZLE_TEXT;
}
function savePuzzleText(t) {
  try { localStorage.setItem("nono_puzzleText", t); } catch {}
}
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
function clearSavedState() {
  try { localStorage.removeItem("nono_state"); } catch {}
}

// ---- globals ----
let currentGame = null;
let currentPuzzleText = loadPuzzleText();
let settings = loadSettings();
let gamepadVisible = false;

document.documentElement.style.setProperty("--bg", settings.pageBgColor || "#0f172a");

let gameWrap, toolBtn, toolSymbol, statusEl, gamepadEl, gamepadInner;

// ---- boot ----
document.addEventListener("DOMContentLoaded", () => {
  gameWrap = document.getElementById("game-wrap");
  toolBtn = document.getElementById("tool-btn");
  toolSymbol = document.getElementById("tool-symbol");
  statusEl = document.getElementById("status");
  gamepadEl = document.getElementById("gamepad");
  gamepadInner = document.getElementById("gamepad-inner");

  wireHeader();
  wireTabs();
  wireSettingsControls();
  wireToolButton();
  wireGamepad();
  applyGamepadStyle();
  loadPuzzle(currentPuzzleText, loadSavedState(currentPuzzleText));
});

function wireHeader() {
  document.getElementById("header").addEventListener("click", () => {
    document.getElementById("options").classList.toggle("hidden");
  });
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

// ---- settings ----
function wireSettingsControls() {
  const bindToggle = (id, key, after) => {
    const el = document.getElementById(id);
    el.checked = !!settings[key];
    el.addEventListener("change", () => {
      settings[key] = el.checked;
      saveSettings(settings);
      if (currentGame) currentGame.setSettings(settings);
      if (after) after();
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
  bindToggle("set-marksBlockFill", "marksBlockFill");
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
    updateToolSymbol();
    updateGamepadButtons();
  });

  const pageBg = document.getElementById("set-pageBgColor");
  pageBg.value = settings.pageBgColor || "#0f172a";
  pageBg.addEventListener("input", () => {
    settings.pageBgColor = pageBg.value;
    document.documentElement.style.setProperty("--bg", pageBg.value);
    saveSettings(settings);
  });

  // Gamepad
  const scaleEl = document.getElementById("set-gamepadScale");
  scaleEl.value = settings.gamepadScale;
  scaleEl.addEventListener("input", () => {
    settings.gamepadScale = parseFloat(scaleEl.value);
    saveSettings(settings);
    applyGamepadStyle();
  });

  const posEl = document.getElementById("set-gamepadPosition");
  posEl.value = settings.gamepadPosition;
  posEl.addEventListener("change", () => {
    settings.gamepadPosition = posEl.value;
    saveSettings(settings);
    applyGamepadStyle();
  });

  const gpColor = document.getElementById("set-gamepadColor");
  gpColor.value = settings.gamepadColor;
  gpColor.addEventListener("input", () => {
    settings.gamepadColor = gpColor.value;
    saveSettings(settings);
    applyGamepadStyle();
  });

  bindToggle("set-cursorWrap", "cursorWrap");

  const cursorAuto = document.getElementById("set-cursorColorAuto");
  const cursorFixedRow = document.getElementById("cursorColorFixedRow");
  const cursorValue = document.getElementById("set-cursorColorValue");
  cursorAuto.checked = !!settings.cursorColorAuto;
  cursorValue.value = settings.cursorColorValue || "#fbbf24";
  cursorFixedRow.style.display = settings.cursorColorAuto ? "none" : "flex";
  cursorAuto.addEventListener("change", () => {
    settings.cursorColorAuto = cursorAuto.checked;
    cursorFixedRow.style.display = settings.cursorColorAuto ? "none" : "flex";
    saveSettings(settings);
    if (currentGame) currentGame.render();
  });
  cursorValue.addEventListener("input", () => {
    settings.cursorColorValue = cursorValue.value;
    saveSettings(settings);
    if (currentGame) currentGame.render();
  });
}

// ---- info ----
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

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, c =>
    ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
}

// ---- load ----
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
    currentGame.onGamepadTap = () => disableGamepad();
    currentGame.setupPointerEvents();
    currentGame.setGamepadEnabled(gamepadVisible);
  } catch (e) { showStatus("Error: " + e.message, true); return; }

  currentPuzzleText = text;
  savePuzzleText(text);
  renderInfo(puzzle);
  updateToolSymbol();
  updateGamepadButtons();
  showStatus("");
}

function showStatus(msg, isError) {
  if (!msg) { statusEl.classList.add("hidden"); return; }
  statusEl.classList.remove("hidden");
  statusEl.textContent = msg;
  statusEl.classList.toggle("error", !!isError);
}

// ---- gamepad show/hide ----
function enableGamepad() {
  gamepadVisible = true;
  toolBtn.classList.add("hidden");
  gamepadEl.classList.remove("hidden");
  if (currentGame) currentGame.setGamepadEnabled(true);
}
function disableGamepad() {
  gamepadVisible = false;
  toolBtn.classList.remove("hidden");
  gamepadEl.classList.add("hidden");
  if (currentGame) currentGame.setGamepadEnabled(false);
  updateToolSymbol();
}

function applyGamepadStyle() {
  // Position class
  gamepadEl.classList.remove("pos-bl", "pos-br", "pos-tl", "pos-tr");
  gamepadEl.classList.add("pos-" + (settings.gamepadPosition || "bottom-left").split("-").map(w => w[0]).join(""));
  // Scale + color via CSS vars
  gamepadEl.style.setProperty("--gp-scale", settings.gamepadScale || 1);
  gamepadEl.style.setProperty("--gp-color", settings.gamepadColor || "#1e293b");
}

function updateToolSymbol() {
  if (!currentGame || !toolSymbol) return;
  toolSymbol.textContent = currentGame.tool === "mark" ? settings.markSymbol : "";
}

function updateGamepadButtons() {
  if (!currentGame) return;
  const markBtn = document.getElementById("gp-mark");
  const fillBtn = document.getElementById("gp-fill");
  if (markBtn) markBtn.textContent = settings.markSymbol;
  if (fillBtn) {
    const fg = currentGame.puzzle.fg.palette;
    const color = fg[0] || "#ef4444";
    gamepadEl.style.setProperty("--gp-fg", color);
  }
}

// ---- gamepad wiring ----
function wireGamepad() {
  const moves = {
    up: [-1, 0], down: [1, 0], left: [0, -1], right: [0, 1],
  };

  document.querySelectorAll(".dpad-btn[data-dir]").forEach(btn => {
    const dir = moves[btn.dataset.dir];
    if (!dir) return;
    let initialTimer = null, repeatTimer = null;

    const start = e => {
      e.preventDefault();
      if (!currentGame) return;
      currentGame.moveCursor(dir[0], dir[1]);
      initialTimer = setTimeout(() => {
        repeatTimer = setInterval(() => {
          if (currentGame) currentGame.moveCursor(dir[0], dir[1]);
        }, 80);
      }, 300);
    };
    const stop = () => {
      clearTimeout(initialTimer);
      clearInterval(repeatTimer);
    };

    btn.addEventListener("pointerdown", start);
    btn.addEventListener("pointerup", stop);
    btn.addEventListener("pointercancel", stop);
    btn.addEventListener("pointerleave", stop);
  });

  document.querySelectorAll(".act-btn").forEach(btn => {
    btn.addEventListener("click", e => {
      e.preventDefault();
      if (!currentGame) return;
      currentGame.actAtCursor(btn.dataset.action);
    });
  });
}

// ---- tool button ----
function wireToolButton() {
  let gesture = {
    active: false, startX: 0, startY: 0,
    moved: false, resetFired: false,
    resetTimer: null,
  };

  toolBtn.addEventListener("pointerdown", e => {
    e.preventDefault();
    gesture.active = true;
    gesture.startX = e.clientX;
    gesture.startY = e.clientY;
    gesture.moved = false;
    gesture.resetFired = false;
    toolBtn.classList.add("held");

    gesture.resetTimer = setTimeout(() => {
      if (!gesture.moved && currentGame) {
        gesture.resetFired = true;
        currentGame.reset();
        clearSavedState();
        if (navigator.vibrate) navigator.vibrate(30);
        toolBtn.classList.add("flash");
        setTimeout(() => toolBtn.classList.remove("flash"), 500);
      }
    }, 1000);

    try { toolBtn.setPointerCapture(e.pointerId); } catch {}
  });

  toolBtn.addEventListener("pointermove", e => {
    if (!gesture.active || gesture.resetFired) return;
    const dist = Math.hypot(e.clientX - gesture.startX, e.clientY - gesture.startY);
    if (!gesture.moved && dist > 10) {
      gesture.moved = true;
      clearTimeout(gesture.resetTimer);
      toolBtn.classList.remove("held");
      enableGamepad();
    }
  });

  const end = e => {
    if (!gesture.active) return;
    clearTimeout(gesture.resetTimer);
    toolBtn.classList.remove("held");

    if (!gesture.moved && !gesture.resetFired && currentGame) {
      currentGame.setTool(currentGame.tool === "fill" ? "mark" : "fill");
      updateToolSymbol();
    }

    gesture.active = false;
    gesture.moved = false;
  };

  toolBtn.addEventListener("pointerup", end);
  toolBtn.addEventListener("pointercancel", end);
}