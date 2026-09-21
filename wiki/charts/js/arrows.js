// ---------------------------------------------------------------------------
// Arrow builder helpers
// ---------------------------------------------------------------------------


// Returns the last confirmed canvas point in the current draw sequence.
function lastDrawPt() {
  if (drawState.waypoints.length > 0)
    return drawState.waypoints[drawState.waypoints.length - 1];
  return resolveAnchor(drawState.src);
}

// Whether the source anchor exits horizontally (left/right edge) → prefer H first.
function srcPreferHFirst(anchor, guard) {
  // A branch leaves its trunk at a right angle: vertically off a horizontal
  // trunk segment, horizontally off a vertical one.
  if (anchor.arrow) {
    var h = tapSegIsH(anchor, guard);
    return h === null ? null : !h;
  }
  return anchor.fx === 0 || anchor.fx === 1;
}

// Whether the destination anchor enters vertically (top/bottom edge) → prefer H first
// so that the last drawn segment arrives vertically.
function dstPreferHFirst(anchor, guard) {
  // A merge enters its trunk at a right angle, mirroring the perpendicular
  // departure used by a branch source.
  if (anchor.arrow) {
    var h = tapSegIsH(anchor, guard);
    return h === null ? null : !h;
  }
  return anchor.fy === 0 || anchor.fy === 1;
}

// A straight connector is valid only when it leaves and enters through faces
// that point along the segment. Coordinate alignment alone is not sufficient:
// for example, two left-edge anchors must keep an exterior H-V-H route rather
// than collapsing into a vertical line when their x coordinates coincide.
function anchorAllowsStraight(anchor, axis, delta, isSource, guard) {
  if (!anchor || Math.abs(delta) < 0.5) return false;
  if (anchor.free) return true;
  if (anchor.arrow) {
    var trunkH = tapSegIsH(anchor, guard);
    return trunkH === null ? false : axis === (trunkH ? 'v' : 'h');
  }
  if (axis === 'h') {
    if (delta > 0) return isSource ? anchor.fx === 1 : anchor.fx === 0;
    return isSource ? anchor.fx === 0 : anchor.fx === 1;
  }
  if (delta > 0) return isSource ? anchor.fy === 1 : anchor.fy === 0;
  return isSource ? anchor.fy === 0 : anchor.fy === 1;
}

// Returns 'h' or 'v' when the endpoints are close enough to share that axis
// and both attachment faces support the segment's direction; otherwise null.
function straightRouteAxis(arrow, srcPt, dstPt, tolerance, guard) {
  var dx = dstPt[0] - srcPt[0], dy = dstPt[1] - srcPt[1];
  if (Math.abs(dy) < tolerance &&
      anchorAllowsStraight(arrow.src, 'h', dx, true, guard) &&
      anchorAllowsStraight(arrow.dst, 'h', dx, false, guard)) return 'h';
  if (Math.abs(dx) < tolerance &&
      anchorAllowsStraight(arrow.src, 'v', dy, true, guard) &&
      anchorAllowsStraight(arrow.dst, 'v', dy, false, guard)) return 'v';
  return null;
}

function nodeAnchorFace(anchor) {
  if (!isNodeAnchor(anchor)) return null;
  var faces = [];
  if (anchor.fx === 0) faces.push('left');
  if (anchor.fx === 1) faces.push('right');
  if (anchor.fy === 0) faces.push('top');
  if (anchor.fy === 1) faces.push('bottom');
  return faces.length === 1 ? faces[0] : null;
}

var AUTO_ROUTE_CLEARANCE = 24;

function loadArrows() {
  try {
    var saved = JSON.parse(lsGet(ARROWS_KEY));
    if (Array.isArray(saved)) return saved.filter(function(a) { return a && a.src && a.dst; });
  } catch(e) {}
  return JSON.parse(JSON.stringify(DEFAULT_ARROWS));
}

function saveArrows() {
  try { lsSet(ARROWS_KEY, JSON.stringify(arrows)); } catch(e) {}
}

// -- Anchor kinds -----------------------------------------------------------
// An arrow endpoint is one of three shapes:
//   node   { node, fx, fy }       a fractional point on a box edge
//   free   { free:true, x, y }    a loose canvas point
//   tap    { arrow, seg, t }      a point on segment `seg` of another arrow, at
//                                 fraction `t` along it -- this is what makes a
//                                 branching arrow: several arrows share one
//                                 trunk and each carries its own arrowhead into
//                                 its own target.
// A tap stores `seg` + `t` rather than a fraction of the whole path length, so
// it stays on the trunk segment it was placed on when the trunk is rerouted.

function isNodeAnchor(a) { return !!a && !a.free && !a.arrow; }

function clearAnchor(a) {
  delete a.node;  delete a.fx;  delete a.fy;
  delete a.free;  delete a.x;   delete a.y;
  delete a.arrow; delete a.seg; delete a.t;
}

function findArrowById(id) {
  for (var i = 0; i < arrows.length; i++) if (arrows[i].id === id) return arrows[i];
  return null;
}

function clampSegIdx(seg, pts) {
  return Math.max(0, Math.min(pts.length - 2, seg | 0));
}

