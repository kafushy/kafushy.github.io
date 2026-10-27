// nonogram/game.js

class NonogramGame {
  constructor(puzzle, canvas, settings, statusEl) {
    this.puzzle = puzzle;
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.settings = settings;
    this.statusEl = statusEl;

    if (puzzle.sections.length !== 2)
      throw new Error("Only 2-section (rectangular) puzzles supported for now");
    this.rows = puzzle.sections[0];
    this.cols = puzzle.sections[1];
    this.N = this.rows.length;
    this.M = this.cols.length;

    this.maxRowClues = Math.max(...this.rows.map(r => r.clues.length));
    this.maxColClues = Math.max(...this.cols.map(c => c.clues.length));

    this.state = Array.from({ length: this.N }, () => new Array(this.M).fill(0));
    this.marks = Array.from({ length: this.N }, () => new Array(this.M).fill(false));
    this.currentColor = 1;
    this.tool = "fill";
    this.won = false;
    this.painting = false;
    this.paintValue = null;
    this.dragStart = null;
    this.dragCurrent = null;
    this.dragAxis = null;
    this._checkingWin = false;
    this.onStateChange = null;

    this.gamepadEnabled = false;
    this.cursor = null;
    this.onGamepadTap = null;

    this.resize();
    this.render();

    this._lastWidth = window.innerWidth;
    this._onResize = () => {
      if (window.innerWidth === this._lastWidth) return;
      this._lastWidth = window.innerWidth;
      this.resize();
      this.render();
    };
    window.addEventListener("resize", this._onResize);

    this._keyHandler = (e) => {
      if (!this.gamepadEnabled) return;
      const moves = {
        ArrowUp: [-1, 0], ArrowDown: [1, 0],
        ArrowLeft: [0, -1], ArrowRight: [0, 1],
      };
      const m = moves[e.key];
      if (m) {
        e.preventDefault();
        this.moveCursor(m[0], m[1]);
      }
    };
    window.addEventListener("keydown", this._keyHandler);
  }

  destroy() {
    window.removeEventListener("resize", this._onResize);
    window.removeEventListener("keydown", this._keyHandler);
  }

  setTool(t) { this.tool = t; }
  setSettings(s) { this.settings = s; this.render(); }

  setStatus(text, isError) {
    if (!this.statusEl) return;
    if (!text) { this.statusEl.classList.add("hidden"); return; }
    this.statusEl.classList.remove("hidden");
    this.statusEl.textContent = text;
    this.statusEl.classList.toggle("error", !!isError);
  }

  notifyChange() { if (this.onStateChange) this.onStateChange(); }

  // ---- gamepad ----
  setGamepadEnabled(enabled) {
    this.gamepadEnabled = enabled;
    if (enabled && !this.cursor) {
      this.cursor = { r: Math.floor(this.N / 2), c: Math.floor(this.M / 2) };
    }
    this.render();
  }

  moveCursor(dr, dc) {
    if (!this.gamepadEnabled) return;
    if (!this.cursor) this.cursor = { r: 0, c: 0 };
    let nr = this.cursor.r + dr;
    let nc = this.cursor.c + dc;
    if (this.settings.cursorWrap) {
      nr = (nr + this.N) % this.N;
      nc = (nc + this.M) % this.M;
    } else {
      nr = Math.max(0, Math.min(this.N - 1, nr));
      nc = Math.max(0, Math.min(this.M - 1, nc));
    }
    this.cursor.r = nr;
    this.cursor.c = nc;
    this.render();
  }

  actAtCursor(type) {
    if (!this.gamepadEnabled || !this.cursor || this.won) return;
    const { r, c } = this.cursor;
    if (type === "fill") {
      const v = this.state[r][c] === this.currentColor ? 0 : this.currentColor;
      this.setCell(r, c, v);
    } else if (type === "mark") {
      this.setMark(r, c, !this.marks[r][c]);
    }
    this.autoMarkSolvedLines();
    this.render();
  }

  computeCursorColor() {
    if (!this.settings.cursorColorAuto) {
      return this.settings.cursorColorValue || "#fbbf24";
    }
    if (!this.cursor) return "#fbbf24";
    const v = this.state[this.cursor.r][this.cursor.c];
    if (v === 0) return "#fbbf24";
    const fgHex = this.puzzle.fg.palette[v - 1] || "#fbbf24";
    return this.invertColor(fgHex);
  }

