// Pure connector-tree topology helpers. This classic script intentionally has
// no DOM dependency so the same model is used by the editor and Node tests.

function cloneConnectorValue(value) {
  return JSON.parse(JSON.stringify(value));
}

function connectorVertex(connector, vertexId) {
  return connector && connector.vertices ? connector.vertices[vertexId] || null : null;
}

function connectorEdgesAt(connector, vertexId) {
  return (connector && connector.edges || []).filter(function(edge) {
    return edge.from === vertexId || edge.to === vertexId;
  });
}

function connectorPathToTerminal(connector, terminalVertexId) {
  var parent = {};
  var parentEdge = {};
  (connector.edges || []).forEach(function(edge) {
    parent[edge.to] = edge.from;
    parentEdge[edge.to] = edge.id;
  });
  var vertexIds = [];
  var edgeIds = [];
  var cursor = terminalVertexId;
  var seen = {};
  while (cursor && !seen[cursor]) {
    seen[cursor] = true;
    vertexIds.push(cursor);
    if (cursor === connector.source) break;
    edgeIds.push(parentEdge[cursor]);
    cursor = parent[cursor];
  }
  if (vertexIds[vertexIds.length - 1] !== connector.source) {
    return { vertexIds: [], edgeIds: [] };
  }
  vertexIds.reverse();
  edgeIds.reverse();
  return { vertexIds: vertexIds, edgeIds: edgeIds };
}

function connectorDescendantTerminals(connector, vertexId) {
  var children = {};
  (connector.edges || []).forEach(function(edge) {
    if (!children[edge.from]) children[edge.from] = [];
    children[edge.from].push(edge.to);
  });
  var reachable = {};
  var stack = [vertexId];
  while (stack.length) {
    var current = stack.pop();
    if (reachable[current]) continue;
    reachable[current] = true;
    (children[current] || []).forEach(function(child) { stack.push(child); });
  }
  return (connector.terminals || []).filter(function(terminal) {
    return !!reachable[terminal.vertex];
  });
}

function connectorNodeIds(connector) {
  var seen = {};
  var result = [];
  Object.keys(connector && connector.vertices || {}).forEach(function(vertexId) {
    var vertex = connector.vertices[vertexId];
    if (vertex && vertex.kind === 'anchor' && vertex.node && !seen[vertex.node]) {
      seen[vertex.node] = true;
      result.push(vertex.node);
    }
  });
  return result;
}

function resolvedConnectorVertex(connector, vertexId, resolveAnchor) {
  var vertex = connectorVertex(connector, vertexId);
  if (!vertex) return null;
  if (vertex.kind === 'point') return [Number(vertex.x), Number(vertex.y)];
  if (resolveAnchor) {
    var resolved = resolveAnchor(vertex, vertexId, connector);
    if (resolved && resolved.length >= 2) return [Number(resolved[0]), Number(resolved[1])];
  }
  if (Number.isFinite(Number(vertex.x)) && Number.isFinite(Number(vertex.y))) {
    return [Number(vertex.x), Number(vertex.y)];
  }
  return null;
}

function connectorValidationError(errors, message) {
  errors.push(message);
}