// Points of the trunk a tap hangs off. `guard` marks trunks already being
// resolved further up the stack, so a tap cycle returns null instead of
// recursing forever.
function tapTrunkPoints(anchor, guard) {
  guard = guard || {};
  if (guard[anchor.arrow]) return null;
  var trunk = findArrowById(anchor.arrow);
  if (!trunk) return null;
  guard[anchor.arrow] = true;
  var pts;
  try { pts = arrowPoints(trunk, guard); }
  finally { delete guard[anchor.arrow]; }
  return (pts && pts.length >= 2) ? pts : null;
}

// True if the trunk segment a tap sits on runs horizontally; null if unresolvable.
function tapSegIsH(anchor, guard) {
  var pts = tapTrunkPoints(anchor, guard);
  if (!pts) return null;
  var i = clampSegIdx(anchor.seg, pts);
  return Math.abs(pts[i+1][1] - pts[i][1]) <= Math.abs(pts[i+1][0] - pts[i][0]);
}

// Move a tap along its trunk segment to the point nearest (x, y).
function slideTapAnchor(anchor, x, y) {
  var pts = tapTrunkPoints(anchor);
  if (!pts) return;
  var i = clampSegIdx(anchor.seg, pts);
  var ax = pts[i][0], ay = pts[i][1];
  var dx = pts[i+1][0] - ax, dy = pts[i+1][1] - ay;
  var len2 = dx*dx + dy*dy;
  if (len2 === 0) return;
  anchor.seg = i;
  anchor.t = Math.max(0, Math.min(1, ((x - ax)*dx + (y - ay)*dy) / len2));
}

function resolveAnchor(anchor, guard) {
  if (!anchor) return [0, 0];
  if (anchor.arrow) {
    var pts = tapTrunkPoints(anchor, guard);
    if (!pts) return [0, 0];
    var i = clampSegIdx(anchor.seg, pts);
    var t = Math.max(0, Math.min(1, anchor.t || 0));
    return [pts[i][0] + t * (pts[i+1][0] - pts[i][0]),
            pts[i][1] + t * (pts[i+1][1] - pts[i][1])];
  }
  if (anchor.free) return [anchor.x, anchor.y];
  var b = box('N-' + anchor.node);
  return [b.l + anchor.fx * b.w, b.t + anchor.fy * b.h];
}

// The drawn polyline of an arrow: explicit waypoints if it has them, the
// auto-route otherwise. Single source of truth for every consumer.
function arrowPoints(arrow, guard) {
  if (arrow.waypoints && arrow.waypoints.length > 0)
    return [resolveAnchor(arrow.src, guard)]
             .concat(arrow.waypoints.map(function(p) { return p.slice(); }))
             .concat([resolveAnchor(arrow.dst, guard)]);
  return autoRoute(arrow, guard);
}

// True if `id` depends on `targetId` through either end's tap chain. This
// guards endpoint reassignment from creating a cycle for both branches and
// merges.
function arrowDependsOn(id, targetId) {
  var seen = {}, pending = [id];
  while (pending.length) {
    var current = pending.pop();
    if (!current || seen[current]) continue;
    if (current === targetId) return true;
    seen[current] = true;
    var a = findArrowById(current);
    if (!a) continue;
    if (a.src.arrow) pending.push(a.src.arrow);
    if (a.dst.arrow) pending.push(a.dst.arrow);
  }
  return false;
}

// Nearest point on any arrow's drawn path, for starting or re-anchoring a
// branch. `skip(arrow)` excludes candidates that would create a tap cycle.
function findArrowTapSnap(cx, cy, tol, skip) {
  var best = null, bestD = Infinity;
  for (var i = 0; i < arrows.length; i++) {
    var a = arrows[i];
    if (skip && skip(a)) continue;
    var pts = arrowPoints(a);
    for (var j = 0; j < pts.length - 1; j++) {
      var ax = pts[j][0], ay = pts[j][1];
      var dx = pts[j+1][0] - ax, dy = pts[j+1][1] - ay;
      var len2 = dx*dx + dy*dy;
      if (len2 === 0) continue;
      var t  = Math.max(0, Math.min(1, ((cx - ax)*dx + (cy - ay)*dy) / len2));
      var px = ax + t*dx, py = ay + t*dy;
      var d  = Math.sqrt((cx-px)*(cx-px) + (cy-py)*(cy-py));
      if (d <= tol && d < bestD) {
        bestD = d;
        best = { arrow: a.id, seg: j, t: t, x: px, y: py };
      }
    }
  }
  return best;
}

// Drop every arrow whose tap points at an arrow that no longer exists, so
// deleting a trunk takes its branches (and their branches) with it.
function pruneOrphanBranches() {
  var changed = true, dropped = false;
  while (changed) {
    changed = false;
    var live = {};
    arrows.forEach(function(a) { live[a.id] = true; });
    var kept = [];
    arrows.forEach(function(a) {
      if ((a.src.arrow && !live[a.src.arrow]) || (a.dst.arrow && !live[a.dst.arrow])) {
        if (a.label && a.label.key) delete labelPositions[a.label.key];
        changed = true; dropped = true;
      } else kept.push(a);
    });
    arrows = kept;
  }
  if (dropped) saveLabelPositions();
}

