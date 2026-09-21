window.addEventListener('load', function() {
  // A public viewer should open at the overview, even if the browser restores
  // the scroll position from an earlier visit. The sidebar remains scrollable
  // after this initial reset.
  if (READONLY) {
    var initialSide = document.getElementById('side-inner');
    if (initialSide) initialSide.scrollTop = 0;
  }
  populateBoxes();
  loadDeletedNodes();
  loadCustomNodes();
  loadTextOverrides();
  applyAllTextOverrides();
  loadStyleOverrides();
  applyAllStyleOverrides();
  loadSidebarContent();
  loadFooter();
  wireFooter();
  addResizeHandles();
  restoreLabelPositions();
  restorePositions();
  loadLabelFontSize();
  loadNodeFontSizes();
  NODE_IDS.forEach(function(id) {
    var el = document.getElementById('N-' + id);
    if (!el) return;
    el.title = NODE_TIP;
    el.addEventListener('mousedown', onMouseDown);
    el.style.cursor = 'pointer';
    el.addEventListener('dblclick', function(e) { showNodeContextMenu(e, id); });
    el.addEventListener('contextmenu', function(e) {
      e.preventDefault(); e.stopPropagation();
      ctxNodeId = id;
      ctxRotateNode();
    });
  });
  document.addEventListener('click', function(e) {
    var menu = document.getElementById('node-ctx-menu');
    if (menu && menu.style.display !== 'none' && !menu.contains(e.target)) hideNodeContextMenu();
    var labelMenu = document.getElementById('label-ctx-menu');
    if (labelMenu && labelMenu.style.display !== 'none' && !labelMenu.contains(e.target)) hideLabelContextMenu();
  });
  arrows = loadArrows();
  buildColorSwatches();
  buildArrowEditColorSwatches();
  buildAddNodeColorSwatches();
  buildEditNodeColorSwatches();
  loadLegendState();
  buildLegend();
  wireLegend();
  wireSplit();
  wireStageResize();
  wireCanvasSizeInputs();
  wireNodeSizeInputs();
  wirePaletteButtons();
  document.getElementById('canvas').addEventListener('click', handleCanvasClick);
  document.getElementById('canvas').addEventListener('dblclick', function(e) {
    if (drawState.mode !== 'idle') return;
    if (isInsideNode(e.target)) return;
    var pt  = clientToCanvas(e);
    var hit = findArrowNearPoint(pt[0], pt[1], 8);
    if (hit) openArrowEditPopup(hit, e.clientX, e.clientY);
  });
  document.getElementById('canvas').addEventListener('mousedown', function(e) {
    if (drawState.mode !== 'idle') return;
    if (isInsideNode(e.target)) return;
    var pt = clientToCanvas(e);
    var hit = findNearestSegment(pt[0], pt[1], 10);
    if (!hit) {
      // Start rubber-band selection on empty canvas
      rubberBand.active = true;
      rubberBand.startX = e.clientX; rubberBand.startY = e.clientY;
      rubberBand.curX   = e.clientX; rubberBand.curY   = e.clientY;
      return;
    }
    var _lblKey = hit.arrow.label && hit.arrow.label.key;
    var _lblPos = _lblKey && labelPositions[_lblKey];
    segDrag.active       = true;
    segDrag.arrowId      = hit.arrow.id;
    segDrag.segIdx       = hit.segIdx;
    segDrag.origPts      = hit.pts.map(function(p) { return p.slice(); });
    segDrag.origLabelPos = _lblPos ? { x: _lblPos.x, y: _lblPos.y, r: _lblPos.r != null ? _lblPos.r : 0 } : null;
    segDrag.startX       = e.clientX;
    segDrag.startY       = e.clientY;
    segDrag.isH          = hit.isH;
    segDrag.moved        = false;
    e.preventDefault();
  });
  var fsinp = document.getElementById('label-font-size');
  if (fsinp) fsinp.addEventListener('change', function() {
    var v = parseFloat(fsinp.value);
    if (!isNaN(v) && v >= 6) {
      pushUndo();
      labelFontSize = v;
      try { lsSet(LABEL_FONT_SIZE_KEY, labelFontSize); } catch(e) {}
      clearSVG(); drawArrows();
    }
  });
  var ntitleInp = document.getElementById('ntitle-font-size');
  if (ntitleInp) ntitleInp.addEventListener('change', function() {
    var v = parseFloat(ntitleInp.value);
    if (!isNaN(v) && v >= 6) {
      pushUndo();
      ntitleFontSize = v;
      try { lsSet(NTITLE_FONT_SIZE_KEY, ntitleFontSize); } catch(e) {}
      applyNodeFontSizes();
    }
  });
  var nsubInp = document.getElementById('nsub-font-size');
  if (nsubInp) nsubInp.addEventListener('change', function() {
    var v = parseFloat(nsubInp.value);
    if (!isNaN(v) && v >= 6) {
      pushUndo();
      nsubFontSize = v;
      try { lsSet(NSUB_FONT_SIZE_KEY, nsubFontSize); } catch(e) {}
      applyNodeFontSizes();
    }
  });
  var badgeInp = document.getElementById('badge-font-size');
  if (badgeInp) badgeInp.addEventListener('change', function() {
    var v = parseFloat(badgeInp.value);
    if (!isNaN(v) && v >= 6) {
      pushUndo();
      badgeFontSize = v;
      try { lsSet(BADGE_FONT_SIZE_KEY, badgeFontSize); } catch(e) {}
      applyNodeFontSizes();
    }
  });
  var ta = document.getElementById('label-edit-text');
  if (ta) ta.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') { hideLabelEdit(); e.preventDefault(); }
    if (e.key === 'Enter' && e.ctrlKey) { confirmLabelEdit(); e.preventDefault(); }
  });
  var nteInputs = ['nte-title', 'nte-badge'];
  nteInputs.forEach(function(fid) {
    var inp = document.getElementById(fid);
    if (!inp) return;
    inp.addEventListener('keydown', function(e) {
      if (e.key === 'Enter') { confirmNodeTextEdit(); e.preventDefault(); }
      if (e.key === 'Escape') { hideNodeTextEdit(); e.preventDefault(); }
    });
  });
  var nteNsub = document.getElementById('nte-nsub');
  if (nteNsub) nteNsub.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') { hideNodeTextEdit(); e.preventDefault(); }
    if (e.key === 'Enter' && e.ctrlKey) { confirmNodeTextEdit(); e.preventDefault(); }
  });
  var obtn = document.getElementById('btn-ortho-drag');
  if (obtn && orthoDragMode) obtn.classList.add('tb-active');
  updateUndoBtn();
  showDefaultSidebar();
  fitCanvas();
  setTimeout(function() { fitCanvas(); clearSVG(); drawArrows(); applyLegendPosition(); }, 200);
});