function validateConnector(connector, resolveAnchor) {
  var errors = [];
  if (!connector || typeof connector !== 'object') {
    return { valid: false, errors: ['Connector must be an object'] };
  }
  if (!connector.id) connectorValidationError(errors, 'Connector id is required');
  if (connector.kind !== 'tree') connectorValidationError(errors, 'Connector kind must be tree');
  if (!connector.vertices || typeof connector.vertices !== 'object') {
    connectorValidationError(errors, 'Connector vertices are required');
    return { valid: false, errors: errors };
  }
  if (!connectorVertex(connector, connector.source)) {
    connectorValidationError(errors, 'Connector source vertex is missing');
  }

  var vertexIds = Object.keys(connector.vertices);
  var declaredVertexIds = {};
  vertexIds.forEach(function(vertexId) {
    var vertex = connector.vertices[vertexId];
    if (!vertex || (vertex.kind !== 'anchor' && vertex.kind !== 'point')) {
      connectorValidationError(errors, 'Unknown vertex kind at ' + vertexId);
      return;
    }
    if (vertex.id) {
      if (declaredVertexIds[vertex.id]) connectorValidationError(errors, 'Duplicate vertex id ' + vertex.id);
      declaredVertexIds[vertex.id] = true;
    }
    if (vertex.marker) connectorValidationError(errors, 'Arrowhead is stored on non-terminal vertex ' + vertexId);
    if (vertex.kind === 'anchor' && !vertex.node) connectorValidationError(errors, 'Anchor node is missing at ' + vertexId);
    if (vertex.kind === 'point' && (!Number.isFinite(Number(vertex.x)) || !Number.isFinite(Number(vertex.y)))) {
      connectorValidationError(errors, 'Point coordinates are invalid at ' + vertexId);
    }
  });

  var edgeIds = {};
  var incoming = {};
  var outgoing = {};
  (connector.edges || []).forEach(function(edge) {
    if (!edge || !edge.id) {
      connectorValidationError(errors, 'Every edge needs an id');
      return;
    }
    if (edgeIds[edge.id]) connectorValidationError(errors, 'Duplicate edge id ' + edge.id);
    edgeIds[edge.id] = true;
    if (!connectorVertex(connector, edge.from) || !connectorVertex(connector, edge.to)) {
      connectorValidationError(errors, 'Unknown edge endpoint on ' + edge.id);
      return;
    }
    if (edge.from === edge.to) connectorValidationError(errors, 'Self edge ' + edge.id);
    if (edge.marker) connectorValidationError(errors, 'Arrowhead is stored on non-terminal edge ' + edge.id);
    incoming[edge.to] = (incoming[edge.to] || 0) + 1;
    outgoing[edge.from] = (outgoing[edge.from] || 0) + 1;
    var from = resolvedConnectorVertex(connector, edge.from, resolveAnchor);
    var to = resolvedConnectorVertex(connector, edge.to, resolveAnchor);
    if (from && to && Math.abs(from[0] - to[0]) > 1e-7 && Math.abs(from[1] - to[1]) > 1e-7) {
      connectorValidationError(errors, 'Diagonal edge ' + edge.id);
    }
  });

  if ((incoming[connector.source] || 0) !== 0) connectorValidationError(errors, 'Source must have indegree zero');
  vertexIds.forEach(function(vertexId) {
    if (vertexId !== connector.source && (incoming[vertexId] || 0) !== 1) {
      connectorValidationError(errors, 'Non-source vertex must have indegree one: ' + vertexId);
    }
  });

  var terminalVertices = {};
  if (!Array.isArray(connector.terminals) || connector.terminals.length === 0) {
    connectorValidationError(errors, 'Connector needs at least one terminal');
  }
  (connector.terminals || []).forEach(function(terminal) {
    if (!terminal || !connectorVertex(connector, terminal.vertex)) {
      connectorValidationError(errors, 'Terminal vertex is missing');
      return;
    }
    if (terminalVertices[terminal.vertex]) connectorValidationError(errors, 'Duplicate terminal vertex ' + terminal.vertex);
    terminalVertices[terminal.vertex] = true;
    if ((outgoing[terminal.vertex] || 0) !== 0) connectorValidationError(errors, 'Terminal has outgoing edges ' + terminal.vertex);
    if (connectorVertex(connector, terminal.vertex).kind !== 'anchor') {
      connectorValidationError(errors, 'Terminal must be an anchor ' + terminal.vertex);
    }
  });
  vertexIds.forEach(function(vertexId) {
    if ((outgoing[vertexId] || 0) === 0 && vertexId !== connector.source && !terminalVertices[vertexId]) {
      connectorValidationError(errors, 'Leaf is not a terminal ' + vertexId);
    }
  });

  var reachable = {};
  var adjacency = {};
  (connector.edges || []).forEach(function(edge) {
    if (!adjacency[edge.from]) adjacency[edge.from] = [];
    adjacency[edge.from].push(edge.to);
  });
  var visiting = {};
  var hasCycle = false;
  function visit(vertexId) {
    if (visiting[vertexId]) { hasCycle = true; return; }
    if (reachable[vertexId]) return;
    visiting[vertexId] = true;
    reachable[vertexId] = true;
    (adjacency[vertexId] || []).forEach(visit);
    delete visiting[vertexId];
  }
  if (connector.source) visit(connector.source);
  if (hasCycle) connectorValidationError(errors, 'Connector contains a cycle');
  vertexIds.forEach(function(vertexId) {
    if (!reachable[vertexId]) connectorValidationError(errors, 'Disconnected vertex ' + vertexId);
  });
  return { valid: errors.length === 0, errors: errors };
}