function polylineMidpoint(pts) {
  var segs = [], total = 0;
  for (var i = 0; i < pts.length - 1; i++) {
    var dx = pts[i+1][0] - pts[i][0], dy = pts[i+1][1] - pts[i][1];
    var len = Math.sqrt(dx*dx + dy*dy);
    segs.push(len); total += len;
  }
  var half = total / 2, acc = 0;
  for (var i = 0; i < segs.length; i++) {
    if (acc + segs[i] >= half) {
      var t = segs[i] > 0 ? (half - acc) / segs[i] : 0;
      return [pts[i][0] + t*(pts[i+1][0]-pts[i][0]),
              pts[i][1] + t*(pts[i+1][1]-pts[i][1])];
    }
    acc += segs[i];
  }
  return pts[pts.length - 1].slice();
}

function clientToCanvas(e) {
  var canvasEl = document.getElementById('canvas');
  var rect = canvasEl.getBoundingClientRect();
  var s = canvasScale || 1;
  return [(e.clientX - rect.left) / s, (e.clientY - rect.top) / s];
}

function getNodeAtCanvasPoint(cx, cy) {
  for (var i = 0; i < NODE_IDS.length; i++) {
    var b = box('N-' + NODE_IDS[i]);
    if (cx >= b.l && cx <= b.r && cy >= b.t && cy <= b.b) return NODE_IDS[i];
  }
  return null;
}

var EDGE_SNAP_RADIUS = 14;  // canvas-space pixels from a node edge to trigger snapping

// Given a canvas point (cx, cy), return a snap descriptor for the nearest edge of
// nodeId if the cursor is within EDGE_SNAP_RADIUS of that edge, otherwise null.
// The returned object: { node, fx, fy, x, y }
function computeEdgeSnap(nodeId, cx, cy) {
  var b = box('N-' + nodeId);
  // Expand bounding box for detection
  if (cx < b.l - EDGE_SNAP_RADIUS || cx > b.r + EDGE_SNAP_RADIUS) return null;
  if (cy < b.t - EDGE_SNAP_RADIUS || cy > b.b + EDGE_SNAP_RADIUS) return null;

  var distL = Math.abs(cx - b.l);
  var distR = Math.abs(cx - b.r);
  var distT = Math.abs(cy - b.t);
  var distB = Math.abs(cy - b.b);
  var minDist = Math.min(distL, distR, distT, distB);
  if (minDist > EDGE_SNAP_RADIUS) return null;

  var fx, fy, x, y;
  if (minDist === distT) {
    fy = 0; fx = Math.max(0, Math.min(1, (cx - b.l) / b.w));
    x = b.l + fx * b.w; y = b.t;
  } else if (minDist === distB) {
    fy = 1; fx = Math.max(0, Math.min(1, (cx - b.l) / b.w));
    x = b.l + fx * b.w; y = b.b;
  } else if (minDist === distL) {
    fx = 0; fy = Math.max(0, Math.min(1, (cy - b.t) / b.h));
    x = b.l; y = b.t + fy * b.h;
  } else {
    fx = 1; fy = Math.max(0, Math.min(1, (cy - b.t) / b.h));
    x = b.r; y = b.t + fy * b.h;
  }
  return { node: nodeId, fx: fx, fy: fy, x: x, y: y };
}

// In waypoints mode, constrain the snap so the last segment is orthogonal.
// Left/right edges: lock y to the last confirmed y (horizontal arrival).
// Top/bottom edges: lock x to the last confirmed x (vertical arrival).
// Returns null when the constraint falls outside the edge extent.
function constrainSnapToOrthogonal(snap) {
  var last = lastDrawPt();
  var b = box('N-' + snap.node);
  if (snap.fx === 0 || snap.fx === 1) {
    // Vertical edge — arrive horizontally → same y as last
    var fy = (last[1] - b.t) / b.h;
    if (fy < 0 || fy > 1) return null;
    return { node: snap.node, fx: snap.fx, fy: fy, x: snap.x, y: last[1] };
  } else {
    // Horizontal edge — arrive vertically → same x as last
    var fx = (last[0] - b.l) / b.w;
    if (fx < 0 || fx > 1) return null;
    return { node: snap.node, fx: fx, fy: snap.fy, x: last[0], y: snap.y };
  }
}

// Find the nearest edge snap across all nodes for the current cursor position.
// In waypoints mode the snap is constrained so the arriving segment is orthogonal.
function findEdgeSnap(cx, cy) {
  var best = null, bestDist = Infinity;
  for (var i = 0; i < NODE_IDS.length; i++) {
    var id = NODE_IDS[i];
    if (drawState.mode === 'waypoints' && drawState.src && id === drawState.src.node) continue;
    var snap = computeEdgeSnap(id, cx, cy);
    if (!snap) continue;
    if (drawState.mode === 'waypoints' && drawState.src) {
      snap = constrainSnapToOrthogonal(snap);
      if (!snap) continue;
    }
    var d = Math.sqrt((cx - snap.x) * (cx - snap.x) + (cy - snap.y) * (cy - snap.y));
    if (d < bestDist) { bestDist = d; best = snap; }
  }
  return best;
}

