// nonogram/format.js — Parser for the kafushy nonogram format (NONO v1)
//
// Gradient syntax (new):
//   #hex1 [ratio1] #hex2 [ratio2] ... angle
// Hex colors may omit the leading '#'. Ratio defaults to 1 per color.

function parseNonogram(text) {
  const lines = text.trim().split(/\r?\n/).map(l => l.trim()).filter(l => l);
  if (lines.length < 3) throw new Error("Needs at least 3 lines");

  const meta = lines[0].split(',').map(s => s.trim());
  const [author, title, date, version] = meta;
  if (!author) throw new Error("Line 1: author missing");

  const slashIdx = lines[1].indexOf('/');
  if (slashIdx < 0) throw new Error("Line 2: missing '/' between bg and fg");
  const bg = parseGradient(lines[1].slice(0, slashIdx).trim());
  const fg = parseGradient(lines[1].slice(slashIdx + 1).trim());

  const composition = parseComposition(lines[2]);
  const options = lines[3] ? parseOptions(lines[3]) : {};

  if (composition.maxColor > fg.palette.length)
    throw new Error(`Color ${composition.maxColor} used but fg palette has ${fg.palette.length}`);
  if (composition.maxColor > 1 && fg.palette.length === 1)
    throw new Error(`Multi-color clues but fg palette has only 1 color`);

  return {
    author, title, date, version,
    bg, fg,
    sections: composition.sections,
    maxColor: composition.maxColor,
    multiColor: composition.maxColor > 1,
    strict: options.hash != null,
    options,
  };
}

// --- color detection ---
function isHexColor(tok) {
  if (/^#[0-9a-fA-F]{3}$/.test(tok)) return true;
  if (/^#[0-9a-fA-F]{6}$/.test(tok)) return true;
  if (/^[0-9a-fA-F]{6}$/.test(tok)) return true;
  return false;
}
function normalizeHex(tok) {
  let h = tok.startsWith('#') ? tok.slice(1) : tok;
  if (h.length === 3) h = h.split('').map(c => c + c).join('');
  return '#' + h.toLowerCase();
}

// --- gradient parsing ---
// Syntax: #hex [ratio] #hex [ratio] ... angle
function parseGradient(s) {
  const tokens = s.split(/\s+/).filter(t => t);
  if (tokens.length < 2) throw new Error("Gradient: too few tokens");

  // Last token is angle (must be a number)
  const angleTok = tokens[tokens.length - 1];
  const angle = parseFloat(angleTok);
  if (isNaN(angle) || isHexColor(angleTok))
    throw new Error("Gradient: last token must be an angle (number)");

  const palette = [];
  const ratios = [];
  for (let i = 0; i < tokens.length - 1; i++) {
    const tok = tokens[i];
    if (isHexColor(tok)) {
      palette.push(normalizeHex(tok));
      ratios.push(1); // default
    } else {
      const n = parseFloat(tok);
      if (isNaN(n)) throw new Error(`Gradient: bad token "${tok}"`);
      if (palette.length === 0) throw new Error("Gradient: ratio before first color");
      ratios[palette.length - 1] = n;
    }
  }
  if (palette.length === 0) throw new Error("Gradient: no palette colors");

  return { palette, angle, ratios, weights: normalizeRatios(ratios, palette.length) };
}

function normalizeRatios(ratios, count) {
  const r = [...ratios];
  while (r.length < count) r.push(1);
  const anyAbove1 = r.some(v => v > 1);
  const anyBelow1 = r.some(v => v < 1);
  if (anyAbove1 && anyBelow1) return Array(count).fill(1 / count);
  const sum = r.reduce((a, b) => a + b, 0);
  if (sum === 0) return Array(count).fill(1 / count);
  return r.map(v => v / sum);
}

// --- composition ---
function parseComposition(spec) {
  if (!spec.startsWith('/')) throw new Error("Line 3: must start with '/'");
  const parts = spec.split('/').slice(1);
  if (parts.some(p => p === '')) throw new Error("Line 3: empty section");
  let maxColor = 1;
  const sections = parts.map(section =>
    section.split('.').map(pos => {
      const p = parsePosition(pos.trim());
      p.clues.forEach(c => { if (c.color > maxColor) maxColor = c.color; });
      return p;
    })
  );
  return { sections, maxColor };
}

function parsePosition(s) {
  let coord = null, cluesPart = s;
  const m = s.match(/^\((\d+),(\d+)\)\/(.+)$/);
  if (m) { coord = { x: parseInt(m[1]), y: parseInt(m[2]) }; cluesPart = m[3]; }
  if (!cluesPart.trim()) throw new Error("Position: no clues");
  return { coord, clues: parseClues(cluesPart) };
}

function parseClues(s) {
  const tokens = s.trim().split(/\s+/);
  const clues = [];
  let currentColor = 1;
  for (const t of tokens) {
    if (/^\d+$/.test(t)) {
      clues.push({ color: currentColor, value: parseInt(t) });
    } else if (/^(\d+),(\d+)$/.test(t)) {
      const [, c, v] = t.match(/^(\d+),(\d+)$/);
      currentColor = parseInt(c);
      clues.push({ color: currentColor, value: parseInt(v) });
    } else {
      throw new Error(`Bad clue token: "${t}"`);
    }
  }
  return clues;
}

function parseOptions(s) {
  const opts = {};
  const re = /(\w+)(?:=("[^"]*"|\S+))?/g;
  let m;
  while ((m = re.exec(s))) opts[m[1]] = m[2] ? m[2].replace(/^"|"$/g, '') : true;
  return opts;
}