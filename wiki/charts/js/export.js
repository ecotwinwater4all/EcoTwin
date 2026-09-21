// ── Export (SVG / PNG / PDF) ──────────────────────────────────────────────────

function _svgEl(NS, tag, attrs) {
  var el = document.createElementNS(NS, tag);
  Object.keys(attrs).forEach(function(k) { if (attrs[k] != null) el.setAttribute(k, attrs[k]); });
  return el;
}

// Read the line breaks produced by the live title element. Exporting from
// textContent alone loses the browser's natural wrapping, so a long title can
// become one flattened line in the SVG.
function _renderedTextLines(el, fallback) {
  if (!el) return fallback;
  var textNodes = [];
  var walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) textNodes.push(walker.currentNode);
  if (textNodes.length !== 1) {
    var rendered = (el.innerText || '').split(/\r?\n/).map(function(s) { return s.trim(); }).filter(Boolean);
    return rendered.length ? rendered : fallback;
  }
  var node = textNodes[0], text = node.nodeValue || '', lines = [];
  if (!text) return fallback;
  var range = document.createRange(), lineTop = null, lineText = '';
  for (var i = 0; i < text.length; i++) {
    range.setStart(node, i); range.setEnd(node, i + 1);
    var rect = range.getBoundingClientRect();
    var top = Math.round(rect.top);
    if (lineTop !== null && Math.abs(top - lineTop) > 1) {
      if (lineText.trim()) lines.push(lineText.trim());
      lineText = '';
    }
    if (lineTop === null || Math.abs(top - lineTop) > 1) lineTop = top;
    lineText += text.charAt(i);
  }
  if (lineText.trim()) lines.push(lineText.trim());
  return lines.length ? lines : fallback;
}

function _renderBoxToSVG(parent, NS, el, id) {
  var x   = parseInt(el.style.left) || 0;
  var y   = parseInt(el.style.top)  || 0;
  var w   = el.offsetWidth;
  var h   = el.offsetHeight;
  var rot = parseInt(el.getAttribute('data-rot') || '0');

  var ov       = styleOverrides[id];
  var isSrc    = el.classList.contains('src');
  var isProg   = el.classList.contains('prog');
  var isPlan   = el.classList.contains('plan');
  var isDashed = isProg || isPlan;

  var borderColor = ov ? ov.border : isSrc ? '#7ab87a' : isProg ? '#d4c090' : isPlan ? '#c8c5be' : '#b8cfe8';
  var headBg      = ov ? ov.bg     : isSrc ? '#e2f0e2' : isProg ? '#fdf6e3' : isPlan ? '#ebebeb' : '#dceaf5';
  var dotColor    = ov ? ov.dot    : isSrc ? '#3a8a3a' : isProg ? '#c89a20' : isPlan ? '#999'    : '#3b7dd8';
  var badgeBg     = ov ? ov.border : isSrc ? '#c4e4c4' : isProg ? '#faeec8' : isPlan ? '#e0ddd8' : '#c8ddf0';

  var headEl = el.querySelector('.node-head');
  var headH  = headEl ? headEl.offsetHeight : 34;
  var titleEl = el.querySelector('.ntitle');
  var title  = titleEl ? titleEl.textContent || '' : '';
  var badge  = (el.querySelector('.badge')  || {}).textContent || '';
  var nsubEl = el.querySelector('.nsub');
  var nsub   = nsubEl ? nsubEl.innerHTML.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '') : '';

  var g = document.createElementNS(NS, 'g');
  if (rot) g.setAttribute('transform', 'rotate(' + rot + ' ' + (x+w/2) + ' ' + (y+h/2) + ')');

  g.appendChild(_svgEl(NS, 'rect', {x:x, y:y, width:w, height:h, rx:4,
    fill:'#fff', stroke:borderColor, 'stroke-width':1.5, 'stroke-dasharray': isDashed ? '5,3' : null}));
  g.appendChild(_svgEl(NS, 'rect', {x:x, y:y, width:w, height:headH, rx:3, fill:headBg}));
  g.appendChild(_svgEl(NS, 'rect', {x:x, y:y+headH-4, width:w, height:4, fill:headBg}));
  g.appendChild(_svgEl(NS, 'circle', {cx:x+11.5, cy:y+headH/2, r:3.5, fill:dotColor}));

  var titleAvailW = w - 22 - (badge ? Math.max(badge.length * 7 + 22, 48) : 10);
  var titleFs = ntitleFontSize || 16;
  var titleLineH = titleFs * 1.35;
  var charsPerLine = Math.max(4, Math.floor(titleAvailW / (titleFs * 0.49)));
  var titleLines = [], rem = title;
  while (rem.length > charsPerLine) {
    var cut = rem.lastIndexOf(' ', charsPerLine);
    if (cut < 1) cut = charsPerLine;
    titleLines.push(rem.slice(0, cut));
    rem = rem.slice(cut).trim();
  }
  if (rem) titleLines.push(rem);
  titleLines = _renderedTextLines(titleEl, titleLines);
  var tLineH = titleLineH;
  var tBaseY = y + (headH - titleLines.length * tLineH) / 2 + tLineH * 0.78;
  titleLines.forEach(function(line, i) {
    var tEl = _svgEl(NS, 'text', {x:x+22, y:tBaseY + i*tLineH,
      'font-size':titleFs, 'font-weight':500, 'font-family':'system-ui,sans-serif', fill:'#1a1a1a'});
    tEl.textContent = line;
    g.appendChild(tEl);
  });

  if (badge) {
    var badgeFs = badgeFontSize || 12;
    var bH = badgeFs + 8;
    var bW = Math.max(badge.length * badgeFs * 0.6 + 12, 38);
    var bX = x + w - bW - 7, bY = y + headH/2 - bH/2;
    g.appendChild(_svgEl(NS, 'rect', {x:bX, y:bY, width:bW, height:bH, rx:3, fill:badgeBg}));
    var bT = _svgEl(NS, 'text', {x:bX+bW/2, y:bY + badgeFs * 0.82 + (bH - badgeFs) / 2, 'font-size':badgeFs, 'font-weight':500,
      'font-family':'system-ui,sans-serif', 'text-anchor':'middle', fill:'#1a1a1a'});
    bT.textContent = badge;
    g.appendChild(bT);
  }

  if (nsub) {
    var nsubFs = nsubFontSize || 14;
    var nsubLineH = nsubFs * 1.4;
    var limit = Math.max(8, Math.floor(w / (nsubFs * 0.54)));
    var rawLines = nsub.replace(/·/g, '\n').split('\n').map(function(l){return l.trim();}).filter(Boolean);
    var lines = [];
    rawLines.forEach(function(line) {
      while (line.length > limit) {
        var cut = line.lastIndexOf(' ', limit); if (cut < 1) cut = limit;
        lines.push(line.slice(0, cut)); line = line.slice(cut).trim();
      }
      if (line) lines.push(line);
    });
    lines.forEach(function(line, i) {
      var nt = _svgEl(NS, 'text', {x:x+11, y:y+headH+nsubFs*1.2+i*nsubLineH,
        'font-size':nsubFs, 'font-family':'system-ui,sans-serif', fill:'#777'});
      nt.textContent = line;
      g.appendChild(nt);
    });
  }
  parent.appendChild(g);
}

function buildExportSVG() {
  var NS = 'http://www.w3.org/2000/svg';
  var svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('xmlns', NS);
  svg.setAttribute('width', CANVAS_W);
  svg.setAttribute('height', CANVAS_H);
  svg.setAttribute('viewBox', '0 0 ' + CANVAS_W + ' ' + CANVAS_H);

  svg.appendChild(_svgEl(NS, 'rect', {width:CANVAS_W, height:CANVAS_H, fill:'#fff'}));

  var srcSvg = document.getElementById('svgl');
  var defs = srcSvg.querySelector('defs');
  if (defs) svg.appendChild(defs.cloneNode(true));

  NODE_IDS.forEach(function(id) {
    var el = document.getElementById('N-' + id);
    if (el) _renderBoxToSVG(svg, NS, el, id);
  });

  Array.prototype.forEach.call(srcSvg.childNodes, function(c) {
    if (c.tagName === 'defs') return;
    var cl = c.cloneNode(true);
    cl.removeAttribute('pointer-events');
    svg.appendChild(cl);
  });

  // Legend — horizontal row of user-editable items; honours visibility and
  // the dragged position (projected from the on-screen wrap-relative spot
  // into canvas coordinates, since the export is canvas-only).
  var legEl = document.getElementById('canvas-legend');
  var cvEl  = document.getElementById('canvas');
  if (legendState.visible && legendState.items.length && legEl && cvEl) {
    var legItems = legendState.items;
    var cr = cvEl.getBoundingClientRect();
    var lr = legEl.getBoundingClientRect();
    // The legend is a fixed-size screen overlay, positioned wherever CSS
    // (default centered) or a prior drag (legendState.fx/fy) currently
    // places it — either way, lr is its true, already-resolved rendered
    // rect. To reproduce it faithfully in the exported (unscaled, logical
    // CANVAS_W x CANVAS_H) coordinate space, EVERY measurement — position,
    // box size, item size, and font size — must go through the same
    // /canvasScale projection. Scaling only some of these (e.g. position
    // but not size, or size but not font-size) breaks self-consistency and
    // produces a mispositioned or disproportionate legend.
    var lgX  = (lr.left - cr.left) / canvasScale;
    var lgY  = (lr.top  - cr.top)  / canvasScale;
    var boxW = lr.width  / canvasScale;
    var boxH = lr.height / canvasScale;
    lgX = Math.max(CANVAS_MARGIN, Math.min(lgX, CANVAS_W - boxW - CANVAS_MARGIN));
    lgY = Math.max(CANVAS_MARGIN, Math.min(lgY, CANVAS_H - boxH - CANVAS_MARGIN));
    svg.appendChild(_svgEl(NS, 'rect', {x:lgX, y:lgY, width:boxW, height:boxH,
      rx:5, fill:'rgba(255,255,255,0.9)', stroke:'#dedad4', 'stroke-width':1}));
    var itemEls = legEl.querySelectorAll('.legend-item');
    legItems.forEach(function(it, i) {
      var itemEl = itemEls[i];
      var swEl   = itemEl && itemEl.querySelector('.legend-swatch');
      var txtEl  = itemEl && itemEl.querySelector('.legend-label');
      if (!swEl || !txtEl) return;
      var swR  = swEl.getBoundingClientRect();
      var txtR = txtEl.getBoundingClientRect();
      var swX  = lgX + (swR.left - lr.left) / canvasScale;
      var swY  = lgY + (swR.top  - lr.top)  / canvasScale;
      var swW  = swR.width  / canvasScale;
      var swH  = swR.height / canvasScale;
      svg.appendChild(_svgEl(NS, 'rect', {x:swX, y:swY, width:swW, height:swH, rx:2,
        fill:it.bg, stroke:it.border, 'stroke-width':1.5}));
      var txtX = lgX + (txtR.left - lr.left) / canvasScale;
      var txtY = lgY + (txtR.top  - lr.top)  / canvasScale + (txtR.height / canvasScale) * 0.78;
      var lt = _svgEl(NS, 'text', {x:txtX, y:txtY,
        'font-size': 11 / canvasScale, 'font-family':'system-ui,sans-serif', fill:'#555'});
      lt.textContent = it.label;
      svg.appendChild(lt);
    });
  }

  return svg;
}