// Render a single floating dot at the current edge snap position.
function renderSnapDots() {
  var svgl = document.getElementById('svgl');
  // Arrow tap: highlight the trunk and mark the point an arrow will leave from
  // or merge into. Orange distinguishes it from the blue node-edge snap.
  var tap = drawState.tapSnap;
  if (tap) {
    var trunk = findArrowById(tap.arrow);
    if (trunk) drawArrowGlow(arrowPoints(trunk), trunk.color, '0.35');
    var tc = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    tc.setAttribute('cx', tap.x); tc.setAttribute('cy', tap.y); tc.setAttribute('r', 6);
    tc.setAttribute('fill', '#ed7d31'); tc.setAttribute('stroke', '#fff');
    tc.setAttribute('stroke-width', 2); tc.setAttribute('pointer-events', 'none');
    svgl.appendChild(tc);
  }
  var snap = drawState.edgeSnap;
  if (!snap) return;
  // Node border highlight rectangle
  var b = box('N-' + snap.node);
  var rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
  rect.setAttribute('x', b.l - 1); rect.setAttribute('y', b.t - 1);
  rect.setAttribute('width', b.w + 2); rect.setAttribute('height', b.h + 2);
  rect.setAttribute('fill', 'none'); rect.setAttribute('stroke', '#3b7dd8');
  rect.setAttribute('stroke-width', 1.5); rect.setAttribute('stroke-dasharray', '4,3');
  rect.setAttribute('pointer-events', 'none');
  svgl.appendChild(rect);
  // Floating snap dot
  var c = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
  c.setAttribute('cx', snap.x); c.setAttribute('cy', snap.y); c.setAttribute('r', 6);
  c.setAttribute('fill', '#3b7dd8'); c.setAttribute('stroke', '#fff');
  c.setAttribute('stroke-width', 2); c.setAttribute('pointer-events', 'none');
  svgl.appendChild(c);
}

function renderPreviewLine() {
  if (drawState.mode !== 'waypoints' || !drawState.src) return;
  var srcPt = resolveAnchor(drawState.src);
  var confirmed = [srcPt].concat(drawState.waypoints);
  var last = confirmed[confirmed.length - 1];
  // Target: constrained node-edge or arrow-tap snap, or cursor clamped to H/V
  // from the last confirmed point.
  var tap = drawState.tapSnap;
  var snap = drawState.edgeSnap || tap;
  var cursor;
  if (snap) {
    cursor = [snap.x, snap.y];
  } else {
    var raw = drawState.cursorPt;
    cursor = Math.abs(raw[0] - last[0]) >= Math.abs(raw[1] - last[1])
      ? [raw[0], last[1]]
      : [last[0], raw[1]];
  }
  var svgl = document.getElementById('svgl');

  // With no manual waypoint, show the same auto-route that a merge will use
  // when committed. Once the user has placed waypoints, insert the final
  // corner needed to meet the tapped trunk at a right angle.
  var allPts;
  if (tap && drawState.waypoints.length === 0) {
    allPts = autoRoute({ src: drawState.src,
      dst: { arrow: tap.arrow, seg: tap.seg, t: tap.t }, waypoints: [] });
  } else if (tap) {
    var approach = tapApproachPoint(tap, last);
    allPts = confirmed.concat([approach, cursor]);
  } else {
    allPts = confirmed.concat([cursor]);
  }
  var d = 'M' + allPts[0][0] + ',' + allPts[0][1];
  for (var i = 1; i < allPts.length; i++) d += ' L' + allPts[i][0] + ',' + allPts[i][1];

  var path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', d); path.setAttribute('fill', 'none');
  path.setAttribute('stroke', '#aaa'); path.setAttribute('stroke-width', 1.4);
  path.setAttribute('stroke-dasharray', '5,4'); path.setAttribute('pointer-events', 'none');
  svgl.appendChild(path);

  // Dots at confirmed waypoints
  drawState.waypoints.forEach(function(wp) {
    var c = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    c.setAttribute('cx', wp[0]); c.setAttribute('cy', wp[1]); c.setAttribute('r', 4);
    c.setAttribute('fill', '#3b7dd8'); c.setAttribute('pointer-events', 'none');
    svgl.appendChild(c);
  });
}

// The final leg of a merge is perpendicular to the trunk: vertical into a
// horizontal trunk and horizontal into a vertical trunk.
function tapApproachPoint(tap, last) {
  var h = tapSegIsH(tap);
  return h ? [tap.x, last[1]] : [last[0], tap.y];
}

function drawArrowGlow(pts, color, opacity) {
  var svg = document.getElementById('svgl');
  var d = 'M' + pts[0][0] + ',' + pts[0][1];
  for (var i = 1; i < pts.length; i++) d += ' L' + pts[i][0] + ',' + pts[i][1];
  var p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  p.setAttribute('d', d); p.setAttribute('fill', 'none');
  p.setAttribute('stroke', color); p.setAttribute('stroke-width', '10');
  p.setAttribute('stroke-opacity', opacity || '0.25');
  p.setAttribute('stroke-linecap', 'round');
  p.setAttribute('pointer-events', 'none');
  svg.appendChild(p);
}

function renderWaypointHandles() {
  var arrow = arrows.find(function(a) { return a.id === selectedArrowId; });
  if (!arrow) return;
  var svgl = document.getElementById('svgl');
  // Waypoint drag handles (orange)
  arrow.waypoints.forEach(function(wp, idx) {
    var c = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    c.setAttribute('cx', wp[0]); c.setAttribute('cy', wp[1]); c.setAttribute('r', 7);
    c.setAttribute('fill', '#ed7d31'); c.setAttribute('stroke', '#fff'); c.setAttribute('stroke-width', 2);
    c.style.cursor = 'grab';
    (function(i) {
      c.addEventListener('mousedown', function(e) {
        e.stopPropagation();
        draggingWaypoint = { arrowId: selectedArrowId, idx: i };
      });
    })(idx);
    svgl.appendChild(c);
  });
  // Endpoint drag handles (blue circles at src / dst)
  [{ end: 'src', anchor: arrow.src }, { end: 'dst', anchor: arrow.dst }].forEach(function(ep) {
    var pt = resolveAnchor(ep.anchor);
    var c = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    c.setAttribute('cx', pt[0]); c.setAttribute('cy', pt[1]); c.setAttribute('r', 6);
    c.setAttribute('fill', '#3b7dd8'); c.setAttribute('stroke', '#fff'); c.setAttribute('stroke-width', 2);
    c.style.cursor = 'crosshair';
    c.style.pointerEvents = 'all';
    (function(end, origAnchor) {
      c.addEventListener('mousedown', function(e) {
        e.stopPropagation();
        e.preventDefault();
        endpointDrag.active = true;
        endpointDrag.arrowId = arrow.id;
        endpointDrag.end = end;
        endpointDrag.origAnchor = JSON.parse(JSON.stringify(origAnchor));
        endpointDrag.edgeSnap = null;
        endpointDrag.moved = false;
      });
    })(ep.end, ep.anchor);
    svgl.appendChild(c);
  });
}

function ptToSegDist(px, py, ax, ay, bx, by) {
  var dx = bx - ax, dy = by - ay;
  var len2 = dx*dx + dy*dy;
  if (len2 === 0) return Math.sqrt((px-ax)*(px-ax) + (py-ay)*(py-ay));
  var t = Math.max(0, Math.min(1, ((px-ax)*dx + (py-ay)*dy) / len2));
  var nx = ax + t*dx, ny = ay + t*dy;
  return Math.sqrt((px-nx)*(px-nx) + (py-ny)*(py-ny));
}

function findArrowNearPoint(cx, cy, tol) {
  // Delegate to findNearestSegment so hit-testing follows the drawn path
  // (autoRoute for waypoint-less arrows), not the straight src→dst chord.
  var hit = findNearestSegment(cx, cy, tol);
  return hit ? hit.arrow : null;
}

function findNearestSegment(cx, cy, tol) {
  for (var i = 0; i < arrows.length; i++) {
    var a = arrows[i];
    var pts = arrowPoints(a);
    for (var j = 0; j < pts.length - 1; j++) {
      if (ptToSegDist(cx, cy, pts[j][0], pts[j][1], pts[j+1][0], pts[j+1][1]) <= tol) {
        var isH = Math.abs(pts[j+1][1] - pts[j][1]) < Math.abs(pts[j+1][0] - pts[j][0]);
        return { arrow: a, segIdx: j, pts: pts, isH: isH };
      }
    }
  }
  return null;
}

// Move segment segDrag.segIdx of the arrow by (dx,dy) while keeping orthogonality.
// Anchors slide along their box edges.
function applySegmentDrag(dx, dy) {
  var arrow = arrows.find(function(a) { return a.id === segDrag.arrowId; });
  if (!arrow) return;
  var orig = segDrag.origPts;
  var i = segDrag.segIdx;
  var n = orig.length;
  var delta = segDrag.isH ? dy : dx;

  var newPts = orig.map(function(p) { return p.slice(); });
  if (segDrag.isH) {
    newPts[i][1]   += delta;
    newPts[i+1][1] += delta;
  } else {
    newPts[i][0]   += delta;
    newPts[i+1][0] += delta;
  }

  // Slide a tap along its trunk when the adjacent first or last segment moves.
  if (i === 0 && arrow.src.arrow) {
    slideTapAnchor(arrow.src, newPts[0][0], newPts[0][1]);
    newPts[0] = resolveAnchor(arrow.src);
  }
  // Slide src anchor along its box edge when first segment moves
  if (i === 0 && isNodeAnchor(arrow.src)) {
    var sb = box('N-' + arrow.src.node);
    if (segDrag.isH) {
      arrow.src.fy = Math.max(0, Math.min(1, (newPts[0][1] - sb.t) / sb.h));
    } else {
      arrow.src.fx = Math.max(0, Math.min(1, (newPts[0][0] - sb.l) / sb.w));
    }
  }
  // Slide dst anchor along its box edge when last segment moves
  if (i === n - 2 && isNodeAnchor(arrow.dst)) {
    var db = box('N-' + arrow.dst.node);
    if (segDrag.isH) {
      arrow.dst.fy = Math.max(0, Math.min(1, (newPts[n-1][1] - db.t) / db.h));
    } else {
      arrow.dst.fx = Math.max(0, Math.min(1, (newPts[n-1][0] - db.l) / db.w));
    }
  }
  if (i === n - 2 && arrow.dst.arrow) {
    slideTapAnchor(arrow.dst, newPts[n-1][0], newPts[n-1][1]);
    newPts[n-1] = resolveAnchor(arrow.dst);
  }

  // Materialise as explicit waypoints (strips src and dst points)
  arrow.waypoints = newPts.slice(1, n - 1);

  // Shift label by the same perpendicular delta if it has an explicit position
  var lblKey = arrow.label && arrow.label.key;
  if (lblKey && segDrag.origLabelPos) {
    var ol = segDrag.origLabelPos;
    labelPositions[lblKey] = {
      x: segDrag.isH ? ol.x         : ol.x + delta,
      y: segDrag.isH ? ol.y + delta : ol.y,
      r: ol.r
    };
  }
}

function handleSnapDotClick(node, fx, fy) {
  if (drawState.mode === 'src') {
    drawState.src = { node: node, fx: fx, fy: fy };
    drawState.mode = 'waypoints';
    setDrawHint('Click canvas for waypoints · Click target snap point to finish · Backspace = undo · Esc = cancel');
    clearSVG(); drawArrows();
  } else if (drawState.mode === 'waypoints') {
    if (drawState.src && node === drawState.src.node) return;
    // The snap was already constrained to be orthogonal with the last waypoint — no auto-corner needed
    drawState.dst = { node: node, fx: fx, fy: fy };
    drawState.mode = 'palette';
    setDrawHint(null);
    showPalette();
    clearSVG(); drawArrows();
  }
}

// A tap can be the source (branch) or destination (merge) of an arrow.
function handleTapSnapClick(tap) {
  if (drawState.mode === 'src') {
    drawState.src = { arrow: tap.arrow, seg: tap.seg, t: tap.t };
    drawState.mode = 'waypoints';
    setDrawHint('Branching off an arrow · Click canvas for waypoints · Click a node or arrow to finish · Backspace = undo · Esc = cancel');
  } else if (drawState.mode === 'waypoints') {
    // Preserve a manually drawn orthogonal route by adding its final corner
    // before merging into the tapped trunk. A route without waypoints remains
    // automatic and is handled by autoRoute().
    if (drawState.waypoints.length) {
      var last = lastDrawPt();
      var approach = tapApproachPoint(tap, last);
      if (approach[0] !== last[0] || approach[1] !== last[1]) {
        drawState.waypoints.push(approach);
      }
    }
    drawState.dst = { arrow: tap.arrow, seg: tap.seg, t: tap.t };
    drawState.mode = 'palette';
    setDrawHint(null);
    showPalette();
  }
  drawState.tapSnap = null;
  clearSVG(); drawArrows();
}

function isInsideNode(el) {
  while (el) {
    if (el.classList && el.classList.contains('node')) return true;
    el = el.parentElement;
  }
  return false;
}

function handleCanvasClick(e) {
  if (READONLY) {         // arrow selection is an editing entry point
    if (activeId && !isInsideNode(e.target)) close_panel();
    return;
  }
  if (segDragJustFinished) { segDragJustFinished = false; return; }
  if (rubberBandJustFinished) { rubberBandJustFinished = false; return; }
  if (drawState.mode === 'idle') {
    if (isInsideNode(e.target)) return;  // node click handled by open_panel()
    var pt = clientToCanvas(e);
    var hit = findArrowNearPoint(pt[0], pt[1], 8);
    var newId = hit ? hit.id : null;
    setSelectedArrow(newId);
    if (hit) {
      hideLabelEdit();
    } else {
      hideLabelEdit();
      clearNodeSelection();
      if (activeId) close_panel();   // empty canvas returns to the front-page sidebar
    }
    clearSVG(); drawArrows();
  } else if (drawState.mode === 'src') {
    // In src mode, valid starts are a node edge snap or a tap on an arrow
    if (drawState.tapSnap) {
      handleTapSnapClick(drawState.tapSnap);
    } else if (drawState.edgeSnap) {
      handleSnapDotClick(drawState.edgeSnap.node, drawState.edgeSnap.fx, drawState.edgeSnap.fy);
    }
  } else if (drawState.mode === 'waypoints') {
    // If near a node edge or arrow → finish the arrow at that point.
    if (drawState.edgeSnap) {
      handleSnapDotClick(drawState.edgeSnap.node, drawState.edgeSnap.fx, drawState.edgeSnap.fy);
      return;
    }
    if (drawState.tapSnap) {
      handleTapSnapClick(drawState.tapSnap);
      return;
    }
    // Otherwise add a canvas waypoint — clamped to H or V from last point
    var raw = clientToCanvas(e);
    var last = lastDrawPt();
    var pt = Math.abs(raw[0] - last[0]) >= Math.abs(raw[1] - last[1])
      ? [raw[0], last[1]]   // horizontal segment
      : [last[0], raw[1]];  // vertical segment
    drawState.waypoints.push(pt);
    clearSVG(); drawArrows();
  }
}

function setDrawHint(text) {
  var hint = document.getElementById('draw-hint');
  var span = document.getElementById('draw-hint-text');
  if (!hint) return;
  if (text) { hint.style.display = 'block'; span.textContent = text; }
  else { hint.style.display = 'none'; }
}

function startDrawMode() {
  setSelectedArrow(null);
  hoveredArrowId  = null;
  hoveredSegIdx   = -1;
  segDrag.active  = false;
  segDrag.moved   = false;
  document.getElementById('canvas').style.cursor = '';
  hidePalette();
  drawState = { mode: 'src', src: null, dst: null, waypoints: [], cursorPt: [0,0], hoveredNode: null, edgeSnap: null, tapSnap: null };
  document.body.classList.add('drawing-mode');
  setDrawHint('Click a source node or existing arrow · Then click a target node or arrow to merge — Esc to cancel');
  clearSVG(); drawArrows();
}

function cancelDraw() {
  drawState = { mode: 'idle', src: null, dst: null, waypoints: [], cursorPt: [0,0], hoveredNode: null, edgeSnap: null, tapSnap: null };
  document.body.classList.remove('drawing-mode');
  hidePalette();
  setDrawHint(null);
  clearSVG(); drawArrows();
}

function deleteSelectedArrow() {
  if (!selectedArrowId) return;
  pushUndo();
  var arrow = arrows.find(function(a) { return a.id === selectedArrowId; });
  if (arrow && arrow.label && arrow.label.key) {
    delete labelPositions[arrow.label.key];
    saveLabelPositions();
  }
  arrows = arrows.filter(function(a) { return a.id !== selectedArrowId; });
  pruneOrphanBranches();
  setSelectedArrow(null);
  saveArrows();
  clearSVG(); drawArrows();
}

function confirmArrow() {
  if (!drawState.src || !drawState.dst) { cancelDraw(); return; }
  pushUndo();
  var labelText = document.getElementById('palette-label').value;
  var isDashed   = document.getElementById('palette-dashed').checked;
  var id = 'arrow_' + Date.now();
  arrows.push({
    id: id,
    src: drawState.src,
    dst: drawState.dst,
    waypoints: drawState.waypoints.slice(),
    color: paletteSelectedColor.hex,
    marker: paletteSelectedColor.marker,
    dashed: isDashed,
    label: { text: labelText, key: id + '_lbl' }
  });
  saveArrows();
  cancelDraw();
}

function buildColorSwatches() {
  var container = document.getElementById('palette-colors');
  if (!container) return;
  ARROW_COLORS.forEach(function(c, i) {
    var sw = document.createElement('div');
    sw.title = c.name;
    sw.style.cssText = 'width:26px;height:26px;border-radius:50%;cursor:pointer;background:' + c.hex +
      ';border:3px solid ' + (i === 0 ? '#333' : 'transparent') + ';flex-shrink:0;';
    sw.addEventListener('click', function() {
      container.querySelectorAll('div').forEach(function(s) { s.style.borderColor = 'transparent'; });
      sw.style.borderColor = '#333';
      paletteSelectedColor = c;
    });
    container.appendChild(sw);
  });
}

function wirePaletteButtons() {
  var confirm = document.getElementById('palette-confirm');
  var cancel  = document.getElementById('palette-cancel');
  if (confirm) confirm.addEventListener('click', confirmArrow);
  if (cancel)  cancel.addEventListener('click',  cancelDraw);
}

function showPalette() {
  var p = document.getElementById('arrow-palette');
  if (p) p.style.display = 'block';
  var lbl = document.getElementById('palette-label');
  if (lbl) { lbl.value = ''; lbl.focus(); }
}

function hidePalette() {
  var p = document.getElementById('arrow-palette');
  if (p) p.style.display = 'none';
}

// ---------------------------------------------------------------------------
// drawArrows — data-driven; iterates arrows[] built by the interactive builder
// ---------------------------------------------------------------------------
function autoRoute(arrow, guard) {
  var srcPt = resolveAnchor(arrow.src, guard);
  var dstPt = resolveAnchor(arrow.dst, guard);
  // Alignment becomes straight only when both port faces support it.
  if (straightRouteAxis(arrow, srcPt, dstPt, 0.5, guard)) return [srcPt, dstPt];
  // Leave perpendicular to the src edge and arrive perpendicular to the dst
  // edge, so the arrowhead always enters the box face-on.
  var leaveH  = arrow.src.free ? null : srcPreferHFirst(arrow.src, guard);
  var arriveH = arrow.dst.free ? null : !dstPreferHFirst(arrow.dst, guard);
  if (leaveH  === null) leaveH  = (arriveH === null) ? true : !arriveH;
  if (arriveH === null) arriveH = !leaveH;
  var mid;
  if (leaveH && !arriveH) {
    mid = [[dstPt[0], srcPt[1]]];                       // H → V
  } else if (!leaveH && arriveH) {
    mid = [[srcPt[0], dstPt[1]]];                       // V → H
  } else if (leaveH) {
    var srcFaceH = nodeAnchorFace(arrow.src);
    var dstFaceH = nodeAnchorFace(arrow.dst);
    var mx;
    if (srcFaceH === dstFaceH && srcFaceH === 'left')
      mx = Math.min(srcPt[0], dstPt[0]) - AUTO_ROUTE_CLEARANCE;
    else if (srcFaceH === dstFaceH && srcFaceH === 'right')
      mx = Math.max(srcPt[0], dstPt[0]) + AUTO_ROUTE_CLEARANCE;
    else
      mx = (srcPt[0] + dstPt[0]) / 2;                   // H → V → H
    mid = [[mx, srcPt[1]], [mx, dstPt[1]]];
  } else {
    var srcFaceV = nodeAnchorFace(arrow.src);
    var dstFaceV = nodeAnchorFace(arrow.dst);
    var my;
    if (srcFaceV === dstFaceV && srcFaceV === 'top')
      my = Math.min(srcPt[1], dstPt[1]) - AUTO_ROUTE_CLEARANCE;
    else if (srcFaceV === dstFaceV && srcFaceV === 'bottom')
      my = Math.max(srcPt[1], dstPt[1]) + AUTO_ROUTE_CLEARANCE;
    else
      my = (srcPt[1] + dstPt[1]) / 2;                   // V → H → V
    mid = [[srcPt[0], my], [dstPt[0], my]];
  }
  return [srcPt].concat(mid).concat([dstPt]);
}

function drawArrows() {
  var junctions = [];
  arrows.forEach(function(arrow) {
    var pts = arrowPoints(arrow);
    if (arrow.src.arrow) junctions.push([pts[0], arrow.color]);
    if (arrow.dst.arrow) junctions.push([pts[pts.length - 1], arrow.color]);
    if (arrow.id === selectedArrowId) drawArrowGlow(pts, arrow.color, '0.45');
    else if (arrow.id === hoveredArrowId) drawArrowGlow(pts, arrow.color, '0.25');
    seg(pts, arrow.color, arrow.marker, arrow.dashed);
    if (arrow.label && arrow.label.text) {
      var mid = polylineMidpoint(pts);
        lbl(mid[0], mid[1] - 8, arrow.label.text, arrow.color, 'middle', null, arrow.label.key);
    }
  });
  // Junction dots go on last so a trunk drawn later never covers its own tap.
  if (junctions.length) {
    var _jsvg = document.getElementById('svgl');
    junctions.forEach(function(j) {
      var c = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      c.setAttribute('cx', j[0][0]); c.setAttribute('cy', j[0][1]);
      c.setAttribute('r', 3.5); c.setAttribute('fill', j[1]);
      c.setAttribute('pointer-events', 'none');
      _jsvg.appendChild(c);
    });
  }
  if (drawState.mode !== 'idle' && drawState.mode !== 'palette') {
    renderSnapDots();
    renderPreviewLine();
  }
  // While the palette is open keep the arrow-in-progress visible
  if (drawState.mode === 'palette' && drawState.src && drawState.dst) {
    var _pts = [resolveAnchor(drawState.src)]
               .concat(drawState.waypoints)
               .concat([resolveAnchor(drawState.dst)]);
    seg(_pts, paletteSelectedColor.hex, paletteSelectedColor.marker, false);
  }
  if (selectedArrowId !== null) renderWaypointHandles();

  // Rubber-band selection rectangle
  if (rubberBand.active) {
    var _rbSvg = document.getElementById('svgl');
    var _rbCr  = document.getElementById('canvas').getBoundingClientRect();
    var _s = canvasScale || 1;
    var _rbx1 = (Math.min(rubberBand.startX, rubberBand.curX) - _rbCr.left) / _s;
    var _rby1 = (Math.min(rubberBand.startY, rubberBand.curY) - _rbCr.top)  / _s;
    var _rbx2 = (Math.max(rubberBand.startX, rubberBand.curX) - _rbCr.left) / _s;
    var _rby2 = (Math.max(rubberBand.startY, rubberBand.curY) - _rbCr.top)  / _s;
    var _rbEl = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    _rbEl.setAttribute('x', _rbx1); _rbEl.setAttribute('y', _rby1);
    _rbEl.setAttribute('width',  _rbx2 - _rbx1);
    _rbEl.setAttribute('height', _rby2 - _rby1);
    _rbEl.setAttribute('fill', 'rgba(59,125,216,0.06)');
    _rbEl.setAttribute('stroke', '#3b7dd8');
    _rbEl.setAttribute('stroke-width', 1);
    _rbEl.setAttribute('stroke-dasharray', '4,3');
    _rbEl.setAttribute('pointer-events', 'none');
    _rbSvg.appendChild(_rbEl);
  }
}

function populateBoxes() {
  NODE_IDS.forEach(function(id) {
    var d = DATA[id];
    if (!d) return;
    var el = document.getElementById('N-' + id);
    if (!el) return;
    el.querySelector('.ntitle').textContent = d.title;
    el.querySelector('.badge').textContent  = d.badge;
    el.querySelector('.nsub').innerHTML     = d.nsub || '';
  });
}
