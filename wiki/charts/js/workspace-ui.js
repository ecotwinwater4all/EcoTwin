// ---------------------------------------------------------------------------
// Legend — optional (toolbar checkbox), movable (drag), resizable (drag the
// right edge — content re-wraps to fit), and editable: label text (double-
// click to rename) and colour (click a swatch → discrete picker) can be
// changed, items can be removed (hover a row for ×), and a new item can be
// added via the toolbar + button next to the checkbox (kept OUT of the
// legend's own flex row deliberately, so an "add" control never inflates the
// legend's measured width/drag-box — see chart.md). Colour choices are
// deliberately NOT a free colour wheel — legendColorChoices() draws only from
// NODE_COLOR_PALETTE (box colours) + ARROW_COLORS (arrow colours), i.e. only
// colours that actually appear elsewhere in the diagram. Item list itself
// (which entries exist, their labels) is free-form in legendState.items.
// State persists to localStorage and bakes into DEFAULT_LEGEND via saveAll().
// Position/width are stored as fractions of / relative to the canvas-stage
// (the actual drawing box, same rect the export uses) so the legend always
// stays inside the canvas and on-screen position matches export; they also
// survive window resizes. null fx/fy = default anchor (bottom-center).
// ---------------------------------------------------------------------------
var LEGEND_KEY = 'lake_iseo_chart_legend_v2';
var LEGEND_DEFAULT_ITEMS = [
  { bg: '#ddeaf7', border: '#aac8ea', label: 'Data layer'    },
  { bg: '#fef0e0', border: '#f5c08a', label: 'Model layer'   },
  { bg: '#e8f5d8', border: '#b0d888', label: 'Water quality' },
  { bg: '#fce8f0', border: '#f4b8d1', label: 'User layer'    }
];
var legendState = { visible: true, fx: null, fy: null, w: null, items: null };
var legendDrag = null;
var legendResizeDrag = null;
var legendColorPickerFor = null;

function shadeColor(hex, percent) {
  hex = (hex || '#cccccc').replace('#', '');
  if (hex.length === 3) hex = hex.split('').map(function(c) { return c + c; }).join('');
  var num = parseInt(hex, 16) || 0xcccccc;
  var r = (num >> 16) & 0xFF, g = (num >> 8) & 0xFF, b = num & 0xFF;
  var t = percent < 0 ? 0 : 255, p = Math.abs(percent);
  r = Math.round((t - r) * p) + r;
  g = Math.round((t - g) * p) + g;
  b = Math.round((t - b) * p) + b;
  return '#' + (0x1000000 + r * 0x10000 + g * 0x100 + b).toString(16).slice(1);
}

// The discrete set of colours the legend swatch picker offers — exactly the
// colours already used for box styling (NODE_COLOR_PALETTE) and arrow
// styling (ARROW_COLORS), deduped by hex. No arbitrary/continuous colours.
function legendColorChoices() {
  var seen = {}, out = [];
  NODE_COLOR_PALETTE.forEach(function(c) {
    if (seen[c.bg]) return;
    seen[c.bg] = true;
    out.push({ bg: c.bg, border: c.border, name: c.label });
  });
  ARROW_COLORS.forEach(function(c) {
    if (seen[c.hex]) return;
    seen[c.hex] = true;
    out.push({ bg: c.hex, border: shadeColor(c.hex, -0.3), name: c.name });
  });
  return out;
}

function loadLegendState() {
  legendState = { visible: true, fx: null, fy: null, w: null, items: JSON.parse(JSON.stringify(LEGEND_DEFAULT_ITEMS)) };
  applyLegendDefaults(DEFAULT_LEGEND);
  try {
    var s = JSON.parse(lsGet(LEGEND_KEY) || 'null');
    if (s) applyLegendDefaults(s);
  } catch(e) {}
}
function applyLegendDefaults(s) {
  if (s.visible != null) legendState.visible = s.visible;
  if (s.fx !== undefined) legendState.fx = s.fx;
  if (s.fy !== undefined) legendState.fy = s.fy;
  if (s.w !== undefined) legendState.w = s.w;
  if (Array.isArray(s.items) && s.items.length) {
    legendState.items = s.items;
  } else if (Array.isArray(s.labels)) {
    // migrate legacy label-only overrides onto the default items
    legendState.items = legendState.items.map(function(it, i) {
      return s.labels[i] != null ? Object.assign({}, it, { label: s.labels[i] }) : it;
    });
  }
}
function saveLegendState() {
  try { lsSet(LEGEND_KEY, JSON.stringify(legendState)); } catch(e) {}
}
function buildLegend() {
  var leg = document.getElementById('canvas-legend');
  if (!leg) return;
  leg.innerHTML = '';
  legendState.items.forEach(function(it, i) {
    var item = document.createElement('div');
    item.className = 'legend-item';
    item.style.cssText = 'display:flex;align-items:center;gap:6px;position:relative;';

    var sw = document.createElement('div');
    sw.className = 'legend-swatch';
    sw.title = 'Click to change colour';
    sw.style.cssText = 'width:13px;height:13px;border-radius:2px;flex-shrink:0;cursor:pointer;background:' + it.bg +
      ';border:1.5px solid ' + it.border + ';';
    sw.addEventListener('click', function(e) {
      e.stopPropagation();
      var r = sw.getBoundingClientRect();
      openLegendColorPicker(i, r.left, r.bottom + 4);
    });

    var txt = document.createElement('span');
    txt.className = 'legend-label';
    txt.dataset.idx = i;
    txt.style.cursor = 'text';
    txt.textContent = it.label;
    txt.addEventListener('blur', function() { commitLegendLabel(txt); });
    txt.addEventListener('keydown', function(e) {
      if (e.key === 'Enter')  { e.preventDefault(); txt.blur(); }
      if (e.key === 'Escape') { e.preventDefault(); txt.textContent = legendState.items[i].label; txt.blur(); }
    });

    var rm = document.createElement('span');
    rm.className = 'legend-remove';
    rm.title = 'Remove this legend item';
    rm.textContent = '×';
    rm.style.cssText = 'display:none;cursor:pointer;color:#bbb;font-size:14px;line-height:1;';
    rm.addEventListener('click', function(e) { e.stopPropagation(); removeLegendItem(i); });
    item.addEventListener('mouseenter', function() { rm.style.display = 'inline'; });
    item.addEventListener('mouseleave', function() { rm.style.display = 'none'; });

    item.appendChild(sw);
    item.appendChild(txt);
    item.appendChild(rm);
    leg.appendChild(item);
  });

  var handle = document.createElement('div');
  handle.className = 'legend-resize-handle';
  handle.title = 'Drag to resize';
  handle.addEventListener('mousedown', onLegendResizeMouseDown);
  leg.appendChild(handle);

  leg.style.maxWidth = 'none';
  leg.style.width = legendState.w ? (legendState.w + 'px') : '';

  applyLegendVisibility();
  applyLegendPosition();
}
function setLegendItemColor(i, bg, border) {
  var it = legendState.items[i];
  it.bg = bg;
  it.border = border || shadeColor(bg, -0.3);
  var leg = document.getElementById('canvas-legend');
  var sw = leg && leg.querySelectorAll('.legend-swatch')[i];
  if (sw) { sw.style.background = it.bg; sw.style.borderColor = it.border; }
  saveLegendState();
}
function openLegendColorPicker(i, x, y) {
  closeLegendColorPicker();
  legendColorPickerFor = i;
  var pop = document.createElement('div');
  pop.id = 'legend-color-picker';
  pop.style.cssText = 'position:fixed;left:' + x + 'px;top:' + y + 'px;z-index:9999;' +
    'display:flex;flex-wrap:wrap;gap:6px;max-width:170px;padding:8px;' +
    'background:#fff;border:1px solid #dedad4;border-radius:6px;box-shadow:0 6px 24px rgba(0,0,0,0.15);';
  legendColorChoices().forEach(function(c) {
    var sw = document.createElement('div');
    sw.title = c.name;
    sw.style.cssText = 'width:18px;height:18px;border-radius:50%;cursor:pointer;flex-shrink:0;' +
      'background:' + c.bg + ';border:2px solid ' + c.border + ';';
    sw.addEventListener('click', function(e) {
      e.stopPropagation();
      setLegendItemColor(legendColorPickerFor, c.bg, c.border);
      closeLegendColorPicker();
    });
    pop.appendChild(sw);
  });
  document.body.appendChild(pop);
}
function closeLegendColorPicker() {
  var pop = document.getElementById('legend-color-picker');
  if (pop) pop.remove();
  legendColorPickerFor = null;
}
function addLegendItem() {
  legendState.items.push({ bg: '#e8e8e8', border: '#cacaca', label: 'New item' });
  legendState.visible = true; // so the new item is actually visible immediately
  saveLegendState();
  buildLegend();
}
function removeLegendItem(i) {
  legendState.items.splice(i, 1);
  saveLegendState();
  buildLegend();
}
function applyLegendVisibility() {
  var leg = document.getElementById('canvas-legend');
  if (leg) leg.style.display = legendState.visible ? 'flex' : 'none';
  var cb = document.getElementById('legend-toggle');
  if (cb) cb.checked = legendState.visible;
}
function applyLegendPosition() {
  var leg = document.getElementById('canvas-legend');
  var stage = document.getElementById('canvas-stage');
  if (!leg || !stage) return;
  if (legendState.fx == null || legendState.fy == null) {
    leg.style.left = '50%';
    leg.style.right = 'auto';
    leg.style.bottom = (CANVAS_MARGIN * (canvasScale || 1)) + 'px';
    leg.style.top = 'auto';
    leg.style.transform = 'translateX(-50%)';
    return;
  }
  var cv = document.getElementById('canvas');
  var cr = cv ? cv.getBoundingClientRect() : stage.getBoundingClientRect();
  leg.style.transform = 'none';
  leg.style.right = 'auto';
  leg.style.bottom = 'auto';
  // Fractions are re-applied against whatever the chart area now measures, so
  // a resize can carry the legend into the keep-clear band — clamp it back.
  var m = CANVAS_MARGIN * (canvasScale || 1);
  var lx = legendState.fx * cr.width;
  var ly = legendState.fy * cr.height;
  leg.style.left = Math.max(m, Math.min(lx, Math.max(m, cr.width  - leg.offsetWidth  - m))) + 'px';
  leg.style.top  = Math.max(m, Math.min(ly, Math.max(m, cr.height - leg.offsetHeight - m))) + 'px';
}
function onLegendMouseDown(e) {
  if (e.button !== 0) return;
  // let clicks on a label/swatch/remove/resize-handle place the caret or
  // fire their own handler rather than starting a drag (the add-item control
  // now lives in the toolbar, not inside the legend row, so it never needs an
  // exclusion here — see chart.md "Legend" section)
  var t = e.target;
  if (t.classList && (t.classList.contains('legend-label') ||
      t.classList.contains('legend-remove') ||
      t.classList.contains('legend-swatch') ||
      t.classList.contains('legend-resize-handle'))) return;
  var leg = document.getElementById('canvas-legend');
  var cv  = document.getElementById('canvas');
  if (!leg || !cv) return;
  var legRect = leg.getBoundingClientRect();
  var canvasRect = cv.getBoundingClientRect();
  legendDrag = { offX: e.clientX - legRect.left, offY: e.clientY - legRect.top, sr: canvasRect };
  leg.style.transform = 'none';
  leg.style.right = 'auto';
  leg.style.bottom = 'auto';
  leg.style.left = (legRect.left - canvasRect.left) + 'px';
  leg.style.top  = (legRect.top - canvasRect.top) + 'px';
  e.preventDefault();
}
function onLegendMouseMove(e) {
  if (!legendDrag) return;
  var leg = document.getElementById('canvas-legend');
  var sr = legendDrag.sr;
  var left = e.clientX - sr.left - legendDrag.offX;
  var top  = e.clientY - sr.top  - legendDrag.offY;
  // Confined to the same keep-clear margin as the rest of the content — the
  // legend sits in the canvas's coordinate space, so the margin is scaled.
  var m = CANVAS_MARGIN * (canvasScale || 1);
  left = Math.max(m, Math.min(left, Math.max(m, sr.width  - leg.offsetWidth  - m)));
  top  = Math.max(m, Math.min(top,  Math.max(m, sr.height - leg.offsetHeight - m)));
  leg.style.left = left + 'px';
  leg.style.top  = top + 'px';
  setMarginGuide(true);
}
function onLegendMouseUp() {
  if (!legendDrag) return;
  var leg = document.getElementById('canvas-legend');
  var sr = legendDrag.sr;
  legendState.fx = (parseFloat(leg.style.left) || 0) / sr.width;
  legendState.fy = (parseFloat(leg.style.top)  || 0) / sr.height;
  saveLegendState();
  legendDrag = null;
}
function onLegendResizeMouseDown(e) {
  e.stopPropagation();
  e.preventDefault();
  var leg = document.getElementById('canvas-legend');
  legendResizeDrag = { startX: e.clientX, startW: leg.getBoundingClientRect().width };
}
function onLegendResizeMouseMove(e) {
  if (!legendResizeDrag) return;
  var leg = document.getElementById('canvas-legend');
  var w = Math.max(140, legendResizeDrag.startW + (e.clientX - legendResizeDrag.startX));
  leg.style.maxWidth = 'none';
  leg.style.width = w + 'px';
}
function onLegendResizeMouseUp() {
  if (!legendResizeDrag) return;
  var leg = document.getElementById('canvas-legend');
  legendState.w = Math.round(parseFloat(leg.style.width)) || null;
  saveLegendState();
  legendResizeDrag = null;
}
function onLegendDblClick(e) {
  var t = e.target;
  if (!t.classList || !t.classList.contains('legend-label')) return;
  e.stopPropagation();
  t.contentEditable = 'true';
  t.style.outline = '1px solid #b8cfe8';
  t.style.borderRadius = '2px';
  t.style.padding = '0 2px';
  t.focus();
  var range = document.createRange();
  range.selectNodeContents(t);
  var sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
}
function commitLegendLabel(t) {
  if (t.contentEditable !== 'true') return;
  t.contentEditable = 'false';
  t.style.outline = 'none';
  t.style.padding = '';
  var idx = parseInt(t.dataset.idx);
  var val = (t.textContent || '').trim();
  legendState.items[idx].label = val || legendState.items[idx].label || 'Item';
  t.textContent = legendState.items[idx].label;
  saveLegendState();
}
// ---------------------------------------------------------------------------
// Split handle — drag to resize the canvas-wrap vs. the side info panel.
// Persists the side panel's pixel width; canvas-wrap is flex:1 so it always
// takes whatever width remains. fitCanvas()/applyLegendPosition() re-run on
// every drag frame so the diagram scale and legend position track live.
// ---------------------------------------------------------------------------
var SPLIT_KEY = 'lake_iseo_chart_split_v2';
var SPLIT_MIN = 200, SPLIT_MAX = 640;
var splitState = JSON.parse(JSON.stringify(DEFAULT_SPLIT_STATE));
var splitDrag = null;
function loadSplitState() {
  try {
    var raw = lsGet(SPLIT_KEY);
    if (raw) splitState.w = JSON.parse(raw).w || null;
  } catch(e) {}
}
function saveSplitState() {
  try { lsSet(SPLIT_KEY, JSON.stringify(splitState)); } catch(e) {}
}
function applySplitState() {
  var side = document.getElementById('side');
  if (!side) return;
  if (splitState.w) side.style.width = splitState.w + 'px';
  fitCanvas();
  applyLegendPosition();
}
function onSplitMouseDown(e) {
  if (e.button !== 0) return;
  var side = document.getElementById('side');
  var handle = document.getElementById('split-handle');
  if (!side) return;
  splitDrag = { startX: e.clientX, startW: side.getBoundingClientRect().width };
  if (handle) handle.classList.add('dragging');
  e.preventDefault();
}
function onSplitMouseMove(e) {
  if (!splitDrag) return;
  var side = document.getElementById('side');
  if (!side) return;
  var w = Math.max(SPLIT_MIN, Math.min(SPLIT_MAX, splitDrag.startW - (e.clientX - splitDrag.startX)));
  side.style.width = w + 'px';
  fitCanvas();
  clearSVG();
  drawArrows();
  applyLegendPosition();
}
function onSplitMouseUp() {
  if (!splitDrag) return;
  var side = document.getElementById('side');
  var handle = document.getElementById('split-handle');
  if (handle) handle.classList.remove('dragging');
  splitState.w = Math.round(parseFloat(side.style.width)) || null;
  saveSplitState();
  splitDrag = null;
}
function wireSplit() {
  var handle = document.getElementById('split-handle');
  if (handle) handle.addEventListener('mousedown', onSplitMouseDown);
  document.addEventListener('mousemove', onSplitMouseMove);
  document.addEventListener('mouseup', onSplitMouseUp);
  loadSplitState();
  applySplitState();
}
// ---------------------------------------------------------------------------
// Stage resize handle — drag to grow/shrink the logical drawing area
// (CANVAS_W/CANVAS_H) itself, e.g. to make room for new boxes, WITHOUT
// scaling existing content. The zoom level (canvasScale) is frozen at
// whatever it was when the drag starts (manualSizeScale) so nothing already
// on the canvas changes size or position — the extra room just appears as
// blank canvas past the existing content, reachable via canvas-wrap's
// overflow:auto scrollbars if it doesn't fit the window.
// ---------------------------------------------------------------------------
var STAGE_SIZE_KEY = 'lake_iseo_chart_stagesize_v2';
var STAGE_SIZE_MIN = 300;
var stageResizeDrag = null;
function loadStageSize() {
  try {
    var raw = lsGet(STAGE_SIZE_KEY);
    if (!raw) return;
    var d = JSON.parse(raw);
    if (d && d.w && d.h) {
      CANVAS_W = d.w;
      CANVAS_H = d.h;
      manualSizeActive = d.manual == null ? true : !!d.manual;
      manualSizeScale = d.scale || 1;
    }
  } catch(e) {}
}
function saveStageSize() {
  try {
    lsSet(STAGE_SIZE_KEY, JSON.stringify({
      w: CANVAS_W,
      h: CANVAS_H,
      manual: manualSizeActive,
      scale: manualSizeScale
    }));
  } catch(e) {}
}
function onStageResizeMouseDown(e) {
  if (e.button !== 0) return;
  var handle = e.currentTarget;
  if (!manualSizeActive) {
    manualSizeActive = true;
    manualSizeScale = canvasScale;
    // Apply the switch from centred to top-left-pinned here, before the drag
    // starts, so the one-time reposition happens on grab rather than as a jump
    // in the middle of the first drag frame.
    fitCanvas();
  }
  var origPositions = {};
  NODE_IDS.forEach(function(id) {
    var el = document.getElementById('N-' + id);
    if (el) origPositions[id] = { x: parseInt(el.style.left) || 0, y: parseInt(el.style.top) || 0 };
  });
  var origWaypoints = arrows.map(function(a) { return a.waypoints.map(function(p) { return p.slice(); }); });
  var origLabels = {};
  Object.keys(labelPositions).forEach(function(k) { origLabels[k] = Object.assign({}, labelPositions[k]); });
  var wrap = document.querySelector('.canvas-wrap');
  stageResizeDrag = {
    dir: handle.getAttribute('data-dir') || 'se',
    startX: e.clientX, startY: e.clientY,
    startW: CANVAS_W, startH: CANVAS_H,
    content: contentBounds(),
    startScrollLeft: wrap ? wrap.scrollLeft : 0,
    startScrollTop:  wrap ? wrap.scrollTop  : 0,
    // Snapshotted here, committed on mouseup only if the size actually changed.
    // captureState() carries CANVAS_W/H alongside the node positions, so one
    // entry reverses both the size change and the content shift a west/north
    // drag applies with it.
    undoState: captureState(),
    origPositions: origPositions, origWaypoints: origWaypoints, origLabels: origLabels
  };
  handle.classList.add('dragging');
  var stage = document.getElementById('canvas-stage');
  if (stage) stage.classList.add('resizing');
  setMarginGuide(true);
  e.preventDefault();
  e.stopPropagation();
}

// Smallest width/height this drag may shrink to without pushing content past
// the margin. The east/south edges move against fixed content, so the floor is
// the content's far side plus the margin; the west/north edges carry the
// content with them, so the floor is the whole start size less whatever empty
// gap sits on that side. Never above the size the drag started at, so a layout
// that already overflows is merely held where it is, not forced to grow.
function stageShrinkFloor(d, axis) {
  var start = axis === 'x' ? d.startW : d.startH;
  var c = d.content;
  if (!c) return STAGE_SIZE_MIN;
  var near = axis === 'x' ? c.l : c.t;
  var far  = axis === 'x' ? c.r : c.b;
  var dir  = d.dir;
  var floor = STAGE_SIZE_MIN;
  if (dir.indexOf(axis === 'x' ? 'e' : 's') >= 0) floor = Math.max(floor, far + CANVAS_MARGIN);
  if (dir.indexOf(axis === 'x' ? 'w' : 'n') >= 0) floor = Math.max(floor, start - near + CANVAS_MARGIN);
  return Math.max(STAGE_SIZE_MIN, Math.min(start, floor));
}
function onStageResizeMouseMove(e) {
  if (!stageResizeDrag) return;
  var d = stageResizeDrag;
  var dx = (e.clientX - d.startX) / manualSizeScale;
  var dy = (e.clientY - d.startY) / manualSizeScale;
  var shiftX = 0, shiftY = 0;
  var floorW = stageShrinkFloor(d, 'x'), floorH = stageShrinkFloor(d, 'y');
  if (d.dir.indexOf('e') >= 0) CANVAS_W = Math.max(floorW, Math.round(d.startW + dx));
  if (d.dir.indexOf('w') >= 0) {
    var newW = Math.max(floorW, Math.round(d.startW - dx));
    shiftX = newW - d.startW;
    CANVAS_W = newW;
  }
  if (d.dir.indexOf('s') >= 0) CANVAS_H = Math.max(floorH, Math.round(d.startH + dy));
  if (d.dir.indexOf('n') >= 0) {
    var newH = Math.max(floorH, Math.round(d.startH - dy));
    shiftY = newH - d.startH;
    CANVAS_H = newH;
  }
  if (shiftX || shiftY) {
    NODE_IDS.forEach(function(id) {
      var el = document.getElementById('N-' + id);
      var op = d.origPositions[id];
      if (el && op) { el.style.left = (op.x + shiftX) + 'px'; el.style.top = (op.y + shiftY) + 'px'; }
    });
    arrows.forEach(function(a, i) {
      var ow = d.origWaypoints[i];
      if (ow) a.waypoints = ow.map(function(p) { return [p[0] + shiftX, p[1] + shiftY]; });
    });
    Object.keys(d.origLabels).forEach(function(k) {
      var ol = d.origLabels[k];
      labelPositions[k] = Object.assign({}, ol, { x: ol.x + shiftX, y: ol.y + shiftY });
    });
  }
  fitCanvas();
  // The stage is pinned to the wrap's top-left while manual sizing is on, so a
  // west/north drag cannot move the boundary on screen — it grows the area and
  // shifts the content instead. Scrolling by the same amount cancels that out,
  // leaving the drawing visually stationary and the boundary appearing to move
  // under the cursor. The browser clamps the scroll when there is nowhere to
  // go, which is the one case where the drawing does slide.
  if (shiftX || shiftY) {
    var wrap = document.querySelector('.canvas-wrap');
    if (wrap) {
      wrap.scrollLeft = d.startScrollLeft + shiftX * manualSizeScale;
      wrap.scrollTop  = d.startScrollTop  + shiftY * manualSizeScale;
    }
  }
  clearSVG();
  drawArrows();
  applyLegendPosition();
}
function onStageResizeMouseUp() {
  if (!stageResizeDrag) return;
  if (CANVAS_W !== stageResizeDrag.startW || CANVAS_H !== stageResizeDrag.startH) {
    pushUndoState(stageResizeDrag.undoState);
  }
  document.querySelectorAll('.stage-rh.dragging, .stage-resize-handle.dragging').forEach(function(h) {
    h.classList.remove('dragging');
  });
  var stage = document.getElementById('canvas-stage');
  if (stage) stage.classList.remove('resizing');
  setMarginGuide(false);
  saveStageSize();
  savePositions();
  saveArrows();
  saveLabelPositions();
  stageResizeDrag = null;
}
function wireStageResize() {
  document.querySelectorAll('.stage-rh, .stage-resize-handle').forEach(function(handle) {
    handle.addEventListener('mousedown', onStageResizeMouseDown);
  });
  document.addEventListener('mousemove', onStageResizeMouseMove);
  document.addEventListener('mouseup', onStageResizeMouseUp);
  loadStageSize();
}

// ---------------------------------------------------------------------------
// Typed chart-area dimensions — the toolbar's W × H inputs and the Fit button,
// the exact-value alternative to dragging the stage's edge and corner grips.
// Both go through setCanvasSize(), so they share the drag path's rule that
// changing the drawing extent never rescales what is already on the canvas.
// ---------------------------------------------------------------------------
function syncCanvasSizeInputs() {
  var wi = document.getElementById('canvas-w-input');
  var hi = document.getElementById('canvas-h-input');
  if (wi && document.activeElement !== wi) wi.value = Math.round(CANVAS_W);
  if (hi && document.activeElement !== hi) hi.value = Math.round(CANVAS_H);
}

function setCanvasSize(w, h) {
  if (!manualSizeActive) { manualSizeActive = true; manualSizeScale = canvasScale; }
  CANVAS_W = Math.max(STAGE_SIZE_MIN, Math.round(w));
  CANVAS_H = Math.max(STAGE_SIZE_MIN, Math.round(h));
  fitCanvas();
  clearSVG();
  drawArrows();
  applyLegendPosition();
  saveStageSize();
}

// Move every node, waypoint and arrow label by (dx, dy) in logical units.
function shiftAllContent(dx, dy) {
  if (!dx && !dy) return;
  NODE_IDS.forEach(function(id) {
    var el = document.getElementById('N-' + id);
    if (!el) return;
    el.style.left = ((parseFloat(el.style.left) || 0) + dx) + 'px';
    el.style.top  = ((parseFloat(el.style.top)  || 0) + dy) + 'px';
  });
  arrows.forEach(function(a) {
    a.waypoints = (a.waypoints || []).map(function(p) { return [p[0] + dx, p[1] + dy]; });
  });
  Object.keys(labelPositions).forEach(function(k) {
    var lp = labelPositions[k];
    labelPositions[k] = Object.assign({}, lp, { x: lp.x + dx, y: lp.y + dy });
  });
}

// Shrink-wrap the chart area around the drawing: slide the content so its
// top-left sits exactly one margin in, then size the area to the content plus
// a margin on every side.
function fitCanvasToContent() {
  var c = contentBounds();
  if (!c) return;
  pushUndo();
  shiftAllContent(CANVAS_MARGIN - c.l, CANVAS_MARGIN - c.t);
  setCanvasSize((c.r - c.l) + 2 * CANVAS_MARGIN, (c.b - c.t) + 2 * CANVAS_MARGIN);
  savePositions();
  saveArrows();
  saveLabelPositions();
}

function wireCanvasSizeInputs() {
  ['canvas-w-input', 'canvas-h-input'].forEach(function(id) {
    var input = document.getElementById(id);
    if (!input) return;
    input.addEventListener('change', function() {
      var v = parseFloat(input.value);
      if (isFinite(v)) {
        pushUndo();
        if (id === 'canvas-w-input') setCanvasSize(v, CANVAS_H);
        else                         setCanvasSize(CANVAS_W, v);
      }
      // Written back explicitly, not via syncCanvasSizeInputs() — that call
      // skips the focused field, and this one must show the value actually
      // applied after STAGE_SIZE_MIN clamping.
      input.value = Math.round(id === 'canvas-w-input' ? CANVAS_W : CANVAS_H);
    });
    input.addEventListener('keydown', function(e) {
      if (e.key === 'Enter') input.blur();
      e.stopPropagation();
    });
  });
  syncCanvasSizeInputs();
}
function wireLegend() {
  var leg = document.getElementById('canvas-legend');
  if (leg) {
    leg.addEventListener('mousedown', onLegendMouseDown);
    leg.addEventListener('dblclick', onLegendDblClick);
  }
  document.addEventListener('mousemove', onLegendMouseMove);
  document.addEventListener('mouseup', onLegendMouseUp);
  document.addEventListener('mousemove', onLegendResizeMouseMove);
  document.addEventListener('mouseup', onLegendResizeMouseUp);
  document.addEventListener('click', function(e) {
    var pop = document.getElementById('legend-color-picker');
    if (pop && !pop.contains(e.target)) closeLegendColorPicker();
  });
  var cb = document.getElementById('legend-toggle');
  if (cb) cb.addEventListener('change', function() {
    legendState.visible = cb.checked;
    applyLegendVisibility();
    saveLegendState();
  });
}

function applyNodeStyle(id, colorObj) {
  var el = document.getElementById('N-' + id);
  if (!el) return;
  var head  = el.querySelector('.node-head');
  var dot   = el.querySelector('.dot');
  var badge = el.querySelector('.badge');
  if (colorObj) {
    el.style.borderColor = colorObj.border;
    if (head)  head.style.background  = colorObj.bg;
    if (dot)   dot.style.background   = colorObj.dot;
    if (badge) { badge.style.background = colorObj.border; badge.style.color = '#1a1a1a'; }
  } else {
    el.style.borderColor = '';
    if (head)  head.style.background  = '';
    if (dot)   dot.style.background   = '';
    if (badge) { badge.style.background = ''; badge.style.color = ''; }
  }
}

function applyAllStyleOverrides() {
  Object.keys(styleOverrides).forEach(function(id) {
    applyNodeStyle(id, styleOverrides[id]);
  });
}

function applyStyleFromMenu(colorObj) {
  if (!ctxNodeId) return;
  pushUndo();
  var id = ctxNodeId;
  applyNodeStyle(id, colorObj);
  if (colorObj) styleOverrides[id] = colorObj;
  else          delete styleOverrides[id];
  saveStyleOverrides();
  hideNodeContextMenu();
}

function toggleExportDrop(e) {
  e.stopPropagation();
  document.getElementById('export-drop').classList.toggle('open');
}
function closeExportDrop() {
  var d = document.getElementById('export-drop');
  if (d) d.classList.remove('open');
}
function toggleReadonlyExport(e) {
  e.stopPropagation();
  document.getElementById('readonly-export-drop').classList.toggle('open');
}
function closeReadonlyExport() {
  var d = document.getElementById('readonly-export-drop');
  if (d) d.classList.remove('open');
}
document.addEventListener('click', closeExportDrop);
document.addEventListener('click', closeReadonlyExport);

// ── Fullscreen toggle ─────────────────────────────────────────────────────────
function toggleFullscreen() {
  if (document.fullscreenElement) document.exitFullscreen();
  else document.documentElement.requestFullscreen();
}
document.addEventListener('fullscreenchange', function () {
  var fs = !!document.fullscreenElement;
  document.getElementById('fs-icon-path').setAttribute('d', fs
    ? 'M5 1v4H1M13 5H9V1M9 13V9h4M1 9h4v4'    // corners pointing inward
    : 'M1 5V1h4M9 1h4v4M13 9v4H9M5 13H1V9');  // corners pointing outward
});

// ── Tooltip (body-level, escapes overflow clipping) ──────────────────────────
(function () {
  var tip = document.getElementById('ui-tooltip');
  var hideTimer;
  document.addEventListener('mouseover', function (e) {
    var el = e.target.closest('[data-tip]');
    if (!el || el.disabled) return;
    clearTimeout(hideTimer);
    tip.textContent = el.getAttribute('data-tip');
    tip.style.opacity = '0';
    tip.style.display = 'block';
    var r = el.getBoundingClientRect();
    tip.style.left = Math.round(r.right + 8) + 'px';
    tip.style.top  = Math.round(r.top + r.height / 2 - tip.offsetHeight / 2) + 'px';
    tip.style.opacity = '1';
  });
  document.addEventListener('mouseout', function (e) {
    var el = e.target.closest('[data-tip]');
    if (!el) return;
    tip.style.opacity = '0';
    hideTimer = setTimeout(function () { tip.style.display = 'none'; }, 160);
  });
})();