window.addEventListener('resize', function() {
  fitCanvas();
  clearSVG();
  drawArrows();
  applyLegendPosition();
});

document.addEventListener('keydown', function(e) {
  if (e.key === 's' && (e.ctrlKey || e.metaKey) && sidebarEditId) {
    e.preventDefault();
    saveSidebarEdit();
    return;
  }
  var ae = document.activeElement;
  var inTextarea = !!(ae && ae.closest && ae.closest('#side-edit-pane'));
  if (e.key === 'z' && (e.ctrlKey || e.metaKey) && !e.shiftKey) {
    if (inTextarea) return;
    undo();
    e.preventDefault();
    return;
  }
  if ((e.key === 'y' && (e.ctrlKey || e.metaKey)) ||
      (e.key === 'z' && (e.ctrlKey || e.metaKey) && e.shiftKey)) {
    if (inTextarea) return;
    redo();
    e.preventDefault();
    return;
  }
  if (e.key === 'Escape') {
    hideNodeTextEdit();
    cancelDraw();
    clearNodeSelection();
    return;
  }
  if (e.key === 'Backspace' && drawState.mode === 'waypoints') {
    drawState.waypoints.pop();
    clearSVG(); drawArrows();
    e.preventDefault();
    return;
  }
  if ((e.key === 'Delete' || e.key === 'Backspace') && selectedArrowId !== null && drawState.mode === 'idle') {
    deleteSelectedArrow();
    e.preventDefault();
  }
});
