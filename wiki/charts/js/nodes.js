// ── Custom node creation ─────────────────────────────────────────────────────

function wireCustomNode(el, id) {
  el.title = NODE_TIP;
  el.addEventListener('mousedown', onMouseDown);
  el.style.cursor = 'pointer';
  el.addEventListener('dblclick', function(e) { showNodeContextMenu(e, id); });
  el.addEventListener('contextmenu', function(e) {
    e.preventDefault(); e.stopPropagation();
    ctxNodeId = id;
    ctxRotateNode();
  });
  var dirs = ['e','w','s','n','se','sw','ne','nw'];
  dirs.forEach(function(d) {
    var h = document.createElement('div');
    h.className = 'rh rh-' + d;
    h.setAttribute('data-dir', d);
    h.addEventListener('mousedown', onResizeStart);
    el.appendChild(h);
  });
}

function createCustomNodeEl(nd) {
  var cls = 'node';
  if (nd.bcls === 'src')  cls += ' src';
  if (nd.bcls === 'prog') cls += ' prog';
  if (nd.bcls === 'plan') cls += ' plan';
  if (nd.bcls === 'text') cls += ' text-only';

  var el = document.createElement('div');
  el.className = cls;
  el.id = 'N-' + nd.id;
  el.style.cssText = 'width:' + (nd.w || 200) + 'px;left:' + (nd.x || 400) + 'px;top:' + (nd.y || 350) + 'px;';
  el.setAttribute('onclick', "open_panel('" + nd.id + "')");

  var head = document.createElement('div');
  head.className = 'node-head';
  head.innerHTML = '<div class="dot"></div><span class="ntitle">' +
    nd.title + '</span><span class="badge">' + (nd.badge || '') + '</span>';
  el.appendChild(head);

  var sub = document.createElement('div');
  sub.className = 'nsub';
  sub.textContent = nd.nsub || '';
  el.appendChild(sub);

  document.getElementById('canvas').appendChild(el);
  if (NODE_IDS.indexOf(nd.id) < 0) NODE_IDS.push(nd.id);
  customNodes[nd.id] = nd;
  wireCustomNode(el, nd.id);
  return el;
}

function saveCustomNodes() {
  try { lsSet(CUSTOM_NODES_KEY, JSON.stringify(customNodes)); } catch(e) {}
}

function loadCustomNodes() {
  var merged = Object.assign({}, DEFAULT_CUSTOM_NODES);
  try {
    var ls = JSON.parse(lsGet(CUSTOM_NODES_KEY) || '{}');
    Object.assign(merged, ls);
  } catch(e) {}
  Object.keys(merged).forEach(function(id) {
    if (deletedNodes.indexOf(id) < 0) createCustomNodeEl(merged[id]);
  });
}

function showAddNodeDialog() {
  var dlg = document.getElementById('add-node-dialog');
  if (!dlg) return;
  document.getElementById('an-title').value = '';
  document.getElementById('an-badge').value = '';
  document.getElementById('an-nsub').value  = '';
  addNodeSelectedColor = null;
  var row = document.getElementById('an-color-row');
  if (row) {
    var swatches = row.querySelectorAll('div');
    swatches.forEach(function(s) { s.style.borderColor = 'transparent'; });
    if (swatches[0]) swatches[0].style.borderColor = '#333';
  }
  dlg.style.display = 'block';
  document.getElementById('an-title').focus();
}

function hideAddNodeDialog() {
  var dlg = document.getElementById('add-node-dialog');
  if (dlg) dlg.style.display = 'none';
}

function confirmAddNode() {
  pushUndo();
  var title = document.getElementById('an-title').value.trim();
  if (!title) { document.getElementById('an-title').focus(); return; }
  var badge = document.getElementById('an-badge').value.trim();
  var nsub  = document.getElementById('an-nsub').value.trim();
  var bcls  = '';
  var id    = 'cnode_' + Date.now();
  var nd = { id: id, title: title, badge: badge, bcls: bcls, nsub: nsub,
             x: CANVAS_W - 240, y: Math.round(CANVAS_H / 2 - 35), w: 200 };
  createCustomNodeEl(nd);
  if (addNodeSelectedColor) {
    applyNodeStyle(id, addNodeSelectedColor);
    styleOverrides[id] = addNodeSelectedColor;
    saveStyleOverrides();
  }
  saveCustomNodes();
  hideAddNodeDialog();
  clearSVG(); drawArrows();
}