  invertColor(hex) {
    hex = hex.replace("#", "");
    if (hex.length === 3) hex = hex.split("").map(c => c + c).join("");
    const r = 255 - parseInt(hex.slice(0, 2), 16);
    const g = 255 - parseInt(hex.slice(2, 4), 16);
    const b = 255 - parseInt(hex.slice(4, 6), 16);
    return "#" + [r, g, b].map(v => v.toString(16).padStart(2, "0")).join("");
  }

  // ---- sizing ----
  resize() {
    const wrap = this.canvas.parentElement;
    const availW = (wrap?.clientWidth || window.innerWidth) - 16;
    const availH = (wrap?.clientHeight || window.innerHeight) - 16;
    const clueFactor = 0.7;
    const totalWCells = this.M + this.maxRowClues * clueFactor;
    const totalHCells = this.N + this.maxColClues * clueFactor;
    let cs = Math.floor(Math.min(availW / totalWCells, availH / totalHCells));
    cs = Math.max(12, Math.min(56, cs));
    this.cellSize = cs;
    this.marginLeft = Math.ceil(this.maxRowClues * cs * clueFactor) + 4;
    this.marginTop = Math.ceil(this.maxColClues * cs * clueFactor) + 4;
    const logicalW = this.marginLeft + this.M * cs + 4;
    const logicalH = this.marginTop + this.N * cs + 4;
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = logicalW * dpr;
    this.canvas.height = logicalH * dpr;
    this.canvas.style.width = logicalW + "px";
    this.canvas.style.height = logicalH + "px";
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.logicalW = logicalW;
    this.logicalH = logicalH;
  }

  cellToPixel(r, c) {
    return { x: this.marginLeft + c * this.cellSize, y: this.marginTop + r * this.cellSize };
  }
  pixelToCell(x, y) {
    const c = Math.floor((x - this.marginLeft) / this.cellSize);
    const r = Math.floor((y - this.marginTop) / this.cellSize);
    if (c < 0 || c >= this.M || r < 0 || r >= this.N) return null;
    return { r, c };
  }

  // ---- render ----
  render() {
    this.ctx.clearRect(0, 0, this.logicalW, this.logicalH);
    this.drawBackground();
    this.drawCells();
    this.drawGridLines();
    this.drawClues();
    this.drawCursor();
    this.drawDragCounter();
    this.updateStatus();
  }

  makeGradient(palette, weights, angle, x, y, w, h) {
    const rad = angle * Math.PI / 180;
    const dx = Math.cos(rad), dy = -Math.sin(rad);
    const len = Math.abs(w * dx) + Math.abs(h * dy);
    const cx = x + w / 2, cy = y + h / 2;
    const g = this.ctx.createLinearGradient(cx-dx*len/2, cy-dy*len/2, cx+dx*len/2, cy+dy*len/2);
    const n = palette.length;
    if (n === 1) { g.addColorStop(0, palette[0]); g.addColorStop(1, palette[0]); return g; }
    const pos = [0]; let cum = 0;
    for (let i = 0; i < n; i++) { cum += weights[i]; pos.push(cum); }
    for (let i = 0; i < n; i++) g.addColorStop((pos[i]+pos[i+1])/2, palette[i]);
    g.addColorStop(0, palette[0]); g.addColorStop(1, palette[n-1]);
    return g;
  }

  drawBackground() {
    const gx = this.marginLeft, gy = this.marginTop;
    const gw = this.M * this.cellSize, gh = this.N * this.cellSize;
    const { palette, weights, angle } = this.puzzle.bg;
    this.ctx.fillStyle = this.makeGradient(palette, weights, angle, gx, gy, gw, gh);
    this.ctx.fillRect(gx, gy, gw, gh);
  }

  drawCells() {
    const ctx = this.ctx, cs = this.cellSize;
    const fg = this.puzzle.fg;
    const gx = this.marginLeft, gy = this.marginTop;
    const gw = this.M * cs, gh = this.N * cs;
    let gradientFill = null;
    if (!this.puzzle.multiColor && fg.palette.length > 1) {
      gradientFill = this.makeGradient(fg.palette, fg.weights, fg.angle, gx, gy, gw, gh);
    }
    const mark = this.settings.markSymbol || "×";
    for (let r = 0; r < this.N; r++) for (let c = 0; c < this.M; c++) {
      const { x, y } = this.cellToPixel(r, c);
      if (this.state[r][c] > 0) {
        ctx.fillStyle = this.puzzle.multiColor
          ? (fg.palette[this.state[r][c]-1] || fg.palette[0])
          : (gradientFill || fg.palette[0]);
        ctx.fillRect(x, y, cs, cs);
      } else if (this.marks[r][c]) {
        ctx.fillStyle = "#64748b";
        ctx.font = `${Math.floor(cs * 0.55)}px system-ui, sans-serif`;
        ctx.textAlign = "center"; ctx.textBaseline = "middle";
        ctx.fillText(mark, x + cs/2, y + cs/2 + 1);
      }
    }
  }

  drawGridLines() {
    const ctx = this.ctx, cs = this.cellSize;
    const x0 = this.marginLeft, y0 = this.marginTop;
    const x1 = x0 + this.M * cs, y1 = y0 + this.N * cs;

    if (this.settings.tileBorders) {
      ctx.strokeStyle = "rgba(148,163,184,0.15)"; ctx.lineWidth = 1;
      for (let c = 0; c <= this.M; c++) {
        ctx.beginPath(); ctx.moveTo(x0+c*cs, y0); ctx.lineTo(x0+c*cs, y1); ctx.stroke();
      }
      for (let r = 0; r <= this.N; r++) {
        ctx.beginPath(); ctx.moveTo(x0, y0+r*cs); ctx.lineTo(x1, y0+r*cs); ctx.stroke();
      }
    }

    const step = this.settings.gridLineEvery;
    if (step > 0) {
      ctx.strokeStyle = "rgba(148,163,184,0.6)"; ctx.lineWidth = 2;
      for (let c = 0; c <= this.M; c += step) {
        ctx.beginPath(); ctx.moveTo(x0+c*cs, y0); ctx.lineTo(x0+c*cs, y1); ctx.stroke();
      }
      for (let r = 0; r <= this.N; r += step) {
        ctx.beginPath(); ctx.moveTo(x0, y0+r*cs); ctx.lineTo(x1, y0+r*cs); ctx.stroke();
      }
    }

    ctx.strokeStyle = "rgba(203,213,225,0.8)"; ctx.lineWidth = 2;
    ctx.strokeRect(x0, y0, this.M*cs, this.N*cs);
  }

  drawClues() {
    const ctx = this.ctx, cs = this.cellSize, fg = this.puzzle.fg.palette;
    ctx.font = `${Math.max(10, Math.floor(cs * 0.42))}px system-ui, sans-serif`;
    ctx.textBaseline = "middle"; ctx.textAlign = "center";
    const surrounded = this.settings.surroundedOnly;
    const autoGray = this.settings.autoGray;

    for (let r = 0; r < this.N; r++) {
      const clues = this.rows[r].clues;
      const matched = autoGray
        ? this.matchClues(this.state[r], this.marks[r], clues, surrounded)
        : null;
      const { y } = this.cellToPixel(r, 0);
      for (let i = clues.length-1, k = 0; i >= 0; i--, k++) {
        const clue = clues[i];
        const cx = this.marginLeft - (k + 0.5) * cs * 0.7 - 4;
        const gray = matched ? matched[i] : false;
        ctx.fillStyle = gray ? "#475569" : (fg[clue.color-1] || "#e2e8f0");
        ctx.fillText(String(clue.value), cx, y + cs/2);
      }
    }
    for (let c = 0; c < this.M; c++) {
      const col = this.state.map(row => row[c]);
      const colMarks = this.marks.map(row => row[c]);
      const clues = this.cols[c].clues;
      const matched = autoGray
        ? this.matchClues(col, colMarks, clues, surrounded)
        : null;
      const { x } = this.cellToPixel(0, c);
      for (let i = clues.length-1, k = 0; i >= 0; i--, k++) {
        const clue = clues[i];
        const cy = this.marginTop - (k + 0.5) * cs * 0.7 - 4;
        const gray = matched ? matched[i] : false;
        ctx.fillStyle = gray ? "#475569" : (fg[clue.color-1] || "#e2e8f0");
        ctx.fillText(String(clue.value), x + cs/2, cy);
      }
    }
  }

  drawCursor() {
    if (!this.gamepadEnabled || !this.cursor) return;
    const { r, c } = this.cursor;
    const { x, y } = this.cellToPixel(r, c);
    const cs = this.cellSize;
    const color = this.computeCursorColor();
    this.ctx.strokeStyle = color;
    this.ctx.lineWidth = 3;
    this.ctx.strokeRect(x + 1.5, y + 1.5, cs - 3, cs - 3);
    this.ctx.globalAlpha = 0.35;
    this.ctx.strokeStyle = color;
    this.ctx.lineWidth = 1;
    this.ctx.strokeRect(x + 5.5, y + 5.5, cs - 11, cs - 11);
    this.ctx.globalAlpha = 1;
  }

  drawDragCounter() {
    const threshold = this.settings.dragCounterThreshold;
    if (!threshold || threshold <= 0) return;
    if (!this.painting || !this.dragAxis || !this.dragStart || !this.dragCurrent) return;
    const s = this.dragStart, e = this.dragCurrent, cs = this.cellSize;
    const len = this.dragAxis === "h"
      ? Math.abs(e.c - s.c) + 1
      : Math.abs(e.r - s.r) + 1;
    if (len < threshold) return;
    const dirH = Math.sign(e.c - s.c);
    const dirV = Math.sign(e.r - s.r);
    this.ctx.font = `bold ${Math.floor(cs * 0.35)}px system-ui, sans-serif`;
    this.ctx.textAlign = "center"; this.ctx.textBaseline = "top";
    for (let i = 0; i < len; i++) {
      const cell = this.dragAxis === "h"
        ? { r: s.r, c: s.c + i * dirH }
        : { r: s.r + i * dirV, c: s.c };
      const { x, y } = this.cellToPixel(cell.r, cell.c);
      this.ctx.fillStyle = "rgba(0,0,0,0.65)";
      this.ctx.fillText(String(i + 1), x + cs * 0.5 + 1, y + 3 + 1);
      this.ctx.fillStyle = "#fff";
      this.ctx.fillText(String(i + 1), x + cs * 0.5, y + 3);
    }
  }

  // ---- logic ----
  extractRuns(cells) {
    const runs = []; let cur = null;
    for (let i = 0; i < cells.length; i++) {
      const v = cells[i];
      if (v > 0) {
        if (cur && cur.color === v) { cur.len++; cur.end = i; }
        else { if (cur) runs.push(cur); cur = { color: v, len: 1, start: i, end: i }; }
      } else { if (cur) { runs.push(cur); cur = null; } }
    }
    if (cur) runs.push(cur);
    return runs;
  }

  isBoundary(cells, marks, idx) {
    if (idx < 0 || idx >= cells.length) return true;
    if (marks[idx]) return true;
    if (cells[idx] > 0) return true;
    return false;
  }

  runIsBounded(cells, marks, run) {
    return this.isBoundary(cells, marks, run.start-1) && this.isBoundary(cells, marks, run.end+1);
  }

  matchClues(cells, marks, clues, surroundedOnly) {
    const runs = this.extractRuns(cells);
    const matched = new Array(clues.length).fill(false);
    if (clues.length === 1 && clues[0].value === 0) {
      matched[0] = runs.length === 0; return matched;
    }
    let ri = 0;
    for (let ci = 0; ci < clues.length; ci++) {
      while (ri < runs.length) {
        if (runs[ri].color === clues[ci].color && runs[ri].len === clues[ci].value) {
          if (surroundedOnly && !this.runIsBounded(cells, marks, runs[ri])) { ri++; continue; }
          matched[ci] = true; ri++; break;
        }
        ri++;
      }
    }
    return matched;
  }

  lineSolved(cells, clues) {
    const runs = this.extractRuns(cells);
    if (clues.length === 1 && clues[0].value === 0) return runs.length === 0;
    if (runs.length !== clues.length) return false;
    return runs.every((r, i) => r.color === clues[i].color && r.len === clues[i].value);
  }

  checkWin() {
    for (let r = 0; r < this.N; r++) if (!this.lineSolved(this.state[r], this.rows[r].clues)) return false;
    for (let c = 0; c < this.M; c++) {
      if (!this.lineSolved(this.state.map(row => row[c]), this.cols[c].clues)) return false;
    }
    return true;
  }

  autoMarkSolvedLines() {
    if (!this.settings.autoMark) return;
    let changed = false;
    for (let r = 0; r < this.N; r++) {
      if (this.lineSolved(this.state[r], this.rows[r].clues)) {
        for (let c = 0; c < this.M; c++) {
          if (this.state[r][c] === 0 && !this.marks[r][c]) { this.marks[r][c] = true; changed = true; }
        }
      }
    }
    for (let c = 0; c < this.M; c++) {
      const col = this.state.map(row => row[c]);
      if (this.lineSolved(col, this.cols[c].clues)) {
        for (let r = 0; r < this.N; r++) {
          if (this.state[r][c] === 0 && !this.marks[r][c]) { this.marks[r][c] = true; changed = true; }
        }
      }
    }
    if (changed) this.notifyChange();
  }