function connectorDistance(a, b) {
  var dx = a[0] - b[0], dy = a[1] - b[1];
  return Math.sqrt(dx * dx + dy * dy);
}

function nextConnectorId(existing, prefix) {
  var index = 1;
  var candidate = prefix + index;
  while (existing[candidate]) {
    index += 1;
    candidate = prefix + index;
  }
  return candidate;
}

function connectorEdgeById(connector, edgeId) {
  return (connector.edges || []).find(function(edge) { return edge.id === edgeId; }) || null;
}

function splitConnectorEdge(connector, edgeId, point, epsilon, resolveAnchor) {
  epsilon = Number.isFinite(epsilon) ? epsilon : 0.01;
  var edge = connectorEdgeById(connector, edgeId);
  if (!edge) throw new Error('Unknown connector edge: ' + edgeId);
  var requested = [Number(point.x), Number(point.y)];
  if (!Number.isFinite(requested[0]) || !Number.isFinite(requested[1])) {
    throw new Error('Connector split point must be finite');
  }

  var nearby = null;
  Object.keys(connector.vertices).some(function(vertexId) {
    var resolved = resolvedConnectorVertex(connector, vertexId, resolveAnchor);
    if (resolved && connectorDistance(resolved, requested) <= epsilon) {
      nearby = vertexId;
      return true;
    }
    return false;
  });
  if (nearby) return { connector: connector, vertexId: nearby, split: false };

  var from = resolvedConnectorVertex(connector, edge.from, resolveAnchor);
  var to = resolvedConnectorVertex(connector, edge.to, resolveAnchor);
  if (from && to) {
    var onHorizontal = Math.abs(from[1] - to[1]) <= epsilon &&
      requested[0] >= Math.min(from[0], to[0]) - epsilon && requested[0] <= Math.max(from[0], to[0]) + epsilon &&
      Math.abs(requested[1] - from[1]) <= epsilon;
    var onVertical = Math.abs(from[0] - to[0]) <= epsilon &&
      requested[1] >= Math.min(from[1], to[1]) - epsilon && requested[1] <= Math.max(from[1], to[1]) + epsilon &&
      Math.abs(requested[0] - from[0]) <= epsilon;
    if (!onHorizontal && !onVertical) throw new Error('Split point is not on connector edge ' + edgeId);
  }

  var vertexId = nextConnectorId(connector.vertices, 'v_join_');
  connector.vertices[vertexId] = { kind: 'point', x: requested[0], y: requested[1] };
  var edgeIdSet = {};
  connector.edges.forEach(function(item) { edgeIdSet[item.id] = true; });
  var downstreamId = nextConnectorId(edgeIdSet, edge.id + '_split_');
  var index = connector.edges.indexOf(edge);
  connector.edges.splice(index, 1,
    { id: edge.id, from: edge.from, to: vertexId },
    { id: downstreamId, from: vertexId, to: edge.to }
  );
  return { connector: connector, vertexId: vertexId, split: true };
}

function addConnectorTerminal(connector, join, routePoints, targetAnchor, terminalData) {
  var joinVertexId = typeof join === 'string' ? join : join && join.vertexId;
  if (!connectorVertex(connector, joinVertexId)) throw new Error('Unknown connector join vertex');
  routePoints = routePoints || [];
  terminalData = terminalData || {};
  var vertexIdSet = connector.vertices;
  var edgeIdSet = {};
  connector.edges.forEach(function(edge) { edgeIdSet[edge.id] = true; });
  var previous = joinVertexId;
  var previousPoint = resolvedConnectorVertex(connector, previous);
  routePoints.forEach(function(routePoint) {
    var pointValue = Array.isArray(routePoint) ? routePoint : [routePoint.x, routePoint.y];
    pointValue = [Number(pointValue[0]), Number(pointValue[1])];
    if (previousPoint && connectorDistance(previousPoint, pointValue) <= 1e-9) return;
    var pointId = nextConnectorId(vertexIdSet, 'v_point_');
    vertexIdSet[pointId] = { kind: 'point', x: pointValue[0], y: pointValue[1] };
    var edgeId = nextConnectorId(edgeIdSet, 'e_');
    edgeIdSet[edgeId] = true;
    connector.edges.push({ id: edgeId, from: previous, to: pointId });
    previous = pointId;
    previousPoint = pointValue;
  });
  var terminalVertexId = nextConnectorId(vertexIdSet, 'v_terminal_');
  vertexIdSet[terminalVertexId] = cloneConnectorValue(targetAnchor);
  vertexIdSet[terminalVertexId].kind = 'anchor';
  var terminalEdgeId = nextConnectorId(edgeIdSet, 'e_');
  connector.edges.push({ id: terminalEdgeId, from: previous, to: terminalVertexId });
  connector.terminals.push({
    vertex: terminalVertexId,
    marker: terminalData.marker || 'mbl',
    label: cloneConnectorValue(terminalData.label || { text: '', key: connector.id + '_' + terminalVertexId + '_lbl' })
  });
  return { connector: connector, vertexId: terminalVertexId, edgeId: terminalEdgeId };
}