// ── Node context menu ────────────────────────────────────────────────────────
var ctxNodeId = null;
var ctxLabelKey = null;
var ctxLabelEl = null;

function showNodeContextMenu(e, id) {
  e.preventDefault();
  e.stopPropagation();
  ctxNodeId = id;
  var menu = document.getElementById('node-ctx-menu');
  if (!menu) return;
  menu.style.left = Math.min(e.clientX, window.innerWidth  - 200) + 'px';
  menu.style.top  = Math.min(e.clientY, window.innerHeight - 100) + 'px';
  menu.style.display = 'block';
}

function hideNodeContextMenu() {
  var menu = document.getElementById('node-ctx-menu');
  if (menu) menu.style.display = 'none';
  ctxNodeId = null;
}

function rotateLabelClockwise(key, g) {
  if (!key || READONLY) return;
  pushUndo();
  var cur = parseFloat(g.getAttribute('data-r')) || 0;
  var next = (cur + 90) % 360;
  var cx = parseFloat(g.getAttribute('data-x')) || 0;
  var cy = parseFloat(g.getAttribute('data-y')) || 0;
  g.setAttribute('data-r', next);
  g.setAttribute('transform', 'translate(' + cx + ',' + cy + ') rotate(' + next + ')');
  labelPositions[key] = labelPositions[key] || { x: cx, y: cy };
  labelPositions[key].r = next;
  saveLabelPositions();
}

function showLabelContextMenu(e, key, g) {
  if (READONLY) return;
  e.preventDefault();
  e.stopPropagation();
  ctxLabelKey = key;
  ctxLabelEl = g;
  var menu = document.getElementById('label-ctx-menu');
  if (!menu) return;
  menu.style.left = Math.min(e.clientX, window.innerWidth - 180) + 'px';
  menu.style.top  = Math.min(e.clientY, window.innerHeight - 70) + 'px';
  menu.style.display = 'block';
}

function hideLabelContextMenu() {
  var menu = document.getElementById('label-ctx-menu');
  if (menu) menu.style.display = 'none';
  ctxLabelKey = null;
  ctxLabelEl = null;
}

function ctxRotateLabel() {
  if (ctxLabelKey && ctxLabelEl) rotateLabelClockwise(ctxLabelKey, ctxLabelEl);
  hideLabelContextMenu();
}

function ctxEditLabel() {
  if (ctxLabelKey && ctxLabelEl) showLabelEditor(ctxLabelKey, ctxLabelEl);
  hideLabelContextMenu();
}

function ctxRotateNode() {
  if (!ctxNodeId) return;
  pushUndo();
  var el = document.getElementById('N-' + ctxNodeId);
  if (el) {
    var cur = parseInt(el.getAttribute('data-rot') || '0');
    var next = (cur + 90) % 360;
    if (next === 0) { el.removeAttribute('data-rot'); el.style.transform = ''; }
    else            { el.setAttribute('data-rot', next); el.style.transform = 'rotate(' + next + 'deg)'; }
    updateResizeCursors(el);
    savePositions();
    clearSVG(); drawArrows();
  }
  hideNodeContextMenu();
}

function ctxDeleteNode() {
  if (!ctxNodeId) return;
  deleteNode(ctxNodeId);
  hideNodeContextMenu();
}

function deleteNode(id) {
  pushUndo();
  var el = document.getElementById('N-' + id);
  if (el && el.parentNode) el.parentNode.removeChild(el);
  var idx = NODE_IDS.indexOf(id);
  if (idx >= 0) NODE_IDS.splice(idx, 1);
  // Remove connected arrows, then any branch left hanging off one of them
  arrows = arrows.filter(function(a) { return a.src.node !== id && a.dst.node !== id; });
  pruneOrphanBranches();
  saveArrows();
  if (activeId === id) close_panel();
  savePositions();
  if (customNodes[id]) { delete customNodes[id]; saveCustomNodes(); }
  deletedNodes.push(id);
  try { lsSet(DELETED_NODES_KEY, JSON.stringify(deletedNodes)); } catch(e) {}
  clearSVG(); drawArrows();
}

