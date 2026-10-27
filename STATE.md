```markdown
# STATE.md — nonogram hub

Canonical reference for the current state of the nonogram app.
Update this whenever a fix lands or architecture changes.
When I (assistant) write code, I re-derive from this file, not from chat memory.

---

## Repo structure

```

kafushy.github.io/
├── index.html              # hub landing page (Friv-style card grid)
├── nonogram/
│   ├── index.html          # game page shell
│   ├── style.css           # all styles for the game page
│   ├── format.js           # nonogram text-format parser (DO NOT TOUCH)
│   ├── game.js             # NonogramGame class (grid, render, state)
│   └── app.js              # shell: header, options, tool button, gamepad, persistence
├── pbbg/index.html         # stub "coming soon"
├── comic/index.html        # stub
├── music/index.html        # stub
└── blog/index.html         # stub

```

All nonogram files reference each other with `?v=N` query strings.
Current version: **v13**.

---

## File responsibilities

**`format.js`** — parses the nonogram text format into a puzzle object.
Has been stable since early on. **Never modify without explicit reason.**

**`game.js`** — `NonogramGame` class. Owns:
- Grid state (`state[r][c]` fill color index, `marks[r][c]` boolean)
- Rendering (canvas: background, cells, preview, highlight, grid lines, clues, cursor, solved shimmer, drag counter)
- Win detection
- Clue satisfaction logic (`matchClues`, `lineSolved`)
- Auto-mark + auto-gray behavior
- Drag preview (commit-on-release)
- Pointer events on canvas
- Resize handling

**`app.js`** — the shell. Owns:
- Loading/saving settings + puzzle + game state to localStorage
- Header, options panel, tabs
- Tool button gesture (tap / hold / drag-to-enable-gamepad)
- Gamepad gesture wiring
- Page background color application
- Version-mismatch upgrade of default puzzle

**`style.css`** — all styles. CSS vars for themeable colors.

---

## Current default puzzle

Bumped via `PUZZLE_VERSION` in `app.js`. When `nono_puzzleVersion` in localStorage
is lower than `PUZZLE_VERSION` AND the stored puzzle is the "default heart" shape
(detected by `isDefaultHeartPuzzle()`), it auto-upgrades.

`PUZZLE_VERSION = 5`

```

kafushy, Heart, 2026-10-26, v1
#0a0f23 1 #1e3a8a 1 90 / #ef4444 1 #991b1b 1 90
/1 1.5.5.3.1/2.4.4.4.2

```

- bg: dark navy → medium blue, gradient angle 90 (bottom to top)
- fg: red → dark red, gradient angle 90 (bottom to top)
- 5×5 heart pattern

---

## Settings schema (DEFAULT_SETTINGS in app.js)

```js
{
  autoMark: false,               // auto-place marks on solved lines
  cleanupAutoMarks: true,        // remove auto-marks when line stops being solved
  autoGray: true,                // gray satisfied clues
  surroundedOnly: false,         // only gray when run is bounded both sides
  marksBlockFill: true,          // marks block fills AND fills block marks
  tileBorders: true,             // per-tile 1px border
  gridLineEvery: 5,              // bold grid line every N cells (0 = off)
  dragCounterThreshold: 0,       // show drag counter after N cells (0 = off)
  noPaintIfReturnToStart: false, // returning to start cancels drag
  markSymbol: "×",               // × • / - + ● ○
  pageBgColor: "#0f172a",        // CSS --bg
  highlight: true,               // beam highlight row + col
  cluePos: "top-left",           // top-left | top-right | bottom-left | bottom-right
  gamepadScale: 1,               // 0.6–1.6
  gamepadPosition: "bottom-left",// bottom-left | bottom-right | top-left | top-right
  gamepadColor: "#1e293b",
  cursorColorAuto: true,         // invert fill color for cursor
  cursorColorValue: "#fbbf24",   // used only when cursorColorAuto is false
  cursorWrap: false,             // cursor wraps at grid edges
}
```

---

Nonogram text format

```
Line 1: author, title, date, version
Line 2: <bg palette + ratios + angle> / <fg palette + ratios + angle>
Line 3: /<row clues>.<row clues>./.../<col clues>.<col clues>./...
Line 4 (optional): key=value key=value ...  (e.g. hash=sha256:...)
```

Gradient syntax: #hex [ratio] #hex [ratio] ... angle

· Hex may omit # (6 hex chars accepted)
· Ratio defaults to 1, sits immediately after its color
· Angle in degrees, 0 = right, 90 = up
· Ratio >1 = weight; all <1 = percentage; mixed = equal weights

Composition:

· Leading / then sections separated by /
· 2 sections = rectangle (rows + columns)
· 2 sections = polygon (NOT IMPLEMENTED — parser accepts, renderer rejects)
· Within a section, . separates positions (cells)
· Clue tokens: color,value or bare value
· Bare value after first token inherits previous color
· Position may have (x,y)/ coordinate prefix (NOT IMPLEMENTED in renderer)
· 0 as sole clue means "line must be empty"

Options (line 4): hash=sha256:<hex> enforces strict win (grid must match hash).

Multi-color rules:

· maxColor > 1 AND fg palette has >1 colors = functional multi-color
· maxColor == 1 AND fg palette has >1 colors = fg gradient is purely visual, cells all use color 1
· maxColor > 1 but fg palette has only 1 color = error

---

Architecture decisions (locked in)

1. One-page game. No iframe, no separate routes.
2. Tapbox at bottom-center. Empty = fill mode, shows mark symbol = mark mode.
3. Tapbox gestures:
   · Tap → toggle fill/mark
   · Hold 1s without moving → reset puzzle
   · Drag >10px → hide tapbox, show gamepad
4. Gamepad → grid tap disables gamepad (and doesn't paint that cell).
5. Highlight = 4 lines on sides of target tile (not center crosshair). Color matches cursor color. Clue backgrounds for that row/col get a 0.14 alpha tint.
6. Highlight target during drag = last cell of previewTrail (post-snap), not raw finger cell.
7. Auto-mark tracks which marks it placed (autoMarkedCells Set). If cleanupAutoMarks is on, orphaned auto-marks are removed when their line stops being solved. Manual unmarks go into suppressedMarks so auto-mark won't re-mark them.
8. Drag = preview trail, committed on pointerup. Orthogonal-snapped at 45°.
9. Win = all clues satisfied. If hash=sha256:... present in options, also requires grid hash match. Solved state = pulsing golden border on grid rect (not canvas outline, not text).
10. Grid is centered in the canvas. Padding is symmetric on all 4 sides (padRow/padCol each used twice).
11. localStorage keys:
    · nono_settings — JSON settings object
    · nono_puzzleText — current puzzle text
    · nono_puzzleVersion — for default-puzzle upgrade detection
    · nono_state — { puzzleText, state, marks } — cleared when puzzle changes

---

Prior fixes ledger

Every one of these is a deliberate fix. Any full-file rewrite MUST preserve all of them.

Format / parser:

☑ Hex colors accepted with or without #
☑ Ratio sits next to its color, not at end
☑ Angle is always the last token on a gradient
☑ 0 clue = "line must be empty", handled in matchClues and lineSolved
☑ Mixed ratio (>1 and <1 in same gradient) → equal weights

Rendering:

☑ Background gradient confined to grid rect (clue areas transparent, page bg shows through)
☑ Gradient angle: 0 = right, 90 = up
☑ DPR rounded to integer (Math.round(devicePixelRatio)) — fixes mobile canvas glitch + vertical seams
☑ Math.floor/Math.ceil on every cell fillRect — fixes subpixel seams
☑ Grid centered (symmetric padRow/padCol)
☑ Clues not clipped when >1 clue (padRow sized for maxRowClues * 0.7 + 0.5 cells + margin)
☑ Foreground gradient works when palette has >1 colors but composition is monocolor
☑ Clues always draw, even when autoGray is off (early-return bug fixed)
☑ 0 clue grayed when line empty regardless of autoGray setting

Interaction:

☑ Drag = preview + commit on release (not paint-as-you-go)
☑ Orthogonal snapping at 45° in computeTrail
☑ noPaintIfReturnToStart cancels drag if dragMovedAway && trail.length === 1
☑ Clue click toggles manual gray, only when clue is currently satisfied
☑ Manual grays cleared on cell change in that row/col
☑ Marks block fills reciprocally (setMark checks state, setCell checks marks, both gated by marksBlockFill)
☑ suppressedMarks — manual unmarks aren't re-marked by auto-mark
☑ autoMarkedCells — tracked so cleanupAutoMarks can remove them
☑ Gamepad cursor color inverts filled cell color (or uses fixed color if cursorColorAuto off)
☑ Highlight uses colorForCell() = same logic as cursor
☑ Highlight target = previewTrail[last] during drag, gamepadDragCell during gamepad drag, cursor when gamepad on, highlightCell otherwise

UI:

☑ Active tab click closes the options panel
☑ row-surroundedOnly hidden when autoGray off
☑ row-cleanupAutoMarks hidden when autoMark off
☑ Fill-mode tapbox shows fg palette[0] as solid background; mark-mode shows mark symbol
☑ Hold-tapbox = red (.held = brightness 1.3, not color change — simpler)
☑ Reset flash on tapbox after hold-triggered reset
☑ Default puzzle auto-upgrades via PUZZLE_VERSION

Persistence:

☑ ResizeObserver on grid wrapper (not innerWidth check) — survives mobile app-switch
☑ game._gamepadDragging flag prevents canvas pointerdown from disabling gamepad mid-drag

---

Known open issues

1. Gamepad drag doesn't work on Waterfox mobile.

· Four attempts made. Current approach (v13): touchstart/touchmove/touchend on the button + document-level touchmove/touchend as primary listener. Ghost dot shows during drag as diagnostic.
· If it still doesn't work: cursor + tap (D-pad + Fill/Mark button) is the primary, working gamepad interaction. Drag is a bonus feature. Don't over-invest further without new information.

2. Not implemented from format spec:

· Polygonal compositions (>2 sections) — parser accepts, renderer throws
· (x,y)/ coordinate positions — parser accepts, renderer ignores the coordinate
· Multi-color puzzle rendering is implemented but untested in practice

3. No "Make" tab UI yet. Stub only.

4. No "Journey" or "Puzzle" mode yet. Stub only.

---

Version log

v Change
13 Document-level touch events for gamepad drag; ghost dot diagnostic; _gamepadDragging flag; symmetric-pad resize math fixing clue cutoff; heart puzzle v5 (dark bg + red fg gradient)
12 4-line highlight (sides, not crosshair); clue bg tint; highlight uses cursor color; highlight follows previewTrail end; auto-mark cleanup; cleanupAutoMarks setting
11 Beam highlight (crosshair); grid centering; clue position setting; gamepad drag reattempt; solve shimmer on grid border; DPR rounding
10 Preview + commit-on-release drag; orthogonal snapping; noPaintIfReturnToStart; tab toggle; suppressedMarks; clue click toggle manual gray
9 Modular refactor (index/style/game/app split); tapbox gestures; gamepad; options panel
8 (pre-refactor, single index.html with inline everything)

```