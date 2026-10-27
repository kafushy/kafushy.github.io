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
    this.previewTrail = null;
    this.previewValue = null;
    this.dragStart = null;
    this.dragMovedAway = false;
    this.dragCurrent = null;
    this.dragAxis = null;
    this._checkingWin = false;
    this._solvedRaf = null;
    this.onStateChange = null;

    this.gamepadEnabled = false;
    this.cursor = null;
    this.onGamepadTap = null;
    this.gamepadDragCell = null;

    this.highlightCell = null;
    this.suppressedMarks = new Set();
    this.autoMarkedCells = new Set();
    this.manualGrayRows = new Map();
    this.manualGrayCols = new Map();

    this.resize();
    this.render();

    this._resizePending = false;
    this._resizeObserver = new ResizeObserver(() => {
      if (this._resizePending) return;
      this._resizePending = true;
      requestAnimationFrame(() => {
        this._resizePending = false;
        this.resize();
        this.render();
      });
    });
    if (this.canvas.parentElement) {
      this._resizeObserver.observe(this.canvas.parentElement);
    }

    this._keyHandler = (e) => {
      if (!this.gamepadEnabled) return;
      const moves = {
        ArrowUp: [-1, 0], ArrowDown: [1, 0],
        ArrowLeft: [0, -1], ArrowRight: [0, 1],
      };
      const m = moves[e.key];
      if (m) { e.preventDefault(); this.moveCursor(m[0], m[1]); }
    };
    window.addEventListener("keydown", this._keyHandler);
  }

  destroy() {
    if (this._resizeObserver) this._resizeObserver.disconnect();
    window.removeEventListener("keydown", this._keyHandler);
    if (this._solvedRaf) cancelAnimationFrame(this._solvedRaf);
  }

  setTool(t) { this.tool = t; }
  setSettings(s) { this.settings = s; this.resize(); this.render(); }

  setStatus(text, isError) {
    if (!this.statusEl) return;
    if (!text) { this.statusEl.classList.add("hidden"); return; }
    this.statusEl.classList.remove("hidden");
    this.statusEl.textContent = text;
    this.statusEl.classList.toggle("error", !!isError);
  }

  notifyChange() { if (this.onStateChange) this.onStateChange(); }

  getClueSides() {
    const pos = this.settings.cluePos || "top-left";
    return {
      row: pos.endsWith("left") ? "left" : "right",
      col: pos.startsWith("top") ? "top" : "bottom",
    };
  }

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
    this.cursor.r = nr; this.cursor.c = nc;
    this.render();
  }

  invertColor(hex) {
    hex = hex.replace("#", "");
    if (hex.length === 3) hex = hex.split("").map(c => c + c).join("");
    const r = 255 - parseInt(hex.slice(0, 2), 16);
    const g = 255 - parseInt(hex.slice(2, 4), 16);
    const b = 255 - parseInt(hex.slice(4, 6), 16);
    return "#" + [r, g, b].map(v => v.toString(16).padStart(2, "0")).join("");
  }

  colorForCell(cell) {
    if (!cell) return "#fbbf24";
    if (!this.settings.cursorColorAuto) return this.settings.cursorColorValue || "#fbbf24";
    const v = this.state[cell.r][cell.c];
    if (v === 0) return "#fbbf24";
    return this.invertColor(this.puzzle.fg.palette[v - 1] || "#fbbf24");
  }

  // End of current placement (last cell of drag preview, or gamepad cursor, or hover)
  getHighlightEndCell() {
    if (this.painting && this.previewTrail && this.previewTrail.length > 0) {
      return this.previewTrail[this.previewTrail.length - 1];
    }
    if (this.gamepadDragCell) return this.gamepadDragCell;
    if (this.gamepadEnabled && this.cursor) return this.cursor;
    if (this.highlightCell) return this.highlightCell;
    return null;
  }

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

    // Symmetric pad with extra room so multi-clue rows don't clip
    this.padRow = Math.ceil(this.maxRowClues * cs * clueFactor + cs * 0.5) + 4;
    this.padCol = Math.ceil(this.maxColClues * cs * clueFactor + cs * 0.5) + 4;
    this.gridX = this.padRow;
    this.gridY = this.padCol;
    this.gridW = this.M * cs;
    this.gridH = this.N * cs;

    const logicalW = this.padRow * 2 + this.gridW;
    const logicalH = this.padCol * 2 + this.gridH;

    const dpr = Math.max(1, Math.round(window.devicePixelRatio || 1));
    this.canvas.width = logicalW * dpr;
    this.canvas.height = logicalH * dpr;
    this.canvas.style.width = logicalW + "px";
    this.canvas.style.height = logicalH + "px";
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.logicalW = logicalW;
    this.logicalH = logicalH;
  }

  cellToPixel(r, c) {
    return { x: this.gridX + c * this.cellSize, y: this.gridY + r * this.cellSize };
  }
  pixelToCell(x, y) {
    const c = Math.floor((x - this.gridX) / this.cellSize);
    const r = Math.floor((y - this.gridY) / this.cellSize);
    if (c < 0 || c >= this.M || r < 0 || r >= this.N) return null;
    return { r, c };
  }

  render() {
    this.ctx.clearRect(0, 0, this.logicalW, this.logicalH);
    this.drawBackground();
    this.drawCells();
    this.drawPreview();
    this.drawHighlight();     // 4 lines + clue backgrounds, drawn ABOVE cells
    this.drawGridLines();
    this.drawClues();
    this.drawCursor();
    this.drawDragCounter();
    if (this.won) this.drawSolvedShimmer();
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

  hexWithAlpha(hex, a) {
    hex = hex.replace("#", "");
    if (hex.length === 3) hex = hex.split("").map(c => c + c).join("");
    const r = parseInt(hex.slice(0, 2), 16);
    const g = parseInt(hex.slice(2, 4), 16);
    const b = parseInt(hex.slice(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${a})`;
  }

  drawBackground() {
    const { palette, weights, angle } = this.puzzle.bg;
    this.ctx.fillStyle = this.makeGradient(palette, weights, angle, this.gridX, this.gridY, this.gridW, this.gridH);
    this.ctx.fillRect(this.gridX, this.gridY, this.gridW, this.gridH);
  }

  drawCells() {
    const ctx = this.ctx, cs = this.cellSize;
    const fg = this.puzzle.fg;
    let gradientFill = null;
    if (!this.puzzle.multiColor && fg.palette.length > 1) {
      gradientFill = this.makeGradient(fg.palette, fg.weights, fg.angle, this.gridX, this.gridY, this.gridW, this.gridH);
    }
    const mark = this.settings.markSymbol || "×";
    for (let r = 0; r < this.N; r++) for (let c = 0; c < this.M; c++) {
      const { x, y } = this.cellToPixel(r, c);
      if (this.state[r][c] > 0) {
        ctx.fillStyle = this.puzzle.multiColor
          ? (fg.palette[this.state[r][c]-1] || fg.palette[0])
          : (gradientFill || fg.palette[0]);
        const x0 = Math.floor(x), y0 = Math.floor(y);
        ctx.fillRect(x0, y0, Math.ceil(x + cs) - x0, Math.ceil(y + cs) - y0);
      } else if (this.marks[r][c]) {
        ctx.fillStyle = "#64748b";
        ctx.font = `${Math.floor(cs * 0.55)}px system-ui, sans-serif`;
        ctx.textAlign = "center"; ctx.textBaseline = "middle";
        ctx.fillText(mark, x + cs/2, y + cs/2 + 1);
      }
    }
  }

  drawPreview() {
    if (!this.previewTrail || !this.previewValue) return;
    const ctx = this.ctx, cs = this.cellSize;
    const fg = this.puzzle.fg;
    const mark = this.settings.markSymbol || "×";
    ctx.save();
    ctx.globalAlpha = 0.55;
    for (const cell of this.previewTrail) {
      const { x, y } = this.cellToPixel(cell.r, cell.c);
      const x0 = Math.floor(x), y0 = Math.floor(y);
      const w = Math.ceil(x + cs) - x0, h = Math.ceil(y + cs) - y0;
      if (this.previewValue.type === "state") {
        if (this.previewValue.value === 0) {
          ctx.fillStyle = "#0f172a";
          ctx.fillRect(x0, y0, w, h);
        } else {
          ctx.fillStyle = this.puzzle.multiColor
            ? (fg.palette[this.previewValue.value - 1] || fg.palette[0])
            : fg.palette[0];
          ctx.fillRect(x0, y0, w, h);
        }
      } else if (this.previewValue.type === "mark" && this.previewValue.value) {
        ctx.fillStyle = "#94a3b8";
        ctx.font = `${Math.floor(cs * 0.55)}px system-ui, sans-serif`;
        ctx.textAlign = "center"; ctx.textBaseline = "middle";
        ctx.fillText(mark, x + cs/2, y + cs/2 + 1);
      }
    }
    ctx.restore();
  }

  // 4 lines along the sides of the highlighted tile (band through row + column)
  // + slight bg tint on the matching clue areas
  drawHighlight() {
    if (!this.settings.highlight) return;
    const cell = this.getHighlightEndCell();
    if (!cell) return;

    const cs = this.cellSize;
    const { x: cellX, y: cellY } = this.cellToPixel(cell.r, cell.c);
    const color = this.colorForCell(cell);

    // ---- Clue background tints ----
    const sides = this.getClueSides();
    const gap = cs * 0.7;
    const rowClues = this.rows[cell.r].clues;
    const rowClueW = rowClues.length * gap + cs * 0.4;
    const rowBgX = sides.row === "left" ? this.gridX - rowClueW : this.gridX + this.gridW;
    const rowBgY = this.gridY + cell.r * cs;
    this.ctx.fillStyle = this.hexWithAlpha(color, 0.14);
    this.ctx.fillRect(Math.floor(rowBgX), Math.floor(rowBgY), Math.ceil(rowClueW), Math.ceil(cs));

    const colClues = this.cols[cell.c].clues;
    const colClueH = colClues.length * gap + cs * 0.4;
    const colBgY = sides.col === "top" ? this.gridY - colClueH : this.gridY + this.gridH;
    const colBgX = this.gridX + cell.c * cs;
    this.ctx.fillStyle = this.hexWithAlpha(color, 0.14);
    this.ctx.fillRect(Math.floor(colBgX), Math.floor(colBgY), Math.ceil(cs), Math.ceil(colClueH));

    // ---- 4 lines ----
    this.ctx.save();
    this.ctx.shadowBlur = 6;
    this.ctx.shadowColor = color;
    this.ctx.strokeStyle = color;
    this.ctx.lineWidth = 2;

    const gx0 = this.gridX, gx1 = this.gridX + this.gridW;
    const gy0 = this.gridY, gy1 = this.gridY + this.gridH;

    // Top of row
    this.ctx.beginPath();
    this.ctx.moveTo(gx0, cellY);
    this.ctx.lineTo(gx1, cellY);
    this.ctx.stroke();

    // Bottom of row
    this.ctx.beginPath();
    this.ctx.moveTo(gx0, cellY + cs);
    this.ctx.lineTo(gx1, cellY + cs);
    this.ctx.stroke();

    // Left of column
    this.ctx.beginPath();
    this.ctx.moveTo(cellX, gy0);
    this.ctx.lineTo(cellX, gy1);
    this.ctx.stroke();

    // Right of column
    this.ctx.beginPath();
    this.ctx.moveTo(cellX + cs, gy0);
    this.ctx.lineTo(cellX + cs, gy1);
    this.ctx.stroke();

    this.ctx.restore();
  }

  drawGridLines() {
    const ctx = this.ctx, cs = this.cellSize;
    const x0 = this.gridX, y0 = this.gridY;
    const x1 = x0 + this.gridW, y1 = y0 + this.gridH;

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
    ctx.strokeRect(x0, y0, this.gridW, this.gridH);
  }

  drawClues() {
    const ctx = this.ctx, cs = this.cellSize, fg = this.puzzle.fg.palette;
    ctx.font = `${Math.max(10, Math.floor(cs * 0.42))}px system-ui, sans-serif`;
    ctx.textBaseline = "middle"; ctx.textAlign = "center";
    const surrounded = this.settings.surroundedOnly;
    const autoGray = this.settings.autoGray;
    const sides = this.getClueSides();
    const gap = cs * 0.7;

    for (let r = 0; r < this.N; r++) {
      const clues = this.rows[r].clues;
      const matched = autoGray
        ? this.matchClues(this.state[r], this.marks[r], clues, surrounded)
        : null;
      const manual = this.manualGrayRows.get(r) || null;
      const isZero = clues.length === 1 && clues[0].value === 0;
      const lineEmpty = this.state[r].every(v => v === 0);
      const { y } = this.cellToPixel(r, 0);
      for (let i = clues.length-1, k = 0; i >= 0; i--, k++) {
        const clue = clues[i];
        const cx = sides.row === "left"
          ? this.gridX - (k + 0.5) * gap - 4
          : this.gridX + this.gridW + (k + 0.5) * gap + 4;
        let gray = false;
        if (isZero && lineEmpty) gray = true;
        else if (autoGray && matched) gray = matched[i];
        else if (manual && manual.has(i)) gray = true;
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
      const manual = this.manualGrayCols.get(c) || null;
      const isZero = clues.length === 1 && clues[0].value === 0;
      const lineEmpty = col.every(v => v === 0);
      const { x } = this.cellToPixel(0, c);
      for (let i = clues.length-1, k = 0; i >= 0; i--, k++) {
        const clue = clues[i];
        const cy = sides.col === "top"
          ? this.gridY - (k + 0.5) * gap - 4
          : this.gridY + this.gridH + (k + 0.5) * gap + 4;
        let gray = false;
        if (isZero && lineEmpty) gray = true;
        else if (autoGray && matched) gray = matched[i];
        else if (manual && manual.has(i)) gray = true;
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
    const color = this.colorForCell(this.cursor);
    this.ctx.strokeStyle = color;
    this.ctx.lineWidth = 3;
    this.ctx.strokeRect(x + 1.5, y + 1.5, cs - 3, cs - 3);
    this.ctx.globalAlpha = 0.35;
    this.ctx.lineWidth = 1;
    this.ctx.strokeRect(x + 5.5, y + 5.5, cs - 11, cs - 11);
    this.ctx.globalAlpha = 1;
  }

  drawSolvedShimmer() {
    const t = performance.now() / 1000;
    const pulse = (Math.sin(t * 3) + 1) / 2;
    const alpha = 0.4 + pulse * 0.5;
    this.ctx.save();
    this.ctx.shadowBlur = 12 + pulse * 12;
    this.ctx.shadowColor = `rgba(251, 191, 36, ${alpha})`;
    this.ctx.strokeStyle = `rgba(251, 191, 36, ${alpha})`;
    this.ctx.lineWidth = 3;
    this.ctx.strokeRect(this.gridX + 1, this.gridY + 1, this.gridW - 2, this.gridH - 2);
    this.ctx.restore();
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

    // 1. Cleanup orphaned auto-marks (only if enabled)
    if (this.settings.cleanupAutoMarks) {
      for (const key of [...this.autoMarkedCells]) {
        const [r, c] = key.split(",").map(Number);
        if (!this.marks[r] || !this.marks[r][c]) {
          this.autoMarkedCells.delete(key);
          continue;
        }
        const rowSolved = this.lineSolved(this.state[r], this.rows[r].clues);
        const colState = this.state.map(row => row[c]);
        const colSolved = this.lineSolved(colState, this.cols[c].clues);
        if (!rowSolved && !colSolved) {
          this.marks[r][c] = false;
          this.autoMarkedCells.delete(key);
          changed = true;
        }
      }
    }

    // 2. Place auto-marks on solved lines
    for (let r = 0; r < this.N; r++) {
      if (this.lineSolved(this.state[r], this.rows[r].clues)) {
        for (let c = 0; c < this.M; c++) {
          if (this.state[r][c] === 0 && !this.marks[r][c]
              && !this.suppressedMarks.has(`${r},${c}`)) {
            this.marks[r][c] = true;
            this.autoMarkedCells.add(`${r},${c}`);
            changed = true;
          }
        }
      }
    }
    for (let c = 0; c < this.M; c++) {
      const col = this.state.map(row => row[c]);
      if (this.lineSolved(col, this.cols[c].clues)) {
        for (let r = 0; r < this.N; r++) {
          if (this.state[r][c] === 0 && !this.marks[r][c]
              && !this.suppressedMarks.has(`${r},${c}`)) {
            this.marks[r][c] = true;
            this.autoMarkedCells.add(`${r},${c}`);
            changed = true;
          }
        }
      }
    }
    if (changed) this.notifyChange();
  }

  updateStatus() {
    if (this.won) return;
    if (!this.checkWin()) return;
    const markWon = () => {
      this.won = true;
      if (this._solvedRaf) cancelAnimationFrame(this._solvedRaf);
      const tick = () => {
        if (!this.won) { this._solvedRaf = null; return; }
        this.render();
        this._solvedRaf = requestAnimationFrame(tick);
      };
      this._solvedRaf = requestAnimationFrame(tick);
    };
    if (this.puzzle.strict) {
      this.gridHash().then(h => {
        if (!this.checkWin()) return;
        const exp = this.puzzle.options.hash;
        if (exp === "sha256:" + h || exp === h) markWon();
      });
    } else {
      markWon();
    }
  }

  async gridHash() {
    const str = this.state.map(row => row.map(v => v.toString(36)).join("")).join("\n");
    const buf = new TextEncoder().encode(str);
    const hashBuf = await crypto.subtle.digest("SHA-256", buf);
    return Array.from(new Uint8Array(hashBuf)).map(b => b.toString(16).padStart(2,"0")).join("");
  }

  setCell(r, c, val) {
    if (this.state[r][c] === val) return;
    if (val > 0 && this.marks[r][c] && this.settings.marksBlockFill) return;
    this.state[r][c] = val;
    this.suppressedMarks.delete(`${r},${c}`);
    this.autoMarkedCells.delete(`${r},${c}`);
    this.manualGrayRows.delete(r);
    this.manualGrayCols.delete(c);
    if (val > 0) this.marks[r][c] = false;
    this.notifyChange();
  }
  setMark(r, c, val) {
    if (this.marks[r][c] === val) return;
    if (val && this.state[r][c] > 0 && this.settings.marksBlockFill) return;
    this.marks[r][c] = val;
    this.autoMarkedCells.delete(`${r},${c}`);
    if (val) {
      this.state[r][c] = 0;
      this.suppressedMarks.delete(`${r},${c}`);
    } else {
      this.suppressedMarks.add(`${r},${c}`);
    }
    this.manualGrayRows.delete(r);
    this.manualGrayCols.delete(c);
    this.notifyChange();
  }
  eraseCell(r, c) {
    if (this.state[r][c] === 0 && !this.marks[r][c]) return;
    this.state[r][c] = 0;
    this.marks[r][c] = false;
    this.suppressedMarks.delete(`${r},${c}`);
    this.autoMarkedCells.delete(`${r},${c}`);
    this.manualGrayRows.delete(r);
    this.manualGrayCols.delete(c);
    this.notifyChange();
  }

  reset() {
    for (let r = 0; r < this.N; r++) for (let c = 0; c < this.M; c++) {
      this.state[r][c] = 0; this.marks[r][c] = false;
    }
    this.won = false;
    if (this._solvedRaf) { cancelAnimationFrame(this._solvedRaf); this._solvedRaf = null; }
    this.suppressedMarks.clear();
    this.autoMarkedCells.clear();
    this.manualGrayRows.clear();
    this.manualGrayCols.clear();
    this.previewTrail = null;
    this.previewValue = null;
    this.setStatus("");
    this.notifyChange();
    this.render();
  }

  toggleManualGray(axis, index, clueIdx) {
    let cells, marks, clues;
    if (axis === "row") {
      cells = this.state[index]; marks = this.marks[index]; clues = this.rows[index].clues;
    } else {
      cells = this.state.map(r => r[index]); marks = this.marks.map(r => r[index]); clues = this.cols[index].clues;
    }
    const matched = this.matchClues(cells, marks, clues, false);
    if (!matched[clueIdx]) return;
    const map = axis === "row" ? this.manualGrayRows : this.manualGrayCols;
    if (!map.has(index)) map.set(index, new Set());
    const set = map.get(index);
    if (set.has(clueIdx)) set.delete(clueIdx);
    else set.add(clueIdx);
    this.render();
  }

  handleClueClick(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    const cs = this.cellSize;
    const sides = this.getClueSides();
    const gap = cs * 0.7;

    const inRowZone = sides.row === "left"
      ? (x >= 0 && x < this.gridX)
      : (x >= this.gridX + this.gridW && x < this.logicalW);
    if (inRowZone && y >= this.gridY && y < this.gridY + this.gridH) {
      const r = Math.floor((y - this.gridY) / cs);
      if (r >= 0 && r < this.N) {
        const clues = this.rows[r].clues;
        for (let i = 0; i < clues.length; i++) {
          const k = clues.length - 1 - i;
          const cx = sides.row === "left"
            ? this.gridX - (k + 0.5) * gap - 4
            : this.gridX + this.gridW + (k + 0.5) * gap + 4;
          if (Math.abs(x - cx) < cs * 0.45) {
            this.toggleManualGray("row", r, i);
            return true;
          }
        }
      }
    }
    const inColZone = sides.col === "top"
      ? (y >= 0 && y < this.gridY)
      : (y >= this.gridY + this.gridH && y < this.logicalH);
    if (inColZone && x >= this.gridX && x < this.gridX + this.gridW) {
      const c = Math.floor((x - this.gridX) / cs);
      if (c >= 0 && c < this.M) {
        const clues = this.cols[c].clues;
        for (let i = 0; i < clues.length; i++) {
          const k = clues.length - 1 - i;
          const cy = sides.col === "top"
            ? this.gridY - (k + 0.5) * gap - 4
            : this.gridY + this.gridH + (k + 0.5) * gap + 4;
          if (Math.abs(y - cy) < cs * 0.45) {
            this.toggleManualGray("col", c, i);
            return true;
          }
        }
      }
    }
    return false;
  }

  computeTrail(start, end) {
    if (!start || !end) return [];
    const dr = end.r - start.r;
    const dc = end.c - start.c;
    if (dr === 0 && dc === 0) return [{ r: start.r, c: start.c }];
    const angle = Math.atan2(Math.abs(dr), Math.abs(dc));
    const isVertical = angle > Math.PI / 4;
    const trail = [];
    if (isVertical) {
      const step = Math.sign(dr);
      for (let r = start.r; step > 0 ? r <= end.r : r >= end.r; r += step) trail.push({ r, c: start.c });
    } else {
      const step = Math.sign(dc);
      for (let c = start.c; step > 0 ? c <= end.c : c >= end.c; c += step) trail.push({ r: start.r, c });
    }
    return trail;
  }

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
      const cell = getCell(e);
      if (!cell) {
        this.handleClueClick(e.clientX, e.clientY);
        return;
      }
      this.painting = true;
      this.dragStart = { ...cell };
      this.dragCurrent = { ...cell };
      this.dragMovedAway = false;
      this.dragAxis = null;
      this.highlightCell = { ...cell };
      const isRight = e.button === 2;
      if (isRight || this.tool === "mark") {
        this.paintValue = { type: "mark", value: !this.marks[cell.r][cell.c] };
      } else {
        const v = this.state[cell.r][cell.c] === this.currentColor ? 0 : this.currentColor;
        this.paintValue = { type: "state", value: v };
      }
      this.previewValue = this.paintValue;
      this.previewTrail = [{ ...cell }];
      this.render();
    });

    canvas.addEventListener("pointermove", e => {
      if (!this.painting) {
        if (e.pointerType === "mouse") {
          const cell = getCell(e);
          this.highlightCell = cell;
          this.render();
        }
        return;
      }
      if (this.won) return;
      const cell = getCell(e);
      if (!cell) return;
      this.highlightCell = { ...cell };
      if (cell.r !== this.dragStart.r || cell.c !== this.dragStart.c) this.dragMovedAway = true;
      this.dragCurrent = { ...cell };
      if (cell.r === this.dragStart.r) this.dragAxis = "h";
      else if (cell.c === this.dragStart.c) this.dragAxis = "v";
      else this.dragAxis = null;
      this.previewTrail = this.computeTrail(this.dragStart, cell);
      this.render();
    });

    const stop = () => {
      if (!this.painting) return;
      const trail = this.previewTrail || [];
      const pv = this.previewValue;
      this.painting = false;
      const cancel = this.settings.noPaintIfReturnToStart
        && this.dragMovedAway && trail.length === 1;
      if (!cancel && pv && trail.length > 0) {
        for (const cell of trail) {
          if (pv.type === "state") this.setCell(cell.r, cell.c, pv.value);
          else if (pv.type === "mark") this.setMark(cell.r, cell.c, pv.value);
        }
      }
      this.paintValue = null;
      this.previewTrail = null;
      this.previewValue = null;
      this.dragStart = null;
      this.dragCurrent = null;
      this.dragAxis = null;
      this.dragMovedAway = false;
      this.highlightCell = null;
      this.autoMarkSolvedLines();
      this.render();
    };
    canvas.addEventListener("pointerup", stop);
    canvas.addEventListener("pointercancel", stop);
    canvas.addEventListener("pointerleave", () => {
      if (!this.painting) { this.highlightCell = null; this.render(); }
    });
  }
}