function replaceConnectorVertexReferences(connector, removedId, keptId) {
  connector.edges.forEach(function(edge) {
    if (edge.from === removedId) edge.from = keptId;
    if (edge.to === removedId) edge.to = keptId;
  });
  connector.terminals.forEach(function(terminal) {
    if (terminal.vertex === removedId) terminal.vertex = keptId;
  });
  if (connector.source === removedId) connector.source = keptId;
  delete connector.vertices[removedId];
}

function normalizeConnector(connector, epsilon) {
  epsilon = Number.isFinite(epsilon) ? epsilon : 0.01;
  var changed = true;
  while (changed) {
    changed = false;
    var pointIds = Object.keys(connector.vertices).filter(function(vertexId) {
      return connector.vertices[vertexId].kind === 'point';
    });
    outer: for (var i = 0; i < pointIds.length; i++) {
      for (var j = i + 1; j < pointIds.length; j++) {
        var a = connector.vertices[pointIds[i]], b = connector.vertices[pointIds[j]];
        if (connectorDistance([a.x, a.y], [b.x, b.y]) <= epsilon) {
          replaceConnectorVertexReferences(connector, pointIds[j], pointIds[i]);
          changed = true;
          break outer;
        }
      }
    }
    if (changed) continue;

    var seenEdges = {};
    connector.edges = connector.edges.filter(function(edge) {
      var key = edge.from + '>' + edge.to;
      if (edge.from === edge.to || seenEdges[key]) { changed = true; return false; }
      seenEdges[key] = true;
      return true;
    });
    if (changed) continue;

    var vertexIds = Object.keys(connector.vertices);
    for (var k = 0; k < vertexIds.length; k++) {
      var vertexId = vertexIds[k];
      var vertex = connector.vertices[vertexId];
      if (!vertex || vertex.kind !== 'point' || connector.terminals.some(function(t) { return t.vertex === vertexId; })) continue;
      var incoming = connector.edges.filter(function(edge) { return edge.to === vertexId; });
      var outgoing = connector.edges.filter(function(edge) { return edge.from === vertexId; });
      if (incoming.length !== 1 || outgoing.length !== 1) continue;
      var before = resolvedConnectorVertex(connector, incoming[0].from);
      var current = [Number(vertex.x), Number(vertex.y)];
      var after = resolvedConnectorVertex(connector, outgoing[0].to);
      if (!before || !after) continue;
      var collinearH = Math.abs(before[1] - current[1]) <= epsilon && Math.abs(current[1] - after[1]) <= epsilon;
      var collinearV = Math.abs(before[0] - current[0]) <= epsilon && Math.abs(current[0] - after[0]) <= epsilon;
      if (!collinearH && !collinearV) continue;
      var incomingEdge = incoming[0], outgoingEdge = outgoing[0];
      incomingEdge.to = outgoingEdge.to;
      connector.edges = connector.edges.filter(function(edge) { return edge !== outgoingEdge; });
      delete connector.vertices[vertexId];
      changed = true;
      break;
    }
  }

  var used = {};
  used[connector.source] = true;
  connector.edges.forEach(function(edge) { used[edge.from] = true; used[edge.to] = true; });
  connector.terminals.forEach(function(terminal) { used[terminal.vertex] = true; });
  Object.keys(connector.vertices).forEach(function(vertexId) {
    if (!used[vertexId] && connector.vertices[vertexId].kind === 'point') delete connector.vertices[vertexId];
  });
  return connector;
}

function removeConnectorTerminal(connector, terminalVertexId) {
  connector.terminals = connector.terminals.filter(function(terminal) {
    return terminal.vertex !== terminalVertexId;
  });
  var terminalSet = {};
  connector.terminals.forEach(function(terminal) { terminalSet[terminal.vertex] = true; });
  var keep = {};
  keep[connector.source] = true;
  connector.terminals.forEach(function(terminal) {
    var path = connectorPathToTerminal(connector, terminal.vertex);
    path.vertexIds.forEach(function(vertexId) { keep[vertexId] = true; });
  });
  connector.edges = connector.edges.filter(function(edge) {
    return !!keep[edge.from] && !!keep[edge.to];
  });
  Object.keys(connector.vertices).forEach(function(vertexId) {
    if (!keep[vertexId]) delete connector.vertices[vertexId];
  });
  normalizeConnector(connector, 0.01);
  return connector;
}

function legacyConnectorSafeId(value) {
  return String(value || 'legacy').replace(/[^A-Za-z0-9_-]/g, '_');
}

function legacyAnchorVertex(anchor, resolvedPoint) {
  var vertex = cloneConnectorValue(anchor || {});
  delete vertex.arrow;
  delete vertex.seg;
  delete vertex.t;
  delete vertex.free;
  vertex.kind = 'anchor';
  // Coordinates exist only while the DOM-free migration constructs and
  // normalizes geometry. They are removed before the connector is returned.
  vertex.x = Number(resolvedPoint[0]);
  vertex.y = Number(resolvedPoint[1]);
  return vertex;
}

function compactLegacyPoints(points, epsilon) {
  var compact = [];
  (points || []).forEach(function(point) {
    var next = [Number(point[0]), Number(point[1])];
    if (!Number.isFinite(next[0]) || !Number.isFinite(next[1])) {
      throw new Error('Legacy arrow resolver returned an invalid point');
    }
    if (!compact.length || connectorDistance(compact[compact.length - 1], next) > epsilon) compact.push(next);
  });
  if (compact.length < 2) throw new Error('Legacy arrow needs at least two resolved points');
  return compact;
}

function connectorFromLegacyRoot(root, points) {
  var safe = legacyConnectorSafeId(root.id);
  var connector = {
    id: root.id.indexOf('arrow_') === 0 ? 'connector_' + root.id.slice(6) : 'connector_' + safe,
    kind: 'tree',
    source: 'v_' + safe + '_source',
    vertices: {},
    edges: [],
    terminals: [],
    style: { color: root.color || '#5b9bd5', dashed: !!root.dashed }
  };
  connector.vertices[connector.source] = legacyAnchorVertex(root.src, points[0]);
  var previous = connector.source;
  for (var i = 1; i < points.length - 1; i++) {
    var pointId = 'v_' + safe + '_point_' + i;
    connector.vertices[pointId] = { kind: 'point', x: points[i][0], y: points[i][1] };
    connector.edges.push({ id: 'e_' + safe + '_' + i, from: previous, to: pointId });
    previous = pointId;
  }
  var terminalId = 'v_' + safe + '_terminal';
  connector.vertices[terminalId] = legacyAnchorVertex(root.dst, points[points.length - 1]);
  connector.edges.push({ id: 'e_' + safe + '_' + (points.length - 1), from: previous, to: terminalId });
  connector.terminals.push({
    vertex: terminalId,
    marker: root.marker || 'mbl',
    label: cloneConnectorValue(root.label || { text: '', key: root.id + '_lbl' })
  });
  return connector;
}

function nearestConnectorEdge(connector, point) {
  var best = null;
  (connector.edges || []).forEach(function(edge, index) {
    var from = resolvedConnectorVertex(connector, edge.from);
    var to = resolvedConnectorVertex(connector, edge.to);
    if (!from || !to) return;
    var dx = to[0] - from[0], dy = to[1] - from[1];
    var lengthSquared = dx * dx + dy * dy;
    var t = lengthSquared ? Math.max(0, Math.min(1,
      ((point[0] - from[0]) * dx + (point[1] - from[1]) * dy) / lengthSquared
    )) : 0;
    var projected = [from[0] + t * dx, from[1] + t * dy];
    var distance = connectorDistance(point, projected);
    if (!best || distance < best.distance || (distance === best.distance && index < best.index)) {
      best = { edge: edge, point: projected, distance: distance, index: index,
        isH: Math.abs(dx) >= Math.abs(dy) };
    }
  });
  return best;
}

function legacyArrowDepth(arrow, byId) {
  var depth = 0;
  var cursor = arrow;
  var seen = {};
  while (cursor && cursor.src && cursor.src.arrow) {
    if (seen[cursor.id]) throw new Error('Legacy arrow tap cycle at ' + cursor.id);
    seen[cursor.id] = true;
    cursor = byId[cursor.src.arrow];
    depth += 1;
  }
  return depth;
}

function migrateLegacyArrowFamily(legacyArrows, resolveLegacyArrowPoints, epsilon) {
  epsilon = Number.isFinite(epsilon) ? epsilon : 2;
  if (!legacyArrows || !legacyArrows.length) throw new Error('Legacy arrow family is empty');
  var byId = {};
  legacyArrows.forEach(function(arrow) {
    if (!arrow || !arrow.id || byId[arrow.id]) throw new Error('Duplicate legacy arrow id');
    byId[arrow.id] = arrow;
  });
  var roots = legacyArrows.filter(function(arrow) { return !(arrow.src && arrow.src.arrow); });
  if (roots.length !== 1) throw new Error('Legacy arrow family needs exactly one root');
  var root = roots[0];
  var rootPoints = compactLegacyPoints(resolveLegacyArrowPoints(root), 1e-7);
  var connector = connectorFromLegacyRoot(root, rootPoints);
  var branches = legacyArrows.filter(function(arrow) { return arrow !== root; });
  branches.sort(function(a, b) { return legacyArrowDepth(a, byId) - legacyArrowDepth(b, byId); });

  branches.forEach(function(branch) {
    if (!branch.src || !branch.src.arrow || !byId[branch.src.arrow]) {
      throw new Error('Legacy branch has an unknown tap source: ' + branch.id);
    }
    var branchPoints = compactLegacyPoints(resolveLegacyArrowPoints(branch), 1e-7);
    var nearest = nearestConnectorEdge(connector, branchPoints[0]);
    if (!nearest) throw new Error('Cannot resolve legacy branch join: ' + branch.id);
    var split = splitConnectorEdge(
      connector,
      nearest.edge.id,
      { x: nearest.point[0], y: nearest.point[1] },
      epsilon
    );
    var joinPoint = resolvedConnectorVertex(connector, split.vertexId);
    var route = branchPoints.slice(1, -1).map(function(point) { return point.slice(); });
    if (route.length && joinPoint) {
      // Taps within epsilon intentionally share one junction. Project the
      // first branch leg onto that junction so coalescing cannot create a
      // small diagonal segment.
      if (nearest.isH) route[0][0] = joinPoint[0];
      else route[0][1] = joinPoint[1];
    }
    var target = legacyAnchorVertex(branch.dst, branchPoints[branchPoints.length - 1]);
    addConnectorTerminal(connector, split, route, target, {
      marker: branch.marker || root.marker || 'mbl',
      label: cloneConnectorValue(branch.label || { text: '', key: branch.id + '_lbl' })
    });
  });

  normalizeConnector(connector, epsilon);
  Object.keys(connector.vertices).forEach(function(vertexId) {
    var vertex = connector.vertices[vertexId];
    if (vertex.kind === 'anchor') { delete vertex.x; delete vertex.y; }
  });
  return connector;
}

function migrateLegacyArrows(legacyArrows, resolveLegacyArrowPoints, epsilon) {
  var result = [];
  var legacy = [];
  (legacyArrows || []).forEach(function(item) {
    if (item && item.kind === 'tree') result.push(cloneConnectorValue(item));
    else legacy.push(item);
  });
  var byId = {};
  legacy.forEach(function(arrow) {
    if (!arrow || !arrow.id || byId[arrow.id]) throw new Error('Duplicate legacy arrow id');
    byId[arrow.id] = arrow;
  });
  function rootId(arrow) {
    var current = arrow;
    var seen = {};
    while (current && current.src && current.src.arrow) {
      if (seen[current.id]) throw new Error('Legacy arrow tap cycle at ' + current.id);
      seen[current.id] = true;
      current = byId[current.src.arrow];
      if (!current) throw new Error('Legacy arrow has unknown tap dependency');
    }
    return current.id;
  }
  var groups = {};
  var order = [];
  legacy.forEach(function(arrow) {
    var root = rootId(arrow);
    if (!groups[root]) { groups[root] = []; order.push(root); }
    groups[root].push(arrow);
  });
  order.forEach(function(root) {
    result.push(migrateLegacyArrowFamily(groups[root], resolveLegacyArrowPoints, epsilon));
  });
  return result;
}