function loadDeletedNodes() {
  var saved = DEFAULT_DELETED_NODES.slice();
  try {
    var ls = JSON.parse(lsGet(DELETED_NODES_KEY) || '[]');
    if (Array.isArray(ls)) ls.forEach(function(id) { if (saved.indexOf(id) < 0) saved.push(id); });
  } catch(e) {}
  saved.forEach(function(id) {
    var el = document.getElementById('N-' + id);
    if (el && el.parentNode) el.parentNode.removeChild(el);
    var idx = NODE_IDS.indexOf(id);
    if (idx >= 0) NODE_IDS.splice(idx, 1);
    if (deletedNodes.indexOf(id) < 0) deletedNodes.push(id);
  });
}

function loadLabelFontSize() {
  try {
    var v = parseFloat(lsGet(LABEL_FONT_SIZE_KEY));
    if (!isNaN(v) && v >= 6) labelFontSize = v;
  } catch(e) {}
  var inp = document.getElementById('label-font-size');
  if (inp) inp.value = labelFontSize;
}

function applyNodeFontSizes() {
  var root = document.documentElement;
  root.style.setProperty('--ntitle-fs', ntitleFontSize + 'px');
  root.style.setProperty('--nsub-fs',   nsubFontSize   + 'px');
  root.style.setProperty('--badge-fs',  badgeFontSize  + 'px');
}

function loadNodeFontSizes() {
  try {
    var v = parseFloat(lsGet(NTITLE_FONT_SIZE_KEY));
    if (!isNaN(v) && v >= 6) ntitleFontSize = v;
  } catch(e) {}
  try {
    var v = parseFloat(lsGet(NSUB_FONT_SIZE_KEY));
    if (!isNaN(v) && v >= 6) nsubFontSize = v;
  } catch(e) {}
  try {
    var v = parseFloat(lsGet(BADGE_FONT_SIZE_KEY));
    if (!isNaN(v) && v >= 6) badgeFontSize = v;
  } catch(e) {}
  var ti = document.getElementById('ntitle-font-size');
  var si = document.getElementById('nsub-font-size');
  var bi = document.getElementById('badge-font-size');
  if (ti) ti.value = ntitleFontSize;
  if (si) si.value = nsubFontSize;
  if (bi) bi.value = badgeFontSize;
  applyNodeFontSizes();
}

function clearNodeSelection() {
  selectedNodes.forEach(function(id) {
    var el = document.getElementById('N-' + id);
    if (el) el.classList.remove('multi-selected');
  });
  selectedNodes.clear();
  syncNodeSizeInputs();
}

function addFloatingText() {
  pushUndo();
  var id = 'cnode_' + Date.now();
  var nd = { id: id, title: '', badge: '', bcls: 'text', nsub: 'Text label',
             x: Math.round(CANVAS_W / 2 - 75), y: Math.round(CANVAS_H / 2 - 20), w: 150 };
  createCustomNodeEl(nd);
  saveCustomNodes();
  clearSVG(); drawArrows();
}

function ctxDuplicateNode() {
  if (!ctxNodeId) return;
  pushUndo();
  var id  = ctxNodeId;
  var el  = document.getElementById('N-' + id);
  var ov  = textOverrides[id] || {};
  var cn  = customNodes[id]   || {};
  var d   = DATA[id]          || {};
  var title = ov.title != null ? ov.title : (cn.title || d.title || '');
  var badge = ov.badge != null ? ov.badge : (cn.badge || d.badge || '');
  var nsub  = ov.nsub  != null ? ov.nsub  : (cn.nsub  || '');
  var bcls  = cn.bcls  || (el && el.classList.contains('src')  ? 'src'  :
                            el && el.classList.contains('prog') ? 'prog' :
                            el && el.classList.contains('plan') ? 'plan' : '');
  var x = (parseInt(el && el.style.left) || 0) + 30;
  var y = (parseInt(el && el.style.top)  || 0) + 30;
  var w = parseInt(el && el.style.width) || 200;
  var newId = 'cnode_' + Date.now();
  var nd = { id: newId, title: title, badge: badge, bcls: bcls, nsub: nsub, x: x, y: y, w: w };
  createCustomNodeEl(nd);
  if (styleOverrides[id]) {
    applyNodeStyle(newId, styleOverrides[id]);
    styleOverrides[newId] = styleOverrides[id];
    saveStyleOverrides();
  }
  saveCustomNodes();
  hideNodeContextMenu();
  clearSVG(); drawArrows();
}

function buildArrowEditColorSwatches() {
  var container = document.getElementById('label-edit-arrow-colors');
  if (!container) return;
  arrowEditColor = ARROW_COLORS[0]; // safe: ARROW_COLORS is now defined
  ARROW_COLORS.forEach(function(c, i) {
    var sw = document.createElement('div');
    sw.setAttribute('data-color', c.hex);
    sw.title = c.name;
    sw.style.cssText = 'width:20px;height:20px;border-radius:50%;cursor:pointer;background:' + c.hex +
      ';border:3px solid ' + (i === 0 ? '#111' : 'transparent') + ';flex-shrink:0;box-sizing:border-box;';
    sw.addEventListener('click', function() {
      container.querySelectorAll('div').forEach(function(s) { s.style.borderColor = 'transparent'; });
      sw.style.borderColor = '#111';
      arrowEditColor = c;
    });
    container.appendChild(sw);
  });
}

function buildAddNodeColorSwatches() {
  var row = document.getElementById('an-color-row');
  if (!row) return;
  var rst = document.createElement('div');
  rst.title = 'No color';
  rst.style.cssText = 'width:16px;height:16px;border-radius:50%;cursor:pointer;flex-shrink:0;border:2px solid #333;background:linear-gradient(to bottom right,transparent calc(50% - 0.7px),#bbb calc(50% - 0.7px),#bbb calc(50% + 0.7px),transparent calc(50% + 0.7px));';
  rst.addEventListener('click', function() {
    row.querySelectorAll('div').forEach(function(s) { s.style.borderColor = 'transparent'; });
    rst.style.borderColor = '#333';
    addNodeSelectedColor = null;
  });
  row.appendChild(rst);
  NODE_COLOR_PALETTE.forEach(function(c) {
    var sw = document.createElement('div');
    sw.title = c.label;
    sw.style.cssText = 'width:16px;height:16px;border-radius:50%;cursor:pointer;flex-shrink:0;border:2px solid transparent;background:' + c.dot + ';';
    sw.addEventListener('mouseenter', function() { if (addNodeSelectedColor !== c) sw.style.borderColor = '#999'; });
    sw.addEventListener('mouseleave', function() { if (addNodeSelectedColor !== c) sw.style.borderColor = 'transparent'; });
    sw.addEventListener('click', function() {
      row.querySelectorAll('div').forEach(function(s) { s.style.borderColor = 'transparent'; });
      sw.style.borderColor = '#333';
      addNodeSelectedColor = c;
    });
    row.appendChild(sw);
  });
}

var editNodeSelectedColor = undefined; // undefined = no change, null = reset, obj = new color

function buildEditNodeColorSwatches() {
  var row = document.getElementById('nte-color-row');
  if (!row) return;
  var rst = document.createElement('div');
  rst.id = 'nte-color-reset';
  rst.title = 'No color';
  rst.style.cssText = 'width:16px;height:16px;border-radius:50%;cursor:pointer;flex-shrink:0;border:2px solid transparent;background:linear-gradient(to bottom right,transparent calc(50% - 0.7px),#bbb calc(50% - 0.7px),#bbb calc(50% + 0.7px),transparent calc(50% + 0.7px));';
  rst.addEventListener('click', function() {
    row.querySelectorAll('div').forEach(function(s) { s.style.borderColor = 'transparent'; });
    rst.style.borderColor = '#333';
    editNodeSelectedColor = null;
  });
  row.appendChild(rst);
  NODE_COLOR_PALETTE.forEach(function(c) {
    var sw = document.createElement('div');
    sw.setAttribute('data-dot', c.dot);
    sw.title = c.label;
    sw.style.cssText = 'width:16px;height:16px;border-radius:50%;cursor:pointer;flex-shrink:0;border:2px solid transparent;background:' + c.dot + ';';
    sw.addEventListener('mouseenter', function() { if (editNodeSelectedColor !== c) sw.style.borderColor = '#999'; });
    sw.addEventListener('mouseleave', function() { if (editNodeSelectedColor !== c) sw.style.borderColor = 'transparent'; });
    sw.addEventListener('click', function() {
      row.querySelectorAll('div').forEach(function(s) { s.style.borderColor = 'transparent'; });
      sw.style.borderColor = '#333';
      editNodeSelectedColor = c;
    });
    row.appendChild(sw);
  });
}

function syncEditNodeColorSwatches(id) {
  var row = document.getElementById('nte-color-row');
  if (!row) return;
  var current = styleOverrides[id];
  editNodeSelectedColor = undefined;
  row.querySelectorAll('div').forEach(function(s) { s.style.borderColor = 'transparent'; });
  if (!current) {
    var rst = document.getElementById('nte-color-reset');
    if (rst) rst.style.borderColor = '#333';
    editNodeSelectedColor = undefined;
  } else {
    row.querySelectorAll('div[data-dot]').forEach(function(s) {
      if (s.getAttribute('data-dot') === current.dot) {
        s.style.borderColor = '#333';
        editNodeSelectedColor = current;
      }
    });
  }
}

function syncArrowEditColorSwatches(hex) {
  var container = document.getElementById('label-edit-arrow-colors');
  if (!container) return;
  container.querySelectorAll('div').forEach(function(sw) {
    sw.style.borderColor = sw.getAttribute('data-color') === hex ? '#111' : 'transparent';
  });
  arrowEditColor = ARROW_COLORS.find(function(c) { return c.hex === hex; }) || ARROW_COLORS[0];
}

function positionPopup(popup, preferX, preferY) {
  popup.style.visibility = 'hidden';
  popup.style.display = 'block';
  var pw = popup.offsetWidth  || 280;
  var ph = popup.offsetHeight || 200;
  popup.style.display = 'none';
  popup.style.visibility = '';
  var margin = 8;
  var x = Math.max(margin, Math.min(preferX, window.innerWidth  - pw - margin));
  var y = Math.max(margin, Math.min(preferY, window.innerHeight - ph - margin));
  popup.style.left = x + 'px';
  popup.style.top  = y + 'px';
}

function showLabelEditor(key, g) {
  var arrow = arrows.find(function(a) { return a.label && a.label.key === key; });
  if (!arrow) return;
  var popup = document.getElementById('label-edit-popup');
  var ta    = document.getElementById('label-edit-text');
  if (!popup || !ta) return;
  var rect = g.getBoundingClientRect();
  positionPopup(popup, rect.left + rect.width / 2 - 110, rect.top - 10);
  ta.value = arrow.label.text;
  syncArrowEditColorSwatches(arrow.color);
  var dashed = document.getElementById('edit-dashed');
  if (dashed) dashed.checked = !!arrow.dashed;
  popup._key = key;
  popup.style.display = 'block';
  ta.focus(); ta.select();
}

function hideLabelEdit() {
  var popup = document.getElementById('label-edit-popup');
  if (popup) popup.style.display = 'none';
}

function openArrowEditPopup(arrow, clientX, clientY) {
  var key = arrow.label && arrow.label.key;
  var popup = document.getElementById('label-edit-popup');
  var ta    = document.getElementById('label-edit-text');
  if (!popup || !ta) return;
  positionPopup(popup, clientX - 125, clientY + 10);
  ta.value = (arrow.label && arrow.label.text) || '';
  syncArrowEditColorSwatches(arrow.color);
  var dashed = document.getElementById('edit-dashed');
  if (dashed) dashed.checked = !!arrow.dashed;
  popup._key = key;
  popup.style.display = 'block';
  ta.focus();
}

function deleteArrowFromPopup() {
  pushUndo();
  var popup = document.getElementById('label-edit-popup');
  var key = popup && popup._key;
  if (!key) return;
  var arrow = arrows.find(function(a) { return a.label && a.label.key === key; });
  if (!arrow) return;
  if (arrow.label && arrow.label.key) {
    delete labelPositions[arrow.label.key];
    saveLabelPositions();
  }
  arrows = arrows.filter(function(a) { return a.id !== arrow.id; });
  pruneOrphanBranches();
  setSelectedArrow(null);
  saveArrows();
  hideLabelEdit();
  clearSVG(); drawArrows();
}

function confirmLabelEdit() {
  pushUndo();
  var popup = document.getElementById('label-edit-popup');
  var ta    = document.getElementById('label-edit-text');
  var key   = popup && popup._key;
  if (!key) return;
  var arrow = arrows.find(function(a) { return a.label && a.label.key === key; });
  if (arrow) {
    arrow.color  = arrowEditColor.hex;
    arrow.marker = arrowEditColor.marker;
    arrow.dashed = document.getElementById('edit-dashed').checked;
    arrow.label.text  = ta.value;
    saveArrows();
    clearSVG(); drawArrows();
  }
  hideLabelEdit();
}

// ── Node text editing ─────────────────────────────────────────────────────────

function loadTextOverrides() {
  textOverrides = Object.assign({}, DEFAULT_TEXT_OVERRIDES);
  try { Object.assign(textOverrides, JSON.parse(lsGet(TEXT_STORAGE_KEY) || '{}')); } catch(e) {}
  if (lsGet(TEXT_CONTENT_REVISION_KEY) !== AUTHORITATIVE_CONTENT_REVISION) {
    textOverrides.wsm = Object.assign({}, DEFAULT_TEXT_OVERRIDES.wsm);
    lsSet(TEXT_STORAGE_KEY, JSON.stringify(textOverrides));
    lsSet(TEXT_CONTENT_REVISION_KEY, AUTHORITATIVE_CONTENT_REVISION);
  }
  var statusMigrated = false;
  Object.keys(textOverrides).forEach(function(id) {
    var ov = textOverrides[id];
    if (!ov || ov.bcls) return;
    var cn = customNodes[id] || {};
    var d = DATA[id] || {};
    ov.bcls = statusClassForBadge(ov.badge) || cn.bcls || d.bcls || '';
    statusMigrated = true;
  });
  if (statusMigrated) lsSet(TEXT_STORAGE_KEY, JSON.stringify(textOverrides));
}

function saveTextOverrides() {
  try { lsSet(TEXT_STORAGE_KEY, JSON.stringify(textOverrides)); } catch(e) {}
}

function applyAllTextOverrides() {
  NODE_IDS.forEach(function(id) {
    var ov = textOverrides[id];
    var el = document.getElementById('N-' + id);
    if (!el) return;
    if (ov) {
      if (ov.title != null) { var t = el.querySelector('.ntitle'); if (t) t.textContent = ov.title; }
      if (ov.badge != null) { var b = el.querySelector('.badge');  if (b) b.textContent = ov.badge;  }
      if (ov.nsub  != null) { var s = el.querySelector('.nsub');   if (s) s.textContent = ov.nsub;   }
    }
    applyNodeStatusClass(el, resolvedNodeMeta(id).bcls);
  });
}

function showNodeTextEditor(id) {
  if (activeId === id) close_panel();
  var el = document.getElementById('N-' + id);
  if (!el) return;
  var d  = DATA[id]        || {};
  var ov = textOverrides[id] || {};
  var cn = customNodes[id]   || {};
  var isTextOnly = !!(cn.bcls === 'text');
  var popup = document.getElementById('node-text-edit-popup');
  if (!popup) return;
  var rect = el.getBoundingClientRect();
  positionPopup(popup, rect.left, rect.top);
  var _tr = document.getElementById('nte-title-row');
  var _br = document.getElementById('nte-badge-row');
  var _cr = document.getElementById('nte-color-row-wrap');
  if (_tr) _tr.style.display = isTextOnly ? 'none' : '';
  if (_br) _br.style.display = isTextOnly ? 'none' : '';
  if (_cr) _cr.style.display = isTextOnly ? 'none' : '';
  document.getElementById('nte-title').value = ov.title != null ? ov.title : (cn.title || d.title || '');
  document.getElementById('nte-badge').value = ov.badge != null ? ov.badge : (cn.badge || d.badge || '');
  var rawNsub = ov.nsub != null ? ov.nsub : (cn.nsub || '');
  if (!rawNsub && d.nsub) {
    var tmp = document.createElement('div');
    tmp.innerHTML = (d.nsub || '').replace(/<br\s*\/?>/gi, '\n');
    rawNsub = tmp.textContent || '';
  }
  document.getElementById('nte-nsub').value = rawNsub;
  syncEditNodeColorSwatches(id);
  nodeTextEditId = id;
  popup.style.display = 'block';
  document.getElementById('nte-title').focus();
  document.getElementById('nte-title').select();
}

function hideNodeTextEdit() {
  var popup = document.getElementById('node-text-edit-popup');
  if (popup) popup.style.display = 'none';
  nodeTextEditId = null;
}

function confirmNodeTextEdit() {
  if (!nodeTextEditId) return;
  pushUndo();
  var id    = nodeTextEditId;
  var title = document.getElementById('nte-title').value;
  var badge = document.getElementById('nte-badge').value;
  var nsub  = document.getElementById('nte-nsub').value;
  var bcls  = statusClassForBadge(badge) || resolvedNodeMeta(id).bcls;
  var el = document.getElementById('N-' + id);
  if (el) {
    var t = el.querySelector('.ntitle'); if (t) t.textContent = title;
    var b = el.querySelector('.badge');  if (b) b.textContent = badge;
    var s = el.querySelector('.nsub');   if (s) s.textContent = nsub;
    applyNodeStatusClass(el, bcls);
  }
  textOverrides[id] = { title: title, badge: badge, bcls: bcls, nsub: nsub };
  saveTextOverrides();
  if (customNodes[id]) {
    customNodes[id].title = title;
    customNodes[id].badge = badge;
    customNodes[id].nsub  = nsub;
    saveCustomNodes();
  }
  if (editNodeSelectedColor !== undefined) {
    applyNodeStyle(id, editNodeSelectedColor);
    if (editNodeSelectedColor) styleOverrides[id] = editNodeSelectedColor;
    else delete styleOverrides[id];
    saveStyleOverrides();
  }
  hideNodeTextEdit();
}

function ctxEditNodeText() {
  if (!ctxNodeId) return;
  var id = ctxNodeId;
  hideNodeContextMenu();
  showNodeTextEditor(id);
}

function enableNodeTextEditing(el, id) {
  function onDblClick(e) {
    e.stopPropagation();
    showNodeTextEditor(id);
  }
  var head = el.querySelector('.node-head');
  var nsub = el.querySelector('.nsub');
  if (head) head.addEventListener('dblclick', onDblClick);
  if (nsub) nsub.addEventListener('dblclick', onDblClick);
}

// ── Node style editing ─────────────────────────────────────────────────────────

function loadStyleOverrides() {
  styleOverrides = Object.assign({}, DEFAULT_STYLE_OVERRIDES);
  try { Object.assign(styleOverrides, JSON.parse(lsGet(STYLE_STORAGE_KEY) || '{}')); } catch(e) {}
}

function saveStyleOverrides() {
  try { lsSet(STYLE_STORAGE_KEY, JSON.stringify(styleOverrides)); } catch(e) {}
}

var NODE_COLOR_PALETTE = [
  { dot: '#5b9bd5', border: '#aac8ea', bg: '#ddeaf7', label: 'Data layer'    },
  { dot: '#ed7d31', border: '#f5c08a', bg: '#fef0e0', label: 'Model layer'   },
  { dot: '#70ad47', border: '#b0d888', bg: '#e8f5d8', label: 'Water quality' },
  { dot: '#d63384', border: '#f4b8d1', bg: '#fce8f0', label: 'User layer'    },
];