  updateStatus() {
    if (this.won) return;
    if (!this.checkWin()) return;
    if (this.puzzle.strict) {
      this.gridHash().then(h => {
        if (!this.checkWin()) return;
        const exp = this.puzzle.options.hash;
        if (exp === "sha256:" + h || exp === h) { this.won = true; this.setStatus("Solved ✓"); }
        else this.setStatus("All clues satisfied — but not the intended solution.", true);
      });
    } else {
      this.won = true;
      this.setStatus("Solved ✓");
    }
  }

  async gridHash() {
    const str = this.state.map(row => row.map(v => v.toString(36)).join("")).join("\n");
    const buf = new TextEncoder().encode(str);
    const hashBuf = await crypto.subtle.digest("SHA-256", buf);
    return Array.from(new Uint8Array(hashBuf)).map(b => b.toString(16).padStart(2,"0")).join("");
  }

  // ---- mutation ----
  setCell(r, c, val) {
    if (this.state[r][c] === val) return;
    if (val > 0 && this.marks[r][c] && this.settings.marksBlockFill) return;
    this.state[r][c] = val;
    if (val > 0) this.marks[r][c] = false;
    this.notifyChange();
  }
  setMark(r, c, val) {
    if (this.marks[r][c] === val) return;
    this.marks[r][c] = val;
    if (val) this.state[r][c] = 0;
    this.notifyChange();
  }
  eraseCell(r, c) {
    if (this.state[r][c] === 0 && !this.marks[r][c]) return;
    this.state[r][c] = 0; this.marks[r][c] = false;
    this.notifyChange();
  }

  reset() {
    for (let r = 0; r < this.N; r++) for (let c = 0; c < this.M; c++) {
      this.state[r][c] = 0; this.marks[r][c] = false;
    }
    this.won = false;
    this.setStatus("");
    this.notifyChange();
    this.render();
  }

  // ---- pointer events ----
  setupPointerEvents() {
    const canvas = this.canvas;
    const getCell = e => {
      const rect = canvas.getBoundingClientRect();
      return this.pixelToCell(e.clientX - rect.left, e.clientY - rect.top);
    };
    canvas.addEventListener("contextmenu", e => e.preventDefault());

    canvas.addEventListener("pointerdown", e => {
      if (this.gamepadEnabled) {
        if (this.onGamepadTap) this.onGamepadTap();
        return;
      }
      if (this.won) return;
      this.painting = true;
      const cell = getCell(e);
      if (!cell) return;
      this.dragStart = { ...cell };
      this.dragCurrent = { ...cell };
      this.dragAxis = null;
      const isRight = e.button === 2;
      const { r, c } = cell;
      if (isRight || this.tool === "mark") {
        this.paintValue = { type: "mark", value: !this.marks[r][c] };
        this.setMark(r, c, this.paintValue.value);
      } else {
        const v = this.state[r][c] === this.currentColor ? 0 : this.currentColor;
        this.paintValue = { type: "state", value: v };
        this.setCell(r, c, v);
      }
      this.render();
    });

    canvas.addEventListener("pointermove", e => {
      if (!this.painting || this.won || !this.paintValue) return;
      const cell = getCell(e);
      if (!cell) return;
      this.dragCurrent = { ...cell };
      if (this.dragStart) {
        if (cell.r === this.dragStart.r) this.dragAxis = "h";
        else if (cell.c === this.dragStart.c) this.dragAxis = "v";
        else this.dragAxis = null;
      }
      if (this.paintValue.type === "mark") this.setMark(cell.r, cell.c, this.paintValue.value);
      else this.setCell(cell.r, cell.c, this.paintValue.value);
      this.render();
    });

    const stop = () => {
      this.painting = false; this.paintValue = null;
      this.dragStart = null; this.dragCurrent = null; this.dragAxis = null;
      this.autoMarkSolvedLines();
      this.render();
    };
    canvas.addEventListener("pointerup", stop);
    canvas.addEventListener("pointercancel", stop);
    canvas.addEventListener("pointerleave", stop);
  }
}