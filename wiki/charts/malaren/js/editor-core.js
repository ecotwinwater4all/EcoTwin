// -- Publish mode ------------------------------------------------------------
// sync.py in the ecotwin_wiki repo flips this stamp to true while copying the
// file across. Keep it false here: this is the editable source. The published
// copy is read-only in every context, file:// included, so opening it locally
// can never write back over this file through the cached file handle.

// Read-only hides every editing affordance while leaving the diagram fully
// interactive: clicking a box opens its detail sidebar, and export, fullscreen
// and the legend toggle all still work. Append ?view=1 here to preview it.
var READONLY = PUBLISHED || /[?&]view=1/.test(location.search);

// Read-only/shared views use only the state baked into this file. Editable
// views can still keep unsaved work in localStorage until Save writes it into
// the DEFAULT_* blocks below.
function lsGet(k) {
  if (READONLY) return null;
  try { return localStorage.getItem(k); } catch (e) { return null; }
}
function lsSet(k, v) {
  if (READONLY) return;
  try { localStorage.setItem(k, v); } catch (e) {}
}

// Keep an open local read-only viewer current when the editable chart saves in
// another tab/window. The viewer remains read-only; it only reloads the latest
// saved state. GitHub Pages has a separate origin, so publishing still requires
// committing and deploying the updated chart source.
if (READONLY) {
  var _viewerReloadTimer = null;
  window.addEventListener('storage', function(e) {
    if (!e.key || e.key.indexOf('lake_malaren_chart_') !== 0) return;
    clearTimeout(_viewerReloadTimer);
    _viewerReloadTimer = setTimeout(function() { location.reload(); }, 80);
  });
}

var NODE_TIP  = READONLY ? 'Click for details' : 'Drag to move · Double-click for options · Drag edges to resize';

// One capture-phase guard beats fourteen scattered ones. Every editing gesture
// in this file -- node drag, resize handles, label drag, waypoint and endpoint
// handles, legend move/resize, stage resize, rubber-band select, the arrow and
// node popups -- starts with mousedown, dblclick or contextmenu inside
// .chart-area. Swallowing those three in the capture phase, before they reach
// the listeners bound to the nodes themselves, makes all of it inert at once.
//
// `click` is deliberately left alone: the inline onclick="open_panel(...)" on
// every box is what opens the sidebar. Nothing calls preventDefault either, so
// text selection, scrolling and native tooltips behave normally. The guard is
// scoped to .chart-area, which leaves the toolbar, the sidebar and the
// #split-handle between them fully live.
function applyReadOnly() {
  if (!READONLY) return;
  document.body.classList.add('readonly');
  ['mousedown', 'dblclick', 'contextmenu'].forEach(function(type) {
    document.addEventListener(type, function(e) {
      var el = e.target;
      if (el && el.closest && el.closest('.chart-area')) e.stopPropagation();
    }, true);
  });
  var leg = document.getElementById('canvas-legend');
  if (leg) leg.removeAttribute('title');
}
applyReadOnly();

var NODE_IDS = ['icon','mon','aem','wsm','tbm','eco','vda','arc','dash','stk'];
// v2 invalidates stale browser-only layouts. In particular, an older Edge
// state contained rotated boxes even though the authoritative file does not.
var STORAGE_KEY = 'lake_malaren_chart_v2';
var LABEL_STORAGE_KEY = 'lake_malaren_chart_labels_v2';
var DELETED_NODES_KEY  = 'lake_malaren_chart_deleted_v2';
var CUSTOM_NODES_KEY   = 'lake_malaren_chart_custom_v2';
var TEXT_STORAGE_KEY = 'lake_malaren_chart_text_v2';
var TEXT_CONTENT_REVISION_KEY = 'lake_malaren_chart_text_content_revision_v2';
var textOverrides = {};
var nodeTextEditId = null;
var STYLE_STORAGE_KEY   = 'lake_malaren_chart_style_v2';
var SIDEBAR_KEY         = 'lake_malaren_chart_sidebar_v2';
var FOOTER_KEY          = 'lake_malaren_chart_footer_v2';
var SIDEBAR_CONTENT_REVISION_KEY = 'lake_malaren_chart_sidebar_content_revision_v2';
var AUTHORITATIVE_CONTENT_REVISION = 'text-chart-2026-08-24-v4';
var AUTHORITATIVE_SIDEBAR_IDS = ['icon','mon','aem','wsm','tbm','eco','vda','dash','stk','cnode_1780556617482'];
// Sidebar text edited in the browser; "Commit layout" bakes it in here so the
// edits survive other machines/browsers (localStorage alone does not).
var sidebarContent      = {};
var sidebarEditId       = null;
var styleOverrides = {};
var deletedNodes = [];
var customNodes  = {}; // id → { id, title, badge, bcls, nsub, x, y, w }

var CANVAS_W = DEFAULT_CANVAS_SIZE.w, CANVAS_H = DEFAULT_CANVAS_SIZE.h;
var canvasScale = 1;
// Manual drawing-area resize (see wireStageResize()): dragging
// #stage-resize-handle changes CANVAS_W/CANVAS_H directly (the logical
// drawing extent — more room for new boxes) rather than the zoom level.
// Once active, canvasScale is frozen at whatever it was at drag-start
// (manualSizeScale) instead of being recomputed to fit canvas-wrap, so
// existing content keeps its on-screen size; the extra logical space just
// shows up as blank canvas, scrollable via canvas-wrap's overflow:auto.
var manualSizeActive = !!DEFAULT_CANVAS_SIZE.manual;
var manualSizeScale = DEFAULT_CANVAS_SIZE.scale || 1;
// Keep-clear band, in logical canvas units, between the chart area's boundary
// line and its content. Node drags/resizes and dragged waypoints/labels are
// confined to the rect it leaves (see canvasContentRect()), and
// fitCanvasToContent() reserves it on all four sides.
var CANVAS_MARGIN = 24;

// The rect content is allowed to occupy: the drawing extent inset by
// CANVAS_MARGIN. Never inverts — on a canvas narrower than two margins it
// collapses to the centre line rather than producing a negative box.
function canvasContentRect() {
  var l = Math.min(CANVAS_MARGIN, CANVAS_W / 2);
  var t = Math.min(CANVAS_MARGIN, CANVAS_H / 2);
  return { l: l, t: t, r: Math.max(l, CANVAS_W - l), b: Math.max(t, CANVAS_H - t) };
}

function fitCanvas() {
  var wrap = document.querySelector('.canvas-wrap');
  var stage = document.getElementById('canvas-stage');
  var canvas = document.getElementById('canvas');
  if (!wrap || !stage || !canvas) return;
  wrap.classList.toggle('manual-size', manualSizeActive);
  var s;
  if (manualSizeActive) {
    s = manualSizeScale;
  } else {
    var cs = getComputedStyle(wrap);
    var availW = wrap.clientWidth  - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    var availH = wrap.clientHeight - parseFloat(cs.paddingTop)  - parseFloat(cs.paddingBottom);
    availW = Math.max(1, availW);
    availH = Math.max(1, availH);
    s = Math.min(availW / CANVAS_W, availH / CANVAS_H);
    s = Math.max(0.12, Math.min(s, 1.6));
  }
  canvasScale = s;
  stage.style.width = (CANVAS_W * s) + 'px';
  stage.style.height = (CANVAS_H * s) + 'px';
  canvas.style.transformOrigin = 'top left';
  canvas.style.transform = 'scale(' + s + ')';
  canvas.style.width = CANVAS_W + 'px';
  canvas.style.height = CANVAS_H + 'px';
  canvas.style.marginRight = '';
  canvas.style.marginBottom = '';
  var guide = document.getElementById('canvas-margin-guide');
  if (guide) {
    var cr = canvasContentRect();
    guide.style.left   = cr.l + 'px';
    guide.style.top    = cr.t + 'px';
    guide.style.width  = Math.max(0, cr.r - cr.l) + 'px';
    guide.style.height = Math.max(0, cr.b - cr.t) + 'px';
    guide.style.borderWidth = Math.max(0.5, 1 / s) + 'px';
  }
  syncCanvasSizeInputs();
}

// Show the dashed keep-clear guide while a drag/resize is running, so the
// boundary content is being confined to is visible at the moment it bites.
function setMarginGuide(on) {
  var guide = document.getElementById('canvas-margin-guide');
  if (guide) guide.classList.toggle('show', !!on);
}

// ---------------------------------------------------------------------------
// DEFAULT_POSITIONS — drag boxes in the browser, then tell Claude
// "commit the flowchart layout" to bake the dragged coords in here.
// ---------------------------------------------------------------------------


var labelPositions = {};

function applyPositions(map) {
  NODE_IDS.forEach(function(id) {
    var p = map[id];
    if (!p) return;
    var el = document.getElementById('N-' + id);
    if (!el) return;
    el.style.left = p.x + 'px';
    el.style.top  = p.y + 'px';
    if (p.w) el.style.width  = p.w + 'px';
    if (p.h) el.style.height = p.h + 'px';
    if (p.r) { el.setAttribute('data-rot', p.r); el.style.transform = 'rotate(' + p.r + 'deg)'; }
    else      { el.removeAttribute('data-rot');   el.style.transform = ''; }
    updateResizeCursors(el);
  });
}

function restorePositions() {
  applyPositions(DEFAULT_POSITIONS);
  try {
    var saved = lsGet(STORAGE_KEY);
    if (saved) applyPositions(JSON.parse(saved));
  } catch(e) {}
}

function savePositions() {
  try {
    var out = {};
    NODE_IDS.forEach(function(id) {
      var el = document.getElementById('N-' + id);
      if (!el) return;
      var entry = { x: parseInt(el.style.left) || 0, y: parseInt(el.style.top) || 0 };
      if (el.style.width)  entry.w = parseInt(el.style.width);
      if (el.style.height) entry.h = parseInt(el.style.height);
      var r = parseInt(el.getAttribute('data-rot') || '0');
      if (r) entry.r = r;
      out[id] = entry;
    });
    lsSet(STORAGE_KEY, JSON.stringify(out));
  } catch(e) {}
}

function saveLabelPositions() {
  try { lsSet(LABEL_STORAGE_KEY, JSON.stringify(labelPositions)); } catch(e) {}
}

function restoreLabelPositions() {
  labelPositions = Object.assign({}, DEFAULT_LABEL_POSITIONS);
  try { Object.assign(labelPositions, JSON.parse(lsGet(LABEL_STORAGE_KEY) || '{}')); } catch(e) {}
}

var drag   = { el: null, startX: 0, startY: 0, origX: 0, origY: 0, moved: false, axis: null, selectedOrigPositions: null };
var orthoDragMode = false;
try { orthoDragMode = lsGet('lake_malaren_ortho_drag') === '1'; } catch(e) {}

function toggleOrthoDrag() {
  orthoDragMode = !orthoDragMode;
  try { lsSet('lake_malaren_ortho_drag', orthoDragMode ? '1' : '0'); } catch(e) {}
  var btn = document.getElementById('btn-ortho-drag');
  if (btn) btn.classList.toggle('tb-active', orthoDragMode);
}
var resize = { el: null, dir: null, startX: 0, startY: 0, origX: 0, origY: 0, origW: 0, origH: 0 };
var labelDrag = { el: null, key: null, startX: 0, startY: 0, origX: 0, origY: 0, moved: false };
var fileHandle = null;
var IDB_NAME   = 'lake_malaren_chart_fh_v1';

function idbSaveHandle(handle) {
  return new Promise(function(res, rej) {
    var r = indexedDB.open(IDB_NAME, 1);
    r.onupgradeneeded = function(e) { e.target.result.createObjectStore('h'); };
    r.onsuccess = function(e) {
      var tx = e.target.result.transaction('h', 'readwrite');
      tx.objectStore('h').put(handle, 'k');
      tx.oncomplete = res; tx.onerror = rej;
    };
    r.onerror = rej;
  });
}

function idbLoadHandle() {
  return new Promise(function(res) {
    var r = indexedDB.open(IDB_NAME, 1);
    r.onupgradeneeded = function(e) { e.target.result.createObjectStore('h'); };
    r.onsuccess = function(e) {
      var tx = e.target.result.transaction('h', 'readonly');
      var g = tx.objectStore('h').get('k');
      g.onsuccess = function() { res(g.result || null); };
      g.onerror   = function() { res(null); };
    };
    r.onerror = function() { res(null); };
  });
}

// Returns a verified writable handle, reusing the stored one if permission allows,
// otherwise falling back to the file picker and saving the new handle.
// The handle must point at THIS file — a stored or picked handle whose name
// doesn't match the current document is rejected, so commits can never land
// in a renamed ancestor (e.g. new.html).
async function getWritableHandle(statusCb) {
  var fname = decodeURIComponent(location.pathname.split('/').pop() || 'chart.html');
  if (!fileHandle) fileHandle = await idbLoadHandle();
  if (fileHandle && fileHandle.name !== fname) {
    fileHandle = null;
    idbSaveHandle(null).catch(function(){});
  }
  if (fileHandle) {
    var perm = await fileHandle.queryPermission({ mode: 'readwrite' });
    if (perm === 'prompt') perm = await fileHandle.requestPermission({ mode: 'readwrite' });
    if (perm !== 'granted') fileHandle = null;
  }
  if (!fileHandle) {
    if (statusCb) statusCb('Select: ' + fname);
    var picks = await window.showOpenFilePicker({
      types: [{ description: 'HTML', accept: { 'text/html': ['.html'] } }],
      multiple: false
    });
    if (picks[0].name !== fname &&
        !confirm('You picked "' + picks[0].name + '" but this page is "' + fname +
                 '".\nCommit into "' + picks[0].name + '" anyway?')) {
      throw new DOMException('User aborted: wrong file picked', 'AbortError');
    }
    fileHandle = picks[0];
    await idbSaveHandle(fileHandle);
  }
  return fileHandle;
}

// ── Arrow builder globals ──────────────────────────────────────────────────
var ARROWS_KEY = 'lake_malaren_chart_arrows_v2';
var arrows = [];

var LABEL_FONT_SIZE_KEY  = 'lake_malaren_chart_label_fs_v2';
var NTITLE_FONT_SIZE_KEY = 'lake_malaren_chart_ntitle_fs_v2';
var NSUB_FONT_SIZE_KEY   = 'lake_malaren_chart_nsub_fs_v2';
var BADGE_FONT_SIZE_KEY  = 'lake_malaren_chart_badge_fs_v2';
var labelFontSize  = DEFAULT_FONT_SIZES.label;
var ntitleFontSize = DEFAULT_FONT_SIZES.ntitle;
var nsubFontSize   = DEFAULT_FONT_SIZES.nsub;
var badgeFontSize  = DEFAULT_FONT_SIZES.badge;
var arrowEditColor = null; // set by buildArrowEditColorSwatches() after ARROW_COLORS is defined
var addNodeSelectedColor = null;

var ARROW_COLORS = [
  { hex: '#5b9bd5', marker: 'mbl', name: 'Atmospheric' },
  { hex: '#2e9688', marker: 'mtl', name: 'Hydrological' },
  { hex: '#ed7d31', marker: 'mor', name: 'Validation' },
  { hex: '#70ad47', marker: 'mgr', name: 'Assimilation' },
  { hex: '#7030a0', marker: 'mpu', name: 'Model cascade' }
];
var paletteSelectedColor = ARROW_COLORS[0];

var drawState = { mode: 'idle', src: null, dst: null, waypoints: [], cursorPt: [0,0], hoveredNode: null, edgeSnap: null, tapSnap: null };
// mode: 'idle' | 'src' | 'waypoints' | 'palette'

var selectedArrowId = null;
var hoveredArrowId  = null;

function setSelectedArrow(id) {
  selectedArrowId = id;
  document.getElementById('btn-delete-arrow').style.display = id ? 'inline-block' : 'none';
  document.body.classList.toggle('arrow-selected', !!id);
  var handles = document.querySelectorAll('#canvas .rh');
  for (var i = 0; i < handles.length; i++) {
    handles[i].style.pointerEvents = id ? 'none' : '';
    handles[i].style.background    = id ? 'none' : '';
  }
}
var hoveredSegIdx   = -1;
var hoveredSegIsH   = false;
var draggingWaypoint = { arrowId: null, idx: null };
var segDrag = { active: false, arrowId: null, segIdx: null, origPts: null, origLabelPos: null, startX: 0, startY: 0, isH: false, moved: false };
var segDragJustFinished = false;
var straightArrows = []; // straight arrows connected to the currently-dragged box

// ── Multi-select ─────────────────────────────────────────────────────────────
var selectedNodes = new Set();
var rubberBand = { active: false, startX: 0, startY: 0, curX: 0, curY: 0 };
var rubberBandJustFinished = false;

// ── Endpoint drag (reassign arrow src/dst) ────────────────────────────────────
var endpointDrag = { active: false, arrowId: null, end: null, origAnchor: null, edgeSnap: null, moved: false };

// ── Undo / Redo system ────────────────────────────────────────────────────────
var undoStack = [];
var redoStack = [];
var MAX_UNDO  = 40;

function captureState() {
  var pos = {};
  NODE_IDS.forEach(function(id) {
    var el = document.getElementById('N-' + id);
    if (!el) return;
    var entry = { x: parseInt(el.style.left)||0, y: parseInt(el.style.top)||0 };
    if (el.style.width)  entry.w = parseInt(el.style.width);
    if (el.style.height) entry.h = parseInt(el.style.height);
    var r = parseInt(el.getAttribute('data-rot')||'0');
    if (r) entry.r = r;
    pos[id] = entry;
  });
  return {
    positions:      pos,
    arrows:         JSON.parse(JSON.stringify(arrows)),
    labelPositions: JSON.parse(JSON.stringify(labelPositions)),
    customNodes:    JSON.parse(JSON.stringify(customNodes)),
    deletedNodes:   deletedNodes.slice(),
    textOverrides:  JSON.parse(JSON.stringify(textOverrides)),
    styleOverrides: JSON.parse(JSON.stringify(styleOverrides)),
    fontSizes:      { label: labelFontSize, ntitle: ntitleFontSize, nsub: nsubFontSize, badge: badgeFontSize },
    // The drawing extent is part of the layout: a west/north stage resize
    // changes the size and shifts every node, and undoing one without the
    // other would leave the content off its frame.
    canvasSize:     { w: CANVAS_W, h: CANVAS_H, manual: manualSizeActive, scale: manualSizeScale }
  };
}

function pushUndo() {
  pushUndoState(captureState());
}

// Push a state captured earlier. Lets a gesture snapshot itself before it
// starts mutating and only commit the entry if it actually changed something,
// instead of leaving a no-op step on the stack after a stray click.
function pushUndoState(state) {
  undoStack.push(state);
  if (undoStack.length > MAX_UNDO) undoStack.shift();
  redoStack = [];
  updateUndoBtn();
  updateRedoBtn();
}

function updateUndoBtn() {
  var btn = document.getElementById('btn-undo');
  if (btn) btn.disabled = undoStack.length === 0;
}

function updateRedoBtn() {
  var btn = document.getElementById('btn-redo');
  if (btn) btn.disabled = redoStack.length === 0;
}

function rebuildBuiltinNode(id) {
  var d = (typeof DATA !== 'undefined') && DATA[id];
  if (!d) return null;
  var cls = 'node';
  if (d.bcls === 'src')  cls += ' src';
  if (d.bcls === 'prog') cls += ' prog';
  if (d.bcls === 'plan') cls += ' plan';
  var el = document.createElement('div');
  el.className = cls;
  el.id = 'N-' + id;
  el.setAttribute('onclick', "open_panel('" + id + "')");
  var head = document.createElement('div');
  head.className = 'node-head';
  head.innerHTML = '<div class="dot"></div><span class="ntitle">' + d.title + '</span><span class="badge">' + d.badge + '</span>';
  el.appendChild(head);
  var sub = document.createElement('div');
  sub.className = 'nsub';
  sub.innerHTML = d.nsub || '';
  el.appendChild(sub);
  document.getElementById('canvas').appendChild(el);
  el.title = NODE_TIP;
  el.addEventListener('mousedown', onMouseDown);
  el.style.cursor = 'pointer';
  el.addEventListener('dblclick', function(e) { showNodeContextMenu(e, id); });
  el.addEventListener('contextmenu', function(e) {
    e.preventDefault(); e.stopPropagation();
    ctxNodeId = id;
    ctxRotateNode();
  });
  ['e','w','s','n','se','sw','ne','nw'].forEach(function(dir) {
    var h = document.createElement('div');
    h.className = 'rh rh-' + dir;
    h.setAttribute('data-dir', dir);
    h.addEventListener('mousedown', onResizeStart);
    el.appendChild(h);
  });
  if (NODE_IDS.indexOf(id) < 0) NODE_IDS.push(id);
  return el;
}

function restoreState(state) {
  // Core data
  arrows         = JSON.parse(JSON.stringify(state.arrows));
  labelPositions = JSON.parse(JSON.stringify(state.labelPositions));
  textOverrides  = JSON.parse(JSON.stringify(state.textOverrides));
  styleOverrides = JSON.parse(JSON.stringify(state.styleOverrides || {}));

  // Remove custom nodes added after this undo point
  Object.keys(customNodes).forEach(function(id) {
    if (!state.customNodes[id]) {
      var el = document.getElementById('N-' + id);
      if (el && el.parentNode) el.parentNode.removeChild(el);
      var idx = NODE_IDS.indexOf(id); if (idx >= 0) NODE_IDS.splice(idx, 1);
    }
  });
  customNodes = JSON.parse(JSON.stringify(state.customNodes));

  // Restore nodes that were deleted after this undo point
  deletedNodes.slice().forEach(function(id) {
    if (state.deletedNodes.indexOf(id) < 0 && !document.getElementById('N-' + id)) {
      if (state.customNodes[id]) createCustomNodeEl(state.customNodes[id]);
      else                        rebuildBuiltinNode(id);
    }
  });

  // Re-delete nodes that should still be deleted at this undo point
  state.deletedNodes.forEach(function(id) {
    if (deletedNodes.indexOf(id) < 0) {
      var el = document.getElementById('N-' + id);
      if (el && el.parentNode) el.parentNode.removeChild(el);
      var idx = NODE_IDS.indexOf(id); if (idx >= 0) NODE_IDS.splice(idx, 1);
    }
  });
  deletedNodes = state.deletedNodes.slice();

  // Positions
  NODE_IDS.forEach(function(id) {
    var p  = state.positions[id];
    var el = document.getElementById('N-' + id);
    if (!el || !p) return;
    el.style.left = p.x + 'px'; el.style.top = p.y + 'px';
    el.style.width  = p.w ? p.w + 'px' : '';
    el.style.height = p.h ? p.h + 'px' : '';
    if (p.r) { el.setAttribute('data-rot', p.r); el.style.transform = 'rotate(' + p.r + 'deg)'; }
    else     { el.removeAttribute('data-rot'); el.style.transform = ''; }
    updateResizeCursors(el);
  });

  applyAllTextOverrides();
  applyAllStyleOverrides();

  if (state.fontSizes) {
    labelFontSize  = state.fontSizes.label  || labelFontSize;
    ntitleFontSize = state.fontSizes.ntitle || ntitleFontSize;
    nsubFontSize   = state.fontSizes.nsub   || nsubFontSize;
    badgeFontSize  = state.fontSizes.badge  || badgeFontSize;
    applyNodeFontSizes();
    var _li = document.getElementById('label-font-size');  if (_li) _li.value = labelFontSize;
    var _ti = document.getElementById('ntitle-font-size'); if (_ti) _ti.value = ntitleFontSize;
    var _si = document.getElementById('nsub-font-size');   if (_si) _si.value = nsubFontSize;
    var _bi = document.getElementById('badge-font-size');  if (_bi) _bi.value = badgeFontSize;
  }

  // Drawing extent — restored before the redraw below so arrows, the legend and
  // the margin guide are all laid out against the size this state was captured
  // at.
  if (state.canvasSize) {
    CANVAS_W = state.canvasSize.w;
    CANVAS_H = state.canvasSize.h;
    manualSizeActive = !!state.canvasSize.manual;
    manualSizeScale  = state.canvasSize.scale || manualSizeScale;
    fitCanvas();
    applyLegendPosition();
    saveStageSize();
  }

  // Persist everything
  savePositions(); saveArrows(); saveLabelPositions(); saveTextOverrides(); saveStyleOverrides(); saveCustomNodes();
  try { lsSet(DELETED_NODES_KEY, JSON.stringify(deletedNodes)); } catch(e) {}

  // UI cleanup
  setSelectedArrow(null);
  hideLabelEdit();
  clearSVG(); drawArrows();
  updateUndoBtn();
  updateRedoBtn();
}

function undo() {
  if (undoStack.length === 0) return;
  redoStack.push(captureState());
  restoreState(undoStack.pop());
  updateRedoBtn();
}

function redo() {
  if (redoStack.length === 0) return;
  undoStack.push(captureState());
  if (undoStack.length > MAX_UNDO) undoStack.shift();
  restoreState(redoStack.pop());
  updateUndoBtn();
  updateRedoBtn();
}

// ── Arrow follow ─────────────────────────────────────────────────────────────
// Keeps routed arrows attached while their node(s) move or resize. Captured on
// gesture start, applied every frame. Manual waypoints are preserved: the end
// segment next to a moving anchor is repaired to stay orthogonal, and arrows
// whose two endpoints move together (group drag) are translated rigidly.
// Explicitly-positioned labels ride along with the path midpoint.
var arrowFollow = [];

function captureArrowFollow(movingIds) {
  // Which arrows have an endpoint that shifts this gesture. A tap at either
  // end rides its trunk, so moving a trunk pulls branches and merges too,
  // transitively.
  var moves = {};
  arrows.forEach(function(a) {
    var srcMoves = isNodeAnchor(a.src) && movingIds.indexOf(a.src.node) >= 0;
    var dstMoves = isNodeAnchor(a.dst) && movingIds.indexOf(a.dst.node) >= 0;
    if (srcMoves || dstMoves) moves[a.id] = { src: srcMoves, dst: dstMoves, branch: false };
  });
  var grew = true;
  while (grew) {
    grew = false;
    arrows.forEach(function(a) {
      var srcFollows = a.src.arrow && moves[a.src.arrow];
      var dstFollows = a.dst.arrow && moves[a.dst.arrow];
      if (!srcFollows && !dstFollows) return;
      var m = moves[a.id] || { src: false, dst: false, branch: false };
      var changed = false;
      if (srcFollows && !m.src) { m.src = true; changed = true; }
      if (dstFollows && !m.dst) { m.dst = true; changed = true; }
      if (changed) {
        m.branch = true;
        moves[a.id] = m;
        grew = true;
      }
    });
  }

  var recs = [];
  arrows.forEach(function(a) {
    var m = moves[a.id];
    if (!m) return;
    var rec = {
      id: a.id, srcMoves: m.src, dstMoves: m.dst, isBranch: m.branch,
      origSrc: resolveAnchor(a.src), origDst: resolveAnchor(a.dst),
      origWps: a.waypoints.map(function(p) { return p.slice(); })
    };
    var key = a.label && a.label.key;
    if (key && labelPositions[key]) {
      rec.lblKey  = key;
      rec.origMid = polylineMidpoint(arrowPoints(a));
      rec.origLbl = Object.assign({}, labelPositions[key]);
    }
    recs.push(rec);
  });
  return recs;
}

// Shift the waypoint next to a moving anchor so the end segment keeps its
// original H/V orientation. Changing a waypoint's cross-axis coordinate never
// breaks the adjacent interior segment, which runs along the other axis.
function repairFollowEnd(wps, idx, origPt, newPt) {
  var wasH = Math.abs(wps[idx][1] - origPt[1]) <= Math.abs(wps[idx][0] - origPt[0]);
  if (wasH) wps[idx][1] = newPt[1];
  else      wps[idx][0] = newPt[0];
}

// Magnetic snap-to-straight applies only to automatically routed arrows. A
// manual route keeps its waypoints, and an automatic route snaps only when its
// endpoint faces support a straight segment in the direction of travel.
var SNAP_STRAIGHT_PX = 8;

function trySnapStraight(movingIds) {
  if (!movingIds) return;
  arrows.forEach(function(a) {
    if (straightArrows.some(function(sa) { return sa.id === a.id; })) return;
    if (a.waypoints.length > 0) return;
    var srcMoves = isNodeAnchor(a.src) && movingIds.indexOf(a.src.node) >= 0;
    var dstMoves = isNodeAnchor(a.dst) && movingIds.indexOf(a.dst.node) >= 0;
    if (srcMoves === dstMoves) return;  // need exactly one moving end
    var sPt = resolveAnchor(a.src), dPt = resolveAnchor(a.dst);
    var movingEnd = srcMoves ? 'src' : 'dst';
    var axis = straightRouteAxis(a, sPt, dPt, SNAP_STRAIGHT_PX);
    if (axis) straightArrows.push({ id: a.id, movingEnd: movingEnd, isH: axis === 'h' });
  });
}

function applyArrowFollow() {
  arrowFollow.forEach(function(rec) {
    var a = arrows.find(function(x) { return x.id === rec.id; });
    if (!a) return;
    var newSrc = resolveAnchor(a.src), newDst = resolveAnchor(a.dst);
    // Snapped/straight-tracked arrows are geometry-owned by the straightArrows
    // slide — don't restore their cleared waypoints. But the label must still
    // follow (below), so skip only the waypoint restore, not the whole record.
    var straightTracked = straightArrows.some(function(sa) { return sa.id === rec.id; });
    if (!straightTracked && rec.origWps.length > 0) {
      var wps = rec.origWps.map(function(p) { return p.slice(); });
      if (rec.srcMoves && rec.dstMoves && !rec.isBranch) {
        var dx = newSrc[0] - rec.origSrc[0], dy = newSrc[1] - rec.origSrc[1];
        wps = wps.map(function(p) { return [p[0] + dx, p[1] + dy]; });
      } else {
        if (rec.srcMoves) repairFollowEnd(wps, 0, rec.origSrc, newSrc);
        if (rec.dstMoves) repairFollowEnd(wps, wps.length - 1, rec.origDst, newDst);
      }
      a.waypoints = wps;
    }
    if (rec.lblKey) {
      var mid = polylineMidpoint(arrowPoints(a));
      labelPositions[rec.lblKey] = {
        x: rec.origLbl.x + (mid[0] - rec.origMid[0]),
        y: rec.origLbl.y + (mid[1] - rec.origMid[1]),
        r: rec.origLbl.r
      };
    }
  });
}

function onMouseDown(e) {
  if (drawState.mode !== 'idle') return;
  var node = e.currentTarget;
  var nid  = node.id.replace('N-', '');

  if (e.shiftKey) {
    if (selectedNodes.has(nid)) {
      selectedNodes.delete(nid);
      node.classList.remove('multi-selected');
    } else {
      selectedNodes.add(nid);
      node.classList.add('multi-selected');
    }
    node._suppress = true;
    syncNodeSizeInputs();
    e.stopPropagation();
    return;
  }

  if (!selectedNodes.has(nid)) clearNodeSelection();

  drag.el    = node;
  drag.startX = e.clientX;
  drag.startY = e.clientY;
  drag.origX  = parseInt(node.style.left) || 0;
  drag.origY  = parseInt(node.style.top)  || 0;
  drag.moved  = false;
  drag.axis   = null;
  drag.selectedOrigPositions = null;
  node.style.zIndex = 10;
  node.style.transition = 'none';
  e.preventDefault();
}

document.addEventListener('mousemove', function(e) {
  var s = canvasScale || 1;
  if (drag.el) {
    var dx = e.clientX - drag.startX;
    var dy = e.clientY - drag.startY;
    if (!drag.moved && Math.abs(dx) < 3 && Math.abs(dy) < 3) return;
    if (!drag.moved) {
      pushUndo();
      var _nid = drag.el.id.replace('N-', '');
      var movingIds = [_nid];
      // Capture positions of all selected nodes for group drag
      if (selectedNodes.has(_nid) && selectedNodes.size > 1) {
        drag.selectedOrigPositions = {};
        selectedNodes.forEach(function(sid) {
          var sel = document.getElementById('N-' + sid);
          if (sel) drag.selectedOrigPositions[sid] = { x: parseInt(sel.style.left)||0, y: parseInt(sel.style.top)||0 };
        });
        movingIds = Array.from(selectedNodes);
      }
      straightArrows = [];
      if (!drag.selectedOrigPositions) {
        arrows.forEach(function(a) {
          if (isNodeAnchor(a.src) && isNodeAnchor(a.dst) &&
              (a.src.node === _nid || a.dst.node === _nid)) {
            if (a.waypoints.length === 0) {
              var sPt = resolveAnchor(a.src), dPt = resolveAnchor(a.dst);
              var isH = Math.abs(sPt[1] - dPt[1]) < 1;
              var isV = Math.abs(sPt[0] - dPt[0]) < 1;
              if (isH || isV) {
                straightArrows.push({ id: a.id, movingEnd: a.src.node === _nid ? 'src' : 'dst', isH: isH });
              }
            }
          }
        });
      }
      arrowFollow = captureArrowFollow(movingIds);
      drag.movingIds = movingIds;
      drag.allowed = allowedRect(groupBox(movingIds));
      setMarginGuide(true);
    }
    drag.moved = true;
    drag.el.style.cursor = 'grabbing';
    if (orthoDragMode) {
      if (!drag.axis) drag.axis = Math.abs(dx) >= Math.abs(dy) ? 'h' : 'v';
      if (drag.axis === 'h') dy = 0; else dx = 0;
    }
    // Placed unclamped, then contained as a group below — clamping each node's
    // own left/top here would shear a multi-node selection apart at the edge.
    var nx = drag.origX + dx / s;
    var ny = drag.origY + dy / s;
    drag.el.style.left = nx + 'px';
    drag.el.style.top  = ny + 'px';
    // Move all other selected nodes by the same delta
    if (drag.selectedOrigPositions) {
      var _nid2 = drag.el.id.replace('N-', '');
      var adx = nx - drag.origX, ady = ny - drag.origY;
      Object.keys(drag.selectedOrigPositions).forEach(function(sid) {
        if (sid === _nid2) return;
        var sel = document.getElementById('N-' + sid);
        var op  = drag.selectedOrigPositions[sid];
        if (sel && op) {
          sel.style.left = (op.x + adx) + 'px';
          sel.style.top  = (op.y + ady) + 'px';
        }
      });
    }
    var dragRect = drag.allowed || canvasContentRect();
    containNodes(drag.movingIds || [], dragRect);
    snapNodesToCenters(
      drag.movingIds || [],
      dragRect,
      !orthoDragMode || drag.axis === 'h',
      !orthoDragMode || drag.axis === 'v'
    );
    // Snap near-aligned arrows to straight, then slide fixed anchors of all
    // straight arrows to keep them straight
    trySnapStraight(drag.movingIds);
    straightArrows.forEach(function(sa) {
      var arrow = arrows.find(function(a) { return a.id === sa.id; });
      if (!arrow) return;
      var movingAnchor = sa.movingEnd === 'src' ? arrow.src : arrow.dst;
      var fixedAnchor  = sa.movingEnd === 'src' ? arrow.dst : arrow.src;
      var mPt = resolveAnchor(movingAnchor);
      if (fixedAnchor.arrow) {
        slideTapAnchor(fixedAnchor, mPt[0], mPt[1]);
      } else if (isNodeAnchor(fixedAnchor)) {
        var fb = box('N-' + fixedAnchor.node);
        if (sa.isH) fixedAnchor.fy = Math.max(0, Math.min(1, (mPt[1] - fb.t) / fb.h));
        else        fixedAnchor.fx = Math.max(0, Math.min(1, (mPt[0] - fb.l) / fb.w));
      }
    });
    applyArrowFollow();
    clearSVG();
    drawArrows();
  } else if (resize.el) {
    var scDx = (e.clientX - resize.startX) / s;
    var scDy = (e.clientY - resize.startY) / s;
    var rDeg = parseInt(resize.el.getAttribute('data-rot') || '0');
    var rRad = rDeg * Math.PI / 180;
    var cosR = Math.cos(rRad), sinR = Math.sin(rRad);
    // Rotate screen delta into element-local space (inverse rotation)
    var rdx = scDx * cosR + scDy * sinR;
    var rdy = -scDx * sinR + scDy * cosR;
    var dir = resize.dir;
    var MIN_W = 80, MIN_H = 36;
    // New dimensions in local space
    var rawW = resize.origW + (dir.indexOf('e') >= 0 ? rdx : dir.indexOf('w') >= 0 ? -rdx : 0);
    var rawH = resize.origH + (dir.indexOf('s') >= 0 ? rdy : dir.indexOf('n') >= 0 ? -rdy : 0);
    var nW = Math.max(MIN_W, rawW);
    var nH = Math.max(MIN_H, rawH);
    var dW = nW - resize.origW, dH = nH - resize.origH;
    // wa/ha: which side is moving (+1 right/bottom moves, -1 left/top moves, 0 unchanged)
    var wa = dir.indexOf('e') >= 0 ? 1 : dir.indexOf('w') >= 0 ? -1 : 0;
    var ha = dir.indexOf('s') >= 0 ? 1 : dir.indexOf('n') >= 0 ? -1 : 0;
    // Shift center so the fixed anchor stays at the same screen position
    var cx = resize.origX + resize.origW / 2;
    var cy = resize.origY + resize.origH / 2;
    var dcx = (wa * dW * cosR - ha * dH * sinR) / 2;
    var dcy = (wa * dW * sinR + ha * dH * cosR) / 2;
    resize.el.style.width  = nW + 'px';
    resize.el.style.height = nH + 'px';
    resize.el.style.left   = (cx + dcx - nW / 2) + 'px';
    resize.el.style.top    = (cy + dcy - nH / 2) + 'px';
    // A resize has a fixed anchor edge, so it cannot be nudged back inside the
    // way a drag can — a frame that would push the box past the margin is
    // rejected outright and the last accepted geometry stands. The box stops
    // growing at the boundary line instead of sliding along it.
    var rAllowed = resize.allowed || canvasContentRect();
    var rBox = box(resize.el.id);
    var rd = containDelta(rBox, rAllowed);
    if (rd[0] || rd[1]) {
      var lg = resize.lastGood;
      resize.el.style.width  = lg.w + 'px';
      resize.el.style.height = lg.h + 'px';
      resize.el.style.left   = lg.x + 'px';
      resize.el.style.top    = lg.y + 'px';
    } else {
      resize.lastGood = { w: nW, h: nH, x: cx + dcx - nW / 2, y: cy + dcy - nH / 2 };
    }
    applyArrowFollow();
    clearSVG(); drawArrows();
  }
  if (labelDrag.el) {
    var ldx = e.clientX - labelDrag.startX;
    var ldy = e.clientY - labelDrag.startY;
    // 3px threshold: a plain click on a label is not a drag and must not push undo
    if (labelDrag.moved || Math.abs(ldx) >= 3 || Math.abs(ldy) >= 3) {
      if (!labelDrag.moved) { pushUndo(); labelDrag.moved = true; setMarginGuide(true); }
      var lPt = clampPointToCanvas([labelDrag.origX + ldx / s, labelDrag.origY + ldy / s]);
      var lx = lPt[0], ly = lPt[1];
      var lr = parseFloat(labelDrag.el.getAttribute('data-r')) || 0;
      labelDrag.el.setAttribute('transform', 'translate(' + lx + ',' + ly + ') rotate(' + lr + ')');
      labelDrag.el.setAttribute('data-x', lx);
      labelDrag.el.setAttribute('data-y', ly);
      var existing = labelPositions[labelDrag.key] || {};
      labelPositions[labelDrag.key] = { x: lx, y: ly, r: existing.r != null ? existing.r : lr };
    }
  }
  // Waypoint drag
  if (draggingWaypoint.arrowId !== null) {
    var arr = arrows.find(function(a) { return a.id === draggingWaypoint.arrowId; });
    if (arr) {
      setMarginGuide(true);
      arr.waypoints[draggingWaypoint.idx] = clampPointToCanvas(clientToCanvas(e));
      clearSVG(); drawArrows();
    }
  }
  // Draw mode cursor tracking
  if (drawState.mode === 'src' || drawState.mode === 'waypoints') {
    drawState.cursorPt = clientToCanvas(e);
    var _dcx = drawState.cursorPt[0], _dcy = drawState.cursorPt[1];
    drawState.hoveredNode = getNodeAtCanvasPoint(_dcx, _dcy);
    drawState.edgeSnap = findEdgeSnap(_dcx, _dcy);
    // An existing arrow can be a source tap (branch) or a destination tap
    // (merge). Whichever snap is nearer wins.
    drawState.tapSnap = findArrowTapSnap(_dcx, _dcy, 10, null);
    if (drawState.tapSnap && drawState.edgeSnap) {
      var _de = Math.sqrt(Math.pow(_dcx - drawState.edgeSnap.x, 2) + Math.pow(_dcy - drawState.edgeSnap.y, 2));
      var _dt = Math.sqrt(Math.pow(_dcx - drawState.tapSnap.x,  2) + Math.pow(_dcy - drawState.tapSnap.y,  2));
      if (_de <= _dt) drawState.tapSnap = null; else drawState.edgeSnap = null;
    }
    clearSVG(); drawArrows();
    return;
  }
  // Segment drag
  if (segDrag.active) {
    var sdx = (e.clientX - segDrag.startX) / (canvasScale || 1);
    var sdy = (e.clientY - segDrag.startY) / (canvasScale || 1);
    var perpDelta = segDrag.isH ? sdy : sdx;
    if (!segDrag.moved && Math.abs(perpDelta) < 3) return;
    if (!segDrag.moved) pushUndo();
    segDrag.moved = true;
    applySegmentDrag(sdx, sdy);
    clearSVG(); drawArrows();
    return;
  }
  // Rubber-band selection tracking
  if (rubberBand.active) {
    rubberBand.curX = e.clientX;
    rubberBand.curY = e.clientY;
    clearSVG(); drawArrows();
  }

  // Endpoint drag (reassign arrow src/dst)
  if (endpointDrag.active) {
    var _ept = clientToCanvas(e);
    var _epSnap = findEdgeSnap(_ept[0], _ept[1]);
    endpointDrag.edgeSnap = _epSnap;
    if (!endpointDrag.moved) {
      pushUndo();
      endpointDrag.moved = true;
    }
    var _epArrow = arrows.find(function(a) { return a.id === endpointDrag.arrowId; });
    if (_epArrow) {
      var _epAnchor = endpointDrag.end === 'src' ? _epArrow.src : _epArrow.dst;
      // Dropping either endpoint on another arrow creates a branch or merge.
      // Candidates that already depend on this arrow are skipped so a tap can
      // never close a cycle.
      var _epTap = !_epSnap
        ? findArrowTapSnap(_ept[0], _ept[1], 10, function(cand) {
            return cand.id === _epArrow.id || arrowDependsOn(cand.id, _epArrow.id);
          })
        : null;
      clearAnchor(_epAnchor);
      if (_epSnap) {
        _epAnchor.node = _epSnap.node; _epAnchor.fx = _epSnap.fx; _epAnchor.fy = _epSnap.fy;
      } else if (_epTap) {
        _epAnchor.arrow = _epTap.arrow; _epAnchor.seg = _epTap.seg; _epAnchor.t = _epTap.t;
      } else {
        _epAnchor.free = true; _epAnchor.x = _ept[0]; _epAnchor.y = _ept[1];
      }
      clearSVG(); drawArrows();
    }
  }

  // Arrow hover glow + cursor (idle mode only, no active drags)
  // The hover glow and its ns-/ew-resize cursor advertise a segment drag, so
  // they stay off in read-only rather than promising a gesture that is blocked.
  if (!READONLY && drawState.mode === 'idle' && !drag.el && !resize.el && !labelDrag.el && draggingWaypoint.arrowId === null) {
    var hpt = clientToCanvas(e);
    var hseg = findNearestSegment(hpt[0], hpt[1], 10);
    var newHovId  = hseg ? hseg.arrow.id : null;
    var newSegIdx = hseg ? hseg.segIdx : -1;
    if (newHovId !== hoveredArrowId || newSegIdx !== hoveredSegIdx) {
      hoveredArrowId = newHovId;
      hoveredSegIdx  = newSegIdx;
      hoveredSegIsH  = hseg ? hseg.isH : false;
      var cur = newHovId ? (hoveredSegIsH ? 'ns-resize' : 'ew-resize') : '';
      document.getElementById('canvas').style.cursor = cur;
      clearSVG(); drawArrows();
    }
  }
});

document.addEventListener('mouseup', function() {
  setMarginGuide(false);
  setCenterSnapGuides(null, null);
  if (drag.el) {
    drag.el.style.zIndex = '';
    drag.el.style.transition = '';
    drag.el.style.cursor = 'pointer';
    if (drag.moved) { savePositions(); saveArrows(); saveLabelPositions(); drag.el._suppress = true; }
    drag.el = null;
    drag.selectedOrigPositions = null;
    drag.movingIds = null;
    straightArrows = [];
    arrowFollow = [];
  }
  if (resize.el) {
    resize.el.style.zIndex = '';
    savePositions();
    if (arrowFollow.length > 0) { saveArrows(); saveLabelPositions(); }
    arrowFollow = [];
    resize.el = null; resize.dir = null;
  }
  if (labelDrag.el) {
    labelDrag.el.style.cursor = 'pointer';
    if (labelDrag.moved) saveLabelPositions();
    labelDrag.el = null;
    labelDrag.key = null;
    labelDrag.moved = false;
  }
  if (draggingWaypoint.arrowId !== null) {
    draggingWaypoint = { arrowId: null, idx: null };
    saveArrows();
  }
  if (segDrag.active) {
    segDragJustFinished = segDrag.moved;
    if (segDrag.moved) { saveArrows(); saveLabelPositions(); }
    segDrag.active       = false;
    segDrag.moved        = false;
    segDrag.origLabelPos = null;
  }

  // Rubber-band: finalise selection
  if (rubberBand.active) {
    var rbMoved = Math.abs(rubberBand.curX - rubberBand.startX) > 5 ||
                  Math.abs(rubberBand.curY - rubberBand.startY) > 5;
    if (rbMoved) {
      var _rbCanvas = document.getElementById('canvas').getBoundingClientRect();
      var _x1 = Math.min(rubberBand.startX, rubberBand.curX);
      var _y1 = Math.min(rubberBand.startY, rubberBand.curY);
      var _x2 = Math.max(rubberBand.startX, rubberBand.curX);
      var _y2 = Math.max(rubberBand.startY, rubberBand.curY);
      clearNodeSelection();
      NODE_IDS.forEach(function(id) {
        var el = document.getElementById('N-' + id);
        if (!el) return;
        var er = el.getBoundingClientRect();
        if (er.left < _x2 && er.right > _x1 && er.top < _y2 && er.bottom > _y1) {
          selectedNodes.add(id);
          el.classList.add('multi-selected');
        }
      });
      rubberBandJustFinished = true;
    }
    rubberBand.active = false;
    clearSVG(); drawArrows();
  }

  // Endpoint drag: commit or cancel
  if (endpointDrag.active) {
    if (endpointDrag.moved) {
      saveArrows();
    }
    endpointDrag.active = false;
    endpointDrag.moved  = false;
    endpointDrag.arrowId = null;
    endpointDrag.end     = null;
    endpointDrag.origAnchor = null;
    endpointDrag.edgeSnap   = null;
    clearSVG(); drawArrows();
  }
});

function onResizeStart(e) {
  if (drawState.mode !== 'idle') return;
  pushUndo();
  var node = e.currentTarget.parentElement;
  resize.el    = node;
  resize.dir   = e.currentTarget.getAttribute('data-dir');
  resize.startX = e.clientX; resize.startY = e.clientY;
  resize.origX  = parseInt(node.style.left) || 0;
  resize.origY  = parseInt(node.style.top)  || 0;
  resize.origW  = node.offsetWidth;
  resize.origH  = node.offsetHeight;
  resize.allowed  = allowedRect(box(node.id));
  resize.lastGood = { w: resize.origW, h: resize.origH, x: resize.origX, y: resize.origY };
  arrowFollow = captureArrowFollow([node.id.replace('N-', '')]);
  setMarginGuide(true);
  node.style.zIndex = 10;
  e.stopPropagation(); e.preventDefault();
}


function updateResizeCursors(el) {
  var rDeg = (parseInt(el.getAttribute('data-rot') || '0') % 360 + 360) % 360;
  var steps = Math.round(rDeg / 90) % 4;
  var dirs = ['e','se','s','sw','w','nw','n','ne'];
  var handles = el.querySelectorAll('.rh');
  for (var i = 0; i < handles.length; i++) {
    var base = handles[i].getAttribute('data-dir');
    var idx = dirs.indexOf(base);
    if (idx >= 0) handles[i].style.cursor = dirs[(idx + steps * 2) % 8] + '-resize';
  }
}

function addResizeHandles() {
  var dirs = ['e','w','s','n','se','sw','ne','nw'];
  NODE_IDS.forEach(function(id) {
    var el = document.getElementById('N-' + id);
    if (!el) return;
    dirs.forEach(function(d) {
      var h = document.createElement('div');
      h.className = 'rh rh-' + d;
      h.setAttribute('data-dir', d);
      h.addEventListener('mousedown', onResizeStart);
      el.appendChild(h);
    });
  });
}


// The footer is one line of free text. The document value is the default; an
// unsaved edit lives in localStorage until Save writes it into the document.
var footerText = null;

function loadFooter() {
  var el = document.getElementById('footer-text');
  if (!el) return;
  footerText = DEFAULT_FOOTER_TEXT;
  var stored = lsGet(FOOTER_KEY);
  if (stored !== null) footerText = stored;
  if (footerText !== null) el.textContent = footerText;
  footerText = el.textContent;
}

function wireFooter() {
  var el = document.getElementById('footer-text');
  if (!el || READONLY) return;
  el.setAttribute('contenteditable', 'plaintext-only');
  el.spellcheck = false;
  el.title = 'Click to edit';
  el.addEventListener('keydown', function(e) {
    if (e.key === 'Enter') { e.preventDefault(); el.blur(); }
    if (e.key === 'Escape') { el.textContent = footerText; el.blur(); }
    e.stopPropagation();
  });
  el.addEventListener('blur', function() {
    footerText = el.textContent.replace(/\s+/g, ' ').trim();
    el.textContent = footerText;
    lsSet(FOOTER_KEY, footerText);
  });
}

// Saves the whole diagram state, including font sizes, sidebar width and the
// logical drawing extent, back into the one versioned JSON block in chart.html.
async function saveAll() {
  if (READONLY) return;
  var btn = document.getElementById('save-btn');
  try {
    await getWritableHandle(function(s) { if (btn) btn.textContent = s; });
    if (btn) btn.textContent = 'Saving…';
    var posData = {};
    NODE_IDS.forEach(function(id) {
      var el = document.getElementById('N-' + id);
      if (!el) return;
      var entry = { x: parseInt(el.style.left) || 0, y: parseInt(el.style.top) || 0 };
      if (el.style.width)  entry.w = parseInt(el.style.width);
      if (el.style.height) entry.h = parseInt(el.style.height);
      var r = parseInt(el.getAttribute('data-rot') || '0');
      if (r) entry.r = r;
      posData[id] = entry;
    });
    var file = await fileHandle.getFile();
    var text = await file.text();
    var fontData = {
      label: labelFontSize,
      ntitle: ntitleFontSize,
      nsub: nsubFontSize,
      badge: badgeFontSize
    };
    var canvasData = {
      w: CANVAS_W,
      h: CANVAS_H,
      manual: manualSizeActive,
      scale: manualSizeScale
    };
    text = replaceEmbeddedChartDocument(text, {
      schemaVersion: CHART_DOCUMENT_SCHEMA_VERSION,
      data: DATA,
      canvas: canvasData,
      positions: posData,
      labelPositions: labelPositions,
      deletedNodes: deletedNodes,
      customNodes: customNodes,
      textOverrides: textOverrides,
      styleOverrides: styleOverrides,
      sidebar: sidebarContent,
      arrows: arrows,
      fontSizes: fontData,
      legend: legendState,
      split: splitState,
      footer: footerText
    });
    var writable = await fileHandle.createWritable();
    await writable.write(text);
    await writable.close();
    if (btn) { btn.textContent = 'Saved ✓'; setTimeout(function() { btn.textContent = 'Save'; }, 2000); }
  } catch(e) {
    if (btn) btn.textContent = 'Save';
    if (e.name !== 'AbortError') { alert('Save failed: ' + e.message); fileHandle = null; idbSaveHandle(null).catch(function(){}); }
  }
}

var BADGE_STYLE = {
  impl: 'background:#c8ddf0;color:#1a55a0',
  prog: 'background:#faeec8;color:#8a6008',
  plan: 'background:#e0ddd8;color:#666',
  src:  'background:#c4e4c4;color:#1a5c1a'
};

// Status is part of the saved node metadata, not just the badge text. Infer it
// from the three standard labels for older browser overrides that predate the
// persisted bcls field; unfamiliar labels retain the node's existing state.
function statusClassForBadge(label) {
  var normalized = String(label == null ? '' : label).trim().toLowerCase().replace(/\s+/g, ' ');
  if (normalized === 'implemented') return 'impl';
  if (normalized === 'in progress') return 'prog';
  if (normalized === 'planned') return 'plan';
  return '';
}

function applyNodeStatusClass(el, bcls) {
  if (!el) return;
  el.classList.toggle('prog', bcls === 'prog');
  el.classList.toggle('plan', bcls === 'plan');
}

function redrawFittedCanvas() {
  fitCanvas();
  clearSVG();
  drawArrows();
}

var activeId = null;

function renderMath(el) {
  if (window.renderMathInElement) {
    renderMathInElement(el, {
      delimiters: [
        { left: '$$', right: '$$', display: true },
        { left: '$',  right: '$',  display: false }
      ],
      throwOnError: false
    });
  }
}

function htmlToPlainText(html) {
  return html
    .replace(/<h4[^>]*>([\s\S]*?)<\/h4>/gi, '# $1\n')
    .replace(/<hr\s*\/?>/gi, '---\n')
    .replace(/<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, '[$2]($1)')
    .replace(/<strong[^>]*>([\s\S]*?)<\/strong>/gi, '**$1**')
    .replace(/<em[^>]*>([\s\S]*?)<\/em>/gi, '*$1*')
    .replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, '`$1`')
    .replace(/<p[^>]*>/gi, '').replace(/<\/p>/gi, '\n\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<li[^>]*>/gi, '- ').replace(/<\/li>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&nbsp;/g,' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function sidebarTextToHtml(text) {
  function inlineMarkup(line) {
    return line
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/\*([^*]+)\*/g, '<em>$1</em>')
      .replace(/`([^`]+)`/g, '<code>$1</code>');
  }
  var html = '';
  var buf = [];
  var list = [];
  function flushBuf() {
    if (buf.length) { html += '<p>' + buf.join('<br>') + '</p>'; buf = []; }
  }
  function flushList() {
    if (list.length) {
      html += '<ul>' + list.map(function(i) { return '<li>' + i + '</li>'; }).join('') + '</ul>';
      list = [];
    }
  }
  text.split('\n').forEach(function(line) {
    if (/^#\s+/.test(line)) {
      flushBuf(); flushList();
      html += '<h4>' + inlineMarkup(line.replace(/^#\s+/, '')) + '</h4>';
    } else if (/^---+\s*$/.test(line)) {
      flushBuf(); flushList();
      html += '<hr>';
    } else if (/^[-*]\s+/.test(line)) {
      flushBuf();
      list.push(inlineMarkup(line.replace(/^[-*]\s+/, '')));
    } else if (line.trim() === '') {
      flushBuf(); flushList();
    } else {
      flushList();
      buf.push(inlineMarkup(line));
    }
  });
  flushBuf(); flushList();
  return html;
}

// The front-page sidebar title lives in sidebarContent next to the overview text.
var OVERVIEW_TITLE_KEY = '_overview_title_';
var DEFAULT_OVERVIEW_TITLE = 'Lake Mälaren digital twin';

function overviewTitle() {
  var t = sidebarContent[OVERVIEW_TITLE_KEY];
  return t != null ? t : DEFAULT_OVERVIEW_TITLE;
}

function loadSidebarContent() {
  Object.assign(sidebarContent, DEFAULT_SIDEBAR_OVERRIDES);
  try { Object.assign(sidebarContent, JSON.parse(lsGet(SIDEBAR_KEY) || '{}')); } catch(e) {}
  if (lsGet(SIDEBAR_CONTENT_REVISION_KEY) !== AUTHORITATIVE_CONTENT_REVISION) {
    AUTHORITATIVE_SIDEBAR_IDS.forEach(function(id) {
      sidebarContent[id] = DEFAULT_SIDEBAR_OVERRIDES[id];
    });
    lsSet(SIDEBAR_KEY, JSON.stringify(sidebarContent));
    lsSet(SIDEBAR_CONTENT_REVISION_KEY, AUTHORITATIVE_CONTENT_REVISION);
  }
}

function saveSidebarContent() {
  try { lsSet(SIDEBAR_KEY, JSON.stringify(sidebarContent)); } catch(e) {}
}

function setSidebarView(id) {
  var contentEl = document.getElementById('side-content');
  if (sidebarContent[id] != null) {
    contentEl.innerHTML = sidebarTextToHtml(sidebarContent[id]);
  } else {
    var d = DATA[id] || (customNodes[id] ? {
      html: customNodes[id].nsub ? '<p>' + customNodes[id].nsub.replace(/\n/g,'<br>') + '</p>' : ''
    } : null);
    contentEl.innerHTML = (d && d.html) || '';
  }
  renderMath(contentEl);
}

var _sidebarDebounce = null;

function onSidebarInput() {
  clearTimeout(_sidebarDebounce);
  _sidebarDebounce = setTimeout(function() {
    var ta = document.getElementById('side-textarea');
    if (!ta || !sidebarEditId) return;
    var contentEl = document.getElementById('side-content');
    contentEl.innerHTML = sidebarTextToHtml(ta.value);
    renderMath(contentEl);
  }, 300);
}

function toggleSidebarEdit() {
  var pane = document.getElementById('side-edit-pane');
  if (pane && pane.classList.contains('open')) { cancelSidebarEdit(); return; }
  var editId = activeId || '_overview_';
  sidebarEditId = editId;
  var isOverview = (editId === '_overview_');
  var fields = document.getElementById('side-edit-fields');
  if (fields) fields.style.display = '';
  var bi = document.getElementById('side-badge-input');
  var badgeField = bi && bi.closest('label');
  if (badgeField) badgeField.style.display = isOverview ? 'none' : '';
  var ti = document.getElementById('side-title-input');
  if (isOverview) {
    if (ti) ti.value = overviewTitle();
  } else {
    var m = resolvedNodeMeta(editId);
    if (ti) ti.value = m.title;
    if (bi) bi.value = m.badge;
  }
  var ta = document.getElementById('side-textarea');
  if (ta) {
    if (sidebarContent[editId] != null) {
      ta.value = sidebarContent[editId];
    } else if (isOverview) {
      ta.value = htmlToPlainText(DEFAULT_PANEL_HTML);
    } else {
      ta.value = '';
    }
  }
  if (pane) pane.classList.add('open');
  var btn = document.getElementById('side-edit-btn');
  if (btn) { btn.textContent = 'Close editor'; btn.classList.add('active'); }
  redrawFittedCanvas();
  setTimeout(function() { redrawFittedCanvas(); if (ta) ta.focus(); }, 240);
}

// Live-preview title + status banner in the sidebar header while typing (not
// persisted until Save; cancel restores from the stored metadata).
function onSidebarMetaInput() {
  if (!sidebarEditId) return;
  var ti = document.getElementById('side-title-input');
  var bi = document.getElementById('side-badge-input');
  if (ti) document.getElementById('side-title').textContent = ti.value;
  if (sidebarEditId === '_overview_') return;
  if (bi) {
    var badge = document.getElementById('side-badge');
    badge.textContent = bi.value;
    var bcls = statusClassForBadge(bi.value) || resolvedNodeMeta(sidebarEditId).bcls;
    var style = BADGE_STYLE[bcls] || BADGE_STYLE.plan;
    badge.setAttribute('style', style + ';font-size:11px;padding:2px 6px;border-radius:3px;font-weight:500;');
  }
}

function saveSidebarEdit() {
  var ta = document.getElementById('side-textarea');
  if (!ta || !sidebarEditId) return;
  var id = sidebarEditId;
  sidebarContent[id] = ta.value;
  saveSidebarContent();
  if (id === '_overview_') {
    var overviewTitleInput = document.getElementById('side-title-input');
    if (overviewTitleInput) sidebarContent[OVERVIEW_TITLE_KEY] = overviewTitleInput.value;
    saveSidebarContent();
    showDefaultSidebar();
    return;
  }
  // Title + status banner → same store the canvas box uses (textOverrides), so
  // box and sidebar stay identical; saveAll() bakes it via DEFAULT_TEXT_OVERRIDES.
  var titleInput = document.getElementById('side-title-input');
  var badgeInput = document.getElementById('side-badge-input');
  if (titleInput && badgeInput) {
    var newTitle = titleInput.value;
    var newBadge = badgeInput.value;
    var cur = resolvedNodeMeta(id);           // read nsub before overwriting
    var newBcls = statusClassForBadge(newBadge) || cur.bcls;
    textOverrides[id] = { title: newTitle, badge: newBadge, bcls: newBcls, nsub: cur.nsub };
    saveTextOverrides();
    var el = document.getElementById('N-' + id);
    if (el) {
      var t = el.querySelector('.ntitle'); if (t) t.textContent = newTitle;
      var b = el.querySelector('.badge');  if (b) b.textContent = newBadge;
      applyNodeStatusClass(el, newBcls);
    }
    if (customNodes[id]) {
      customNodes[id].title = newTitle;
      customNodes[id].badge = newBadge;
      saveCustomNodes();
    }
  }
  applySidebarHeader(id);
  setSidebarView(id);
}

function cancelSidebarEdit() {
  var pane = document.getElementById('side-edit-pane');
  if (pane) pane.classList.remove('open');
  if (sidebarEditId === '_overview_') {
    showDefaultSidebar();
  } else if (sidebarEditId) {
    applySidebarHeader(sidebarEditId);   // undo any live header preview
    setSidebarView(sidebarEditId);
  }
  var btn = document.getElementById('side-edit-btn');
  if (btn) { btn.textContent = 'Edit'; btn.classList.remove('active'); }
  sidebarEditId = null;
  redrawFittedCanvas();
  setTimeout(redrawFittedCanvas, 240);
}

// Resolve a node's title/badge/nsub/bcls the same way the canvas box does, so the
// sidebar header is always identical to the box. Persisted text/status overrides
// take precedence over custom-node metadata and DATA.
function resolvedNodeMeta(id) {
  var d  = DATA[id]         || {};
  var cn = customNodes[id]  || {};
  var ov = textOverrides[id] || {};
  var pick = function(a, b, c) {
    if (a != null) return a;
    if (b != null) return b;
    return c != null ? c : '';
  };
  return {
    title: pick(ov.title, cn.title, d.title),
    badge: pick(ov.badge, cn.badge, d.badge),
    nsub:  pick(ov.nsub,  cn.nsub,  d.nsub),
    bcls:  ov.bcls || statusClassForBadge(ov.badge) || cn.bcls || d.bcls || ''
  };
}

// Paint the sidebar header (title + status banner) from the resolved metadata.
function applySidebarHeader(id) {
  var m = resolvedNodeMeta(id);
  document.getElementById('side-title').textContent = m.title;
  var badge = document.getElementById('side-badge');
  badge.textContent = m.badge;
  var style = BADGE_STYLE[m.bcls] || BADGE_STYLE.plan;
  badge.setAttribute('style', style + ';font-size:11px;padding:2px 6px;border-radius:3px;font-weight:500;');
}

function open_panel(id) {
  var node = document.getElementById('N-' + id);
  if (node && node._suppress) { node._suppress = false; return; }
  if (customNodes[id] && customNodes[id].bcls === 'text') return;
  if (!DATA[id] && !customNodes[id]) return;
  if (activeId) {
    var old = document.getElementById('N-' + activeId);
    if (old) old.classList.remove('active');
  }
  if (activeId === id) { close_panel(); return; }
  activeId = id;
  sidebarEditId = null;
  document.getElementById('N-' + id).classList.add('active');
  applySidebarHeader(id);
  syncNodeSizeInputs();
  var btn = document.getElementById('side-edit-btn');
  if (btn) { btn.textContent = 'Edit'; btn.classList.remove('saving', 'active'); }
  setSidebarView(id);
}

function close_panel() {
  if (activeId) {
    var old = document.getElementById('N-' + activeId);
    if (old) old.classList.remove('active');
  }
  var pane = document.getElementById('side-edit-pane');
  if (pane && pane.classList.contains('open')) { pane.classList.remove('open'); redrawFittedCanvas(); setTimeout(redrawFittedCanvas, 240); }
  showDefaultSidebar();
}

// Numeric box sizing. A normal box click makes that box the target; shift-click
// can build a multi-selection, allowing one exact size to be applied uniformly.
function nodeSizeTargets() {
  if (selectedNodes.size) return Array.from(selectedNodes);
  return activeId ? [activeId] : [];
}

function syncNodeSizeInputs() {
  var wi = document.getElementById('node-w-input');
  var hi = document.getElementById('node-h-input');
  var ids = nodeSizeTargets();
  var el = ids.length ? document.getElementById('N-' + ids[0]) : null;
  if (wi) wi.value = el ? Math.round(el.offsetWidth) : '';
  if (hi) hi.value = el ? Math.round(el.offsetHeight) : '';
  if (wi) wi.disabled = !el;
  if (hi) hi.disabled = !el;
}

function setNodeSizeFromInputs() {
  var wi = document.getElementById('node-w-input');
  var hi = document.getElementById('node-h-input');
  var w = parseFloat(wi && wi.value), h = parseFloat(hi && hi.value);
  var ids = nodeSizeTargets();
  if (!isFinite(w) || !isFinite(h) || !ids.length) {
    syncNodeSizeInputs();
    return;
  }
  w = Math.min(20000, Math.max(80, Math.round(w)));
  h = Math.min(20000, Math.max(36, Math.round(h)));
  var changed = false;
  ids.forEach(function(id) {
    var el = document.getElementById('N-' + id);
    if (!el) return;
    var oldW = el.offsetWidth, oldH = el.offsetHeight;
    if (oldW !== w || oldH !== h) changed = true;
  });
  if (!changed) { syncNodeSizeInputs(); return; }
  pushUndo();
  ids.forEach(function(id) {
    var el = document.getElementById('N-' + id);
    if (!el) return;
    el.style.width = w + 'px';
    el.style.height = h + 'px';
    updateResizeCursors(el);
  });
  applyArrowFollow();
  savePositions();
  clearSVG();
  drawArrows();
  syncNodeSizeInputs();
}

function wireNodeSizeInputs() {
  ['node-w-input', 'node-h-input'].forEach(function(id) {
    var input = document.getElementById(id);
    if (!input) return;
    input.addEventListener('change', setNodeSizeFromInputs);
    input.addEventListener('keydown', function(e) {
      if (e.key === 'Enter') input.blur();
      e.stopPropagation();
    });
  });
  syncNodeSizeInputs();
}

function box(id) {
  var el = document.getElementById(id);
  var canvas = document.getElementById('canvas');
  if (!el || !canvas) return { t:0, b:0, l:0, r:0, cx:0, cy:0, w:0, h:0 };
  var cr = canvas.getBoundingClientRect();
  var r  = el.getBoundingClientRect();
  var s = canvasScale || 1;
  return {
    t:  (r.top    - cr.top)  / s,
    b:  (r.bottom - cr.top)  / s,
    l:  (r.left   - cr.left) / s,
    r:  (r.right  - cr.left) / s,
    cx: (r.left   - cr.left + r.width  / 2) / s,
    cy: (r.top    - cr.top  + r.height / 2) / s,
    w:  r.width  / s,
    h:  r.height / s
  };
}

// ---------------------------------------------------------------------------
// Containment — keep dragged/resized content inside the chart area's margin.
//
// box() reads getBoundingClientRect(), so these work on the *visual* extent
// and stay correct for rotated nodes.
//
// A layout may already hold content outside the margin (baked-in coordinates,
// or a canvas shrunk after the fact). Confining such content on first touch
// would silently relocate it, so the allowed rect is the union of the margin
// rect and where the content already was at grab time: content inside stays
// inside, content outside can be moved anywhere within its own start extent
// but never further out.
// ---------------------------------------------------------------------------
function unionBox(p, q) {
  if (!p) return q;
  if (!q) return p;
  return { l: Math.min(p.l, q.l), t: Math.min(p.t, q.t),
           r: Math.max(p.r, q.r), b: Math.max(p.b, q.b) };
}

function allowedRect(startBox) {
  var cr = canvasContentRect();
  if (!startBox) return cr;
  return { l: Math.min(cr.l, startBox.l), t: Math.min(cr.t, startBox.t),
           r: Math.max(cr.r, startBox.r), b: Math.max(cr.b, startBox.b) };
}

// Shift needed to bring `bx` back inside `rect`. A box wider/taller than the
// rect is pinned to the rect's near edge rather than jittering between edges.
function containDelta(bx, rect) {
  var dx = 0, dy = 0;
  if (bx.l < rect.l)      dx = rect.l - bx.l;
  else if (bx.r > rect.r) dx = Math.min(0, rect.r - bx.r);
  if (bx.t < rect.t)      dy = rect.t - bx.t;
  else if (bx.b > rect.b) dy = Math.min(0, rect.b - bx.b);
  return [dx, dy];
}

// Union of the current visual extents of `ids`, in logical canvas units.
function groupBox(ids) {
  var u = null;
  ids.forEach(function(id) {
    var el = document.getElementById('N-' + id);
    if (el) u = unionBox(u, box('N-' + id));
  });
  return u;
}

// Move `ids` by the shift that brings their union back inside `rect`, so a
// multi-node drag keeps its relative layout.
function containNodes(ids, rect) {
  var u = groupBox(ids);
  if (!u) return;
  var d = containDelta(u, rect);
  if (!d[0] && !d[1]) return;
  ids.forEach(function(id) {
    var el = document.getElementById('N-' + id);
    if (!el) return;
    el.style.left = ((parseFloat(el.style.left) || 0) + d[0]) + 'px';
    el.style.top  = ((parseFloat(el.style.top)  || 0) + d[1]) + 'px';
  });
}

// Centre-to-centre alignment while nodes move. The threshold is expressed in
// screen pixels so snapping feels the same at every canvas scale. Comparisons
// use box(), making them visual-centre comparisons for resized/rotated nodes.
var CENTER_SNAP_PX = 8;

function setCenterSnapGuides(x, y) {
  var s = canvasScale || 1;
  var thickness = Math.max(0.5, 1 / s);
  var gx = document.getElementById('center-snap-guide-x');
  var gy = document.getElementById('center-snap-guide-y');
  if (gx) {
    gx.classList.toggle('show', x !== null);
    if (x !== null) {
      gx.style.left = (x - thickness / 2) + 'px';
      gx.style.width = thickness + 'px';
    }
  }
  if (gy) {
    gy.classList.toggle('show', y !== null);
    if (y !== null) {
      gy.style.top = (y - thickness / 2) + 'px';
      gy.style.height = thickness + 'px';
    }
  }
}

function snapNodesToCenters(ids, rect, allowX, allowY) {
  if (!ids || !ids.length) {
    setCenterSnapGuides(null, null);
    return;
  }
  var moving = new Set(ids);
  var threshold = CENTER_SNAP_PX / (canvasScale || 1);
  var currentGroup = groupBox(ids);
  var bestX = null, bestY = null;

  ids.forEach(function(movingId) {
    var movingEl = document.getElementById('N-' + movingId);
    if (!movingEl || movingEl.style.display === 'none') return;
    var mb = box('N-' + movingId);
    NODE_IDS.forEach(function(fixedId) {
      if (moving.has(fixedId)) return;
      var fixedEl = document.getElementById('N-' + fixedId);
      if (!fixedEl || fixedEl.style.display === 'none') return;
      var fb = box('N-' + fixedId);
      var dx = fb.cx - mb.cx;
      var dy = fb.cy - mb.cy;
      if (allowX && Math.abs(dx) <= threshold &&
          (!bestX || Math.abs(dx) < Math.abs(bestX.delta)) &&
          currentGroup.l + dx >= rect.l && currentGroup.r + dx <= rect.r) {
        bestX = { delta: dx, guide: fb.cx };
      }
      if (allowY && Math.abs(dy) <= threshold &&
          (!bestY || Math.abs(dy) < Math.abs(bestY.delta)) &&
          currentGroup.t + dy >= rect.t && currentGroup.b + dy <= rect.b) {
        bestY = { delta: dy, guide: fb.cy };
      }
    });
  });

  var snapDx = bestX ? bestX.delta : 0;
  var snapDy = bestY ? bestY.delta : 0;
  if (snapDx || snapDy) {
    ids.forEach(function(id) {
      var el = document.getElementById('N-' + id);
      if (!el) return;
      el.style.left = ((parseFloat(el.style.left) || 0) + snapDx) + 'px';
      el.style.top  = ((parseFloat(el.style.top)  || 0) + snapDy) + 'px';
    });
  }
  setCenterSnapGuides(bestX ? bestX.guide : null, bestY ? bestY.guide : null);
}

function clampPointToCanvas(pt) {
  var cr = canvasContentRect();
  return [Math.max(cr.l, Math.min(cr.r, pt[0])),
          Math.max(cr.t, Math.min(cr.b, pt[1]))];
}

// Visual extent of everything drawn on the canvas — every live node plus every
// arrow waypoint. Backs fitCanvasToContent() and the shrink limit on the stage
// resize handles. Returns null on an empty canvas.
function contentBounds() {
  var u = null;
  NODE_IDS.forEach(function(id) {
    var el = document.getElementById('N-' + id);
    if (!el || el.style.display === 'none') return;
    u = unionBox(u, box('N-' + id));
  });
  (arrows || []).forEach(function(a) {
    (a.waypoints || []).forEach(function(p) {
      u = unionBox(u, { l: p[0], t: p[1], r: p[0], b: p[1] });
    });
  });
  return u;
}

function clearSVG() {
  var svg = document.getElementById('svgl');
  var ch = Array.prototype.slice.call(svg.childNodes);
  ch.forEach(function(c) { if (c.tagName !== 'defs') svg.removeChild(c); });
}

function seg(pts, clr, mkr, dash) {
  var svg = document.getElementById('svgl');
  // Snap near-orthogonal segments to exactly H or V so marker-end never rotates
  var sp = pts.map(function(p) { return p.slice(); });
  for (var k = 1; k < sp.length; k++) {
    var adx = Math.abs(sp[k][0] - sp[k-1][0]), ady = Math.abs(sp[k][1] - sp[k-1][1]);
    if (ady < 1.5 && adx >= ady) sp[k][1] = sp[k-1][1];   // nearly H → exact H
    else if (adx < 1.5 && ady > adx) sp[k][0] = sp[k-1][0]; // nearly V → exact V
  }
  var d = 'M' + sp[0][0] + ',' + sp[0][1];
  for (var i = 1; i < sp.length; i++) d += ' L' + sp[i][0] + ',' + sp[i][1];
  var p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  p.setAttribute('d', d);
  p.setAttribute('fill', 'none');
  p.setAttribute('stroke', clr);
  p.setAttribute('stroke-width', '1.4');
  if (dash) p.setAttribute('stroke-dasharray', '5,3');
  p.setAttribute('marker-end', 'url(#' + mkr + ')');
  p.setAttribute('pointer-events', 'none');
  svg.appendChild(p);
}

function lbl(defaultX, defaultY, txt, clr, anchor, _rotate, key) {
  var svg = document.getElementById('svgl');
  var pos = key && labelPositions[key];
  var px = pos ? pos.x : defaultX;
  var py = pos ? pos.y : defaultY;
  var pr = (pos && pos.r != null) ? pos.r : 0;

  var g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  g.setAttribute('transform', 'translate(' + px + ',' + py + ') rotate(' + pr + ')');
  g.setAttribute('data-x', px);
  g.setAttribute('data-y', py);
  g.setAttribute('data-r', pr);
  if (key) {
    g.style.cursor = 'pointer';
    g.style.pointerEvents = 'all';
    // Native browser tooltip (drag hints only make sense when editing)
    if (!READONLY) {
      var title = document.createElementNS('http://www.w3.org/2000/svg', 'title');
      title.textContent = 'Drag to move · Right-click to rotate 90° · Double-click to edit';
      g.appendChild(title);
    }
  } else {
    g.style.pointerEvents = 'none';
  }

  var lineH = labelFontSize + 2;
  var lines = txt.split('\n');
  // Invisible hit-area rect so the group responds to pointer events even on sparse text
  var hitRect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
  var estW = Math.max(...lines.map(function(l) { return l.length; })) * labelFontSize * 0.6 + 12;
  var estH = lines.length * lineH + 8;
  hitRect.setAttribute('x', (anchor === 'start' ? -4 : anchor === 'end' ? -estW + 4 : -estW / 2));
  hitRect.setAttribute('y', -lineH + 2);
  hitRect.setAttribute('width', estW);
  hitRect.setAttribute('height', estH);
  hitRect.setAttribute('fill', 'transparent');
  g.appendChild(hitRect);

  lines.forEach(function(line, i) {
    var t = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    t.setAttribute('x', 0);
    t.setAttribute('y', i * lineH);
    t.setAttribute('text-anchor', anchor || 'middle');
    t.setAttribute('fill', clr || '#333');
    t.setAttribute('font-size', labelFontSize);
    t.setAttribute('font-family', 'system-ui,sans-serif');
    t.textContent = line;
    g.appendChild(t);
  });

  if (key) {
    // Stop single clicks from reaching the canvas handler (which would redraw SVG,
    // destroying this element before the second click of a dblclick arrives).
    g.addEventListener('click', function(e) { e.stopPropagation(); });

    g.addEventListener('mouseenter', function() {
      g.style.filter = 'drop-shadow(0 0 4px ' + (clr || '#3b7dd8') + ')';
    });
    g.addEventListener('mouseleave', function() {
      g.style.filter = '';
    });

    g.addEventListener('mousedown', function(e) {
      labelDrag.el    = g;
      labelDrag.key   = key;
      labelDrag.moved = false;
      labelDrag.startX = e.clientX;
      labelDrag.startY = e.clientY;
      labelDrag.origX  = parseFloat(g.getAttribute('data-x')) || 0;
      labelDrag.origY  = parseFloat(g.getAttribute('data-y')) || 0;
      g.style.cursor = 'grabbing';
      e.stopPropagation();
    });
    g.addEventListener('contextmenu', function(e) {
      e.preventDefault();
      rotateLabelClockwise(key, g);
    });
    g.addEventListener('dblclick', function(e) {
      e.stopPropagation();
      showLabelContextMenu(e, key, g);
    });
  }

  svg.appendChild(g);
}