function _svgDataURL(svgEl) {
  var str = new XMLSerializer().serializeToString(svgEl);
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(str);
}

function _download(url, filename) {
  var a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
}

function exportSVG() {
  var str = new XMLSerializer().serializeToString(buildExportSVG());
  var blob = new Blob([str], {type:'image/svg+xml'});
  _download(URL.createObjectURL(blob), 'lake-iseo-dataflow.svg');
}

function exportPNG() {
  var url = _svgDataURL(buildExportSVG());
  var img = new Image();
  img.onload = function() {
    var c = document.createElement('canvas');
    c.width = CANVAS_W * 2; c.height = CANVAS_H * 2;
    var ctx = c.getContext('2d');
    ctx.scale(2, 2);
    ctx.drawImage(img, 0, 0);
    _download(c.toDataURL('image/png'), 'lake-iseo-dataflow.png');
  };
  img.src = url;
}

function exportPDF() {
  var url = _svgDataURL(buildExportSVG());
  var win = window.open('', '_blank');
  win.document.write('<!DOCTYPE html><html><head><style>' +
    'html,body{margin:0;padding:0;overflow:hidden;}' +
    'img{position:fixed;top:0;left:0;width:100%;height:100%;object-fit:contain;}' +
    '@page{size:landscape;margin:0}' +
    '</style></head><body><img src="' + url + '"></body></html>');
  win.document.close();
  setTimeout(function() { win.focus(); win.print(); }, 400);
}

var DEFAULT_PANEL_HTML =
  '<h4>System overview</h4>' +
  '<p>Lake Iseo digital twin: an end-to-end architecture linking meteorological and hydrological data through numerical models, validation, and forecast delivery to stakeholders.</p>' +
  '<h4>Status</h4>' +
  '<ul>' +
    '<li><strong>Solid blue:</strong> implemented</li>' +
    '<li><strong>Amber dashed:</strong> in progress</li>' +
    '<li><strong>Grey dashed:</strong> planned</li>' +
    '<li><strong>Solid green:</strong> monitoring data inputs</li>' +
  '</ul>' +
  '<h4>Arrow types</h4>' +
  '<ul>' +
    '<li><span style="color:#5b9bd5;font-weight:600">━</span> Atmospheric forcing</li>' +
    '<li><span style="color:#ed7d31;font-weight:600">━</span> Hydrological / model outputs</li>' +
    '<li><span style="color:#70ad47;font-weight:600">━</span> Ecological / assimilation</li>' +
    '<li><span style="color:#7030a0;font-weight:600">━</span> Model cascade / stakeholders</li>' +
  '</ul>' +
  '<h4>How to use</h4>' +
  '<p>Click any box to view its description, inputs, outputs, and implementation status. Click again or press ✕ to return here.</p>';

function showDefaultSidebar() {
  activeId = null;
  sidebarEditId = null;
  document.getElementById('side-title').textContent = overviewTitle();
  var badge = document.getElementById('side-badge');
  badge.textContent = '';
  badge.removeAttribute('style');
  var editBtn = document.getElementById('side-edit-btn');
  if (editBtn) { editBtn.textContent = 'Edit'; editBtn.classList.remove('active'); }
  var contentEl = document.getElementById('side-content');
  var stored = sidebarContent && sidebarContent['_overview_'];
  contentEl.innerHTML = stored != null ? sidebarTextToHtml(stored) : DEFAULT_PANEL_HTML;
  renderMath(contentEl);
}

