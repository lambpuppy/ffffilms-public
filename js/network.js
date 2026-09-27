// The network — a force-directed reading of the directors' edges, drawn on
// one canvas. Enhancement only: without script the index below the stage
// states every edge as a link, and the stage stays hidden.
//
// No library. The simulation is a small velocity-Verlet integrator after
// d3-force (many-body, link, collide, centring); at ~140 nodes a pairwise
// loop is cheap. Sizes are in screen pixels, so zooming spreads the layout
// rather than shrinking the type.

(function () {
  "use strict";

  var root = document.querySelector(".nw");
  var dataEl = document.getElementById("nw-data");
  if (!root || !dataEl) return;
  var DATA = JSON.parse(dataEl.textContent);

  var canvas = root.querySelector(".nw-canvas");
  if (!canvas.getContext) return;
  var stage = root.querySelector(".nw-stage");
  var panel = root.querySelector(".nw-panel");
  var controls = root.querySelector(".nw-controls");
  var ctx = canvas.getContext("2d");
  root.hidden = false;

  // ---- Data ----

  var STORE = "ffffilms-network-weights-v1";
  var overrides = {};
  try { overrides = JSON.parse(localStorage.getItem(STORE)) || {}; } catch (e) { overrides = {}; }
  function save() {
    try { localStorage.setItem(STORE, JSON.stringify(overrides)); } catch (e) { /* no storage */ }
  }

  var byId = {};
  var nodes = DATA.nodes.map(function (n, i) {
    // Phyllotaxis start, as d3 does: deterministic, so the layout settles
    // the same way on every load.
    var r = 10 * Math.sqrt(0.5 + i), a = i * Math.PI * (3 - Math.sqrt(5));
    var o = { id: n.id, name: n.name, tier: n.tier, crossed: n.crossed, meta: n.meta,
              map: n.map, cat: n.cat, also: n.also, radius: n.radius, lean: n.lean, lb: n.lb,
              x: r * Math.cos(a), y: r * Math.sin(a), vx: 0, vy: 0,
              fx: null, fy: null, str: 0 };
    byId[n.id] = o;
    return o;
  });
  var edges = DATA.edges.map(function (e) {
    var key = e[0] + "|" + e[1] + "|" + e[2];
    return { s: e[0], t: e[1], type: e[2], w0: e[3], note: e[4], prov: e[5], ref: e[6],
             unset: e[7], key: key,
             w: overrides[key] != null ? overrides[key] : e[3],
             source: byId[e[0]], target: byId[e[1]] };
  });

  // ---- State ----

  var TYPES = [["aff", "Affinity"], ["inf", "Influence"], ["col", "Worked with"]]
    .filter(function (t) { return edges.some(function (e) { return e.type === t[0]; }); });
  var AXES = DATA.axes;
  var OFF = "Off the chart";
  // cats: the categories shown (empty = all); secondary: whether a
  // secondary category counts; layout: free, or pulled onto the
  // diagram's own axes.
  var state = { core: false, types: {}, minW: 1, sel: null,
                cats: {}, secondary: true, layout: "free", loose: true };
  // A name with no edge left under the current filters — none in the
  // data, or all of them filtered out — floats as a loose dot while
  // `loose` is on, and is hidden when it is off.
  TYPES.forEach(function (t) { state.types[t[0]] = true; });

  var visNodes = [], visEdges = [], nbSet = null;

  function R(n) { return 3 + Math.sqrt(n.str) * 1.25 + (n.tier === 1 ? 1.5 : 0); }

  function anyCat() { return Object.keys(state.cats).length > 0; }

  // How a node stands against the category filter: 2 = its primary
  // category is chosen, 1 = only a secondary one is, 0 = neither.
  function catMatch(n) {
    if (!anyCat()) return 2;
    if (state.cats[n.cat || OFF]) return 2;
    if (state.secondary && n.also.some(function (a) { return state.cats[a]; })) return 1;
    return 0;
  }

  function filter() {
    nodes.forEach(function (n) { n.match = catMatch(n); });
    visEdges = edges.filter(function (e) {
      if (!state.types[e.type] || e.w < state.minW) return false;
      if (state.core && (e.source.tier !== 1 || e.target.tier !== 1)) return false;
      if (!e.source.match || !e.target.match) return false;
      return true;
    });
    var on = {};
    nodes.forEach(function (n) { n.str = 0; n.deg = 0; });
    visEdges.forEach(function (e) {
      on[e.s] = on[e.t] = true;
      e.source.str += e.w; e.target.str += e.w;
      e.source.deg++; e.target.deg++;
    });
    visNodes = nodes.filter(function (n) {
      if (on[n.id]) return true;
      return state.loose && n.match && (!state.core || n.tier === 1);
    });
    if (state.sel && visNodes.indexOf(byId[state.sel]) === -1) state.sel = null;
    neighbours();
  }

  function neighbours() {
    nbSet = null;
    if (!state.sel) return;
    nbSet = {};
    nbSet[state.sel] = true;
    visEdges.forEach(function (e) {
      if (e.s === state.sel) nbSet[e.t] = true;
      if (e.t === state.sel) nbSet[e.s] = true;
    });
  }

  // The diagram's geometry (circle.html): axis i at -90 + 72i
  // degrees, a lean 17 degrees off the spoke, canonical at the centre.
  var RMAX = 900;
  nodes.forEach(function (n) {
    if (!n.cat) { n.tx = n.ty = null; return; }
    var i = AXES.indexOf(n.cat);
    var a = (-90 + i * 360 / AXES.length + n.lean * 17) * Math.PI / 180;
    var r = RMAX * (0.3 + 0.65 * Math.pow(n.radius, 0.9));
    n.tx = r * Math.cos(a); n.ty = r * Math.sin(a);
  });

  // ---- Simulation ----

  var alpha = 1, alphaTarget = 0, ALPHA_MIN = 0.001, ALPHA_DECAY = 0.05, VDECAY = 0.6;
  var running = false;

  function tick() {
    alpha += (alphaTarget - alpha) * ALPHA_DECAY;
    var i, j, a, b, n = visNodes.length, diag = state.layout === "diagram";

    // Links: stronger edges sit closer and pull harder. Each end moves in
    // proportion to the other end's degree, so hubs stay put.
    visEdges.forEach(function (e) {
      var s = e.source, t = e.target;
      var dx = t.x + t.vx - s.x - s.vx || 1e-6, dy = t.y + t.vy - s.y - s.vy || 1e-6;
      var l = Math.sqrt(dx * dx + dy * dy);
      var dist = 170 - e.w * 18, k = (0.06 + e.w * 0.07) * (state.layout === "diagram" ? 0.1 : 1);
      l = (l - dist) / l * alpha * k;
      dx *= l; dy *= l;
      var bias = s.deg / (s.deg + t.deg);
      t.vx -= dx * bias; t.vy -= dy * bias;
      s.vx += dx * (1 - bias); s.vy += dy * (1 - bias);
    });

    // Charge and collision, pairwise.
    for (i = 0; i < n; i++) {
      a = visNodes[i];
      var ra = R(a) + 16;
      for (j = i + 1; j < n; j++) {
        b = visNodes[j];
        var dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy;
        if (l2 < 1) { dx = (j - i) * 0.1; dy = 0.1; l2 = dx * dx + dy * dy; }
        var w = (diag ? -60 : -380) * alpha / l2;
        a.vx += dx * w; a.vy += dy * w;
        b.vx -= dx * w; b.vy -= dy * w;
        var r = ra + R(b) + 16;
        if (l2 < r * r) {
          var l = Math.sqrt(l2), m = (r - l) / l * 0.5;
          a.vx -= dx * m; a.vy -= dy * m;
          b.vx += dx * m; b.vy += dy * m;
        }
      }
      if (state.layout === "diagram") {
        // Off the chart means outside the ring: those names keep their
        // bearing and are held past the rim.
        var tx = a.tx, ty = a.ty;
        if (tx == null) {
          var th = Math.atan2(a.y, a.x);
          tx = Math.cos(th) * RMAX * 1.15; ty = Math.sin(th) * RMAX * 1.15;
        }
        a.vx += (tx - a.x) * 0.3 * alpha;
        a.vy += (ty - a.y) * 0.3 * alpha;
      } else {
        a.vx -= a.x * 0.035 * alpha;
        a.vy -= a.y * 0.035 * alpha;
      }
    }

    for (i = 0; i < n; i++) {
      a = visNodes[i];
      if (a.fx != null) { a.x = a.fx; a.vx = 0; } else { a.vx *= VDECAY; a.x += a.vx; }
      if (a.fy != null) { a.y = a.fy; a.vy = 0; } else { a.vy *= VDECAY; a.y += a.vy; }
    }
  }

  function loop() {
    tick();
    draw();
    if (alpha > ALPHA_MIN || alphaTarget > 0) requestAnimationFrame(loop);
    else running = false;
  }

  function reheat(a) {
    alpha = Math.max(alpha, a);
    if (!running) { running = true; requestAnimationFrame(loop); }
  }

  // ---- View transform: screen = layout * k + (x, y) ----

  var T = { k: 1, x: 0, y: 0 };
  function sx(x) { return x * T.k + T.x; }
  function sy(y) { return y * T.k + T.y; }
  function zoomAt(px, py, f) {
    var k = Math.min(5, Math.max(0.15, T.k * f));
    f = k / T.k;
    T.x = px - (px - T.x) * f;
    T.y = py - (py - T.y) * f;
    T.k = k;
  }

  var W = 0, H = 0, DPR = 1;
  function size() {
    var r = canvas.getBoundingClientRect();
    W = r.width || window.innerWidth;
    H = r.height || window.innerHeight * 0.7;
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(W * DPR);
    canvas.height = Math.round(H * DPR);
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  }

  function fit() {
    if (!visNodes.length) return;
    var x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    visNodes.forEach(function (n) {
      x0 = Math.min(x0, n.x); y0 = Math.min(y0, n.y);
      x1 = Math.max(x1, n.x); y1 = Math.max(y1, n.y);
    });
    var pad = W < 600 ? 24 : 60;
    var k = Math.min((W - 2 * pad) / Math.max(x1 - x0, 1), (H - 2 * pad) / Math.max(y1 - y0, 1));
    T.k = Math.min(2, Math.max(0.15, k));
    T.x = W / 2 - (x0 + x1) / 2 * T.k;
    T.y = H / 2 - (y0 + y1) / 2 * T.k;
  }

  // ---- Colour, read from the stylesheet's tokens ----

  var C = {};
  function readColors() {
    var cs = getComputedStyle(document.documentElement);
    ["ground", "ink", "mute", "accent"].forEach(function (k) {
      C[k] = cs.getPropertyValue("--" + k).trim();
    });
    C.font = cs.getPropertyValue("--text").trim() || "sans-serif";
    C.geo = cs.getPropertyValue("--geo").trim() || "sans-serif";
  }

  // ---- Drawing ----

  var raf = 0;
  function schedule() {
    if (!raf) raf = requestAnimationFrame(function () { raf = 0; draw(); });
  }

  // Labels are placed in priority order — the selection, then the most
  // connected — and a label that would collide with one already placed
  // waits for more zoom. Names appear as soon as there is room for them.
  function labelOrder() {
    return visNodes.slice().sort(function (a, b) {
      var pa = (a.id === state.sel ? 4 : 0) + (nbSet && nbSet[a.id] ? 2 : 0) + (a.tier === 1 ? 1 : 0);
      var pb = (b.id === state.sel ? 4 : 0) + (nbSet && nbSet[b.id] ? 2 : 0) + (b.tier === 1 ? 1 : 0);
      return pb - pa || b.str - a.str;
    });
  }

  function drawAxes() {
    if (state.layout !== "diagram") return;
    ctx.globalAlpha = 1;
    ctx.strokeStyle = C.mute;
    ctx.lineWidth = 0.5;
    ctx.fillStyle = C.mute;
    ctx.font = "400 11px " + C.geo;
    ctx.textAlign = "center";
    AXES.forEach(function (name, i) {
      var a = (-90 + i * 360 / AXES.length) * Math.PI / 180;
      ctx.beginPath();
      ctx.moveTo(sx(0), sy(0));
      ctx.lineTo(sx(Math.cos(a) * RMAX), sy(Math.sin(a) * RMAX));
      ctx.stroke();
      var lx = sx(Math.cos(a) * RMAX) + Math.cos(a) * 24, ly = sy(Math.sin(a) * RMAX) + Math.sin(a) * 18;
      ctx.fillText(name.toUpperCase(), lx, ly);
    });
    ctx.textAlign = "left";
  }

  function draw() {
    ctx.clearRect(0, 0, W, H);
    drawAxes();

    // Edges: the accent's one job. Dash says the type, width the weight;
    // an edge not yet weighted is drawn lighter.
    ctx.strokeStyle = C.accent;
    ctx.fillStyle = C.accent;
    visEdges.forEach(function (e) {
      var s = e.source, t = e.target;
      var lit = !nbSet || (e.s === state.sel || e.t === state.sel);
      ctx.globalAlpha = lit ? (e.unset && overrides[e.key] == null ? 0.45 : 0.8) : 0.06;
      var x1 = sx(s.x), y1 = sy(s.y), x2 = sx(t.x), y2 = sy(t.y);
      var dx = x2 - x1, dy = y2 - y1, l = Math.sqrt(dx * dx + dy * dy) || 1;
      var ux = dx / l, uy = dy / l;
      var rs = R(s) + 2, rt = R(t) + (e.type === "inf" ? 4 : 2);
      if (l < rs + rt) return;
      ctx.lineWidth = 0.6 + e.w * 0.45;
      ctx.setLineDash(e.type === "aff" ? [5, 4] : e.type === "col" ? [1.5, 3] : []);
      ctx.beginPath();
      ctx.moveTo(x1 + ux * rs, y1 + uy * rs);
      ctx.lineTo(x2 - ux * rt, y2 - uy * rt);
      ctx.stroke();
      if (e.type === "inf") {
        var hx = x2 - ux * (R(t) + 2), hy = y2 - uy * (R(t) + 2), h = 5 + e.w * 0.6;
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.moveTo(hx, hy);
        ctx.lineTo(hx - ux * h - uy * h * 0.5, hy - uy * h + ux * h * 0.5);
        ctx.lineTo(hx - ux * h + uy * h * 0.5, hy - uy * h - ux * h * 0.5);
        ctx.closePath();
        ctx.fill();
      }
    });
    ctx.setLineDash([]);

    // Nodes: three greys for the three tiers.
    // A node there only by its secondary category is drawn as a ring.
    visNodes.forEach(function (n) {
      ctx.globalAlpha = nbSet && !nbSet[n.id] ? 0.12 : n.crossed ? 0.45 : 1;
      var col = n.tier === 1 ? C.ink : C.mute;
      ctx.beginPath();
      ctx.arc(sx(n.x), sy(n.y), R(n), 0, 2 * Math.PI);
      if (n.match === 1) {
        ctx.fillStyle = C.ground;
        ctx.fill();
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = col;
        ctx.stroke();
      } else {
        ctx.fillStyle = col;
        ctx.fill();
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = C.ground;
        ctx.stroke();
      }
      if (n.id === state.sel) {
        ctx.beginPath();
        ctx.arc(sx(n.x), sy(n.y), R(n) + 2.5, 0, 2 * Math.PI);
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = C.ink;
        ctx.stroke();
      }
    });

    // Labels, haloed in the ground colour so crossing lines don't cut them.
    ctx.textBaseline = "middle";
    ctx.lineJoin = "round";
    var placed = [];
    labelOrder().forEach(function (n) {
      if (nbSet && !nbSet[n.id]) return;
      var sel = n.id === state.sel;
      ctx.font = (n.tier === 1 || sel ? "700 " : "400 ") + (sel ? 14 : 12) + "px " + C.font;
      var x = sx(n.x) + R(n) + 4, y = sy(n.y);
      var box = { x0: x - 2, x1: x + ctx.measureText(n.name).width + 2, y0: y - 8, y1: y + 8 };
      if (box.x1 < 0 || box.x0 > W || box.y1 < 0 || box.y0 > H) return;
      if (!sel && placed.some(function (b) {
        return box.x0 < b.x1 && box.x1 > b.x0 && box.y0 < b.y1 && box.y1 > b.y0;
      })) return;
      placed.push(box);
      ctx.globalAlpha = n.crossed ? 0.6 : 1;
      ctx.lineWidth = 3.5;
      ctx.strokeStyle = C.ground;
      ctx.strokeText(n.name, x, y);
      ctx.fillStyle = n.tier === 1 || sel ? C.ink : C.mute;
      ctx.fillText(n.name, x, y);
    });
    ctx.globalAlpha = 1;
  }

  // ---- Hit testing, in screen space ----

  function pick(x, y) {
    var best = null, bd = Infinity;
    visNodes.forEach(function (n) {
      var dx = sx(n.x) - x, dy = sy(n.y) - y, d = dx * dx + dy * dy;
      var r = Math.max(R(n) + 6, 18);
      if (d < r * r && d < bd) { bd = d; best = n; }
    });
    return best;
  }

  // ---- Pointer: tap selects, drag on a node moves it, drag elsewhere
  // pans, two fingers pinch, the wheel zooms about the pointer. ----

  var pointers = new Map(), gesture = null;
  function local(e) {
    var r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  canvas.addEventListener("pointerdown", function (e) {
    canvas.setPointerCapture(e.pointerId);
    var p = local(e);
    pointers.set(e.pointerId, p);
    if (pointers.size === 1) {
      var n = pick(p.x, p.y);
      gesture = { kind: n ? "drag" : "pan", node: n, start: p, last: p, moved: 0 };
    } else if (pointers.size === 2) {
      if (gesture && gesture.node) release(gesture.node);
      var ps = Array.from(pointers.values());
      gesture = { kind: "pinch", d: dist(ps[0], ps[1]), mid: mid(ps[0], ps[1]), moved: 99 };
    }
  });

  canvas.addEventListener("pointermove", function (e) {
    if (!pointers.has(e.pointerId)) {
      canvas.style.cursor = pick(local(e).x, local(e).y) ? "pointer" : "grab";
      return;
    }
    var p = local(e);
    pointers.set(e.pointerId, p);
    if (!gesture) return;
    if (gesture.kind === "pinch" && pointers.size === 2) {
      var ps = Array.from(pointers.values()), d = dist(ps[0], ps[1]), m = mid(ps[0], ps[1]);
      T.x += m.x - gesture.mid.x; T.y += m.y - gesture.mid.y;
      zoomAt(m.x, m.y, d / gesture.d);
      gesture.d = d; gesture.mid = m;
      schedule();
      return;
    }
    gesture.moved = Math.max(gesture.moved, dist(p, gesture.start));
    if (gesture.moved < 8) return;
    if (gesture.kind === "drag") {
      var n = gesture.node;
      if (n.fx == null) { alphaTarget = 0.15; reheat(0.15); }
      n.fx = (p.x - T.x) / T.k; n.fy = (p.y - T.y) / T.k;
    } else if (gesture.kind === "pan") {
      T.x += p.x - gesture.last.x; T.y += p.y - gesture.last.y;
      schedule();
    }
    gesture.last = p;
  });

  function end(e) {
    if (!pointers.has(e.pointerId)) return;
    var p = pointers.get(e.pointerId);
    pointers.delete(e.pointerId);
    if (!gesture) return;
    if (gesture.node) release(gesture.node);
    if (gesture.moved < 8 && e.type === "pointerup") {
      var n = pick(p.x, p.y);
      select(n ? n.id : null);
    }
    gesture = pointers.size ? { kind: "pan", start: pointers.values().next().value,
                                last: pointers.values().next().value, moved: 99 } : null;
  }
  canvas.addEventListener("pointerup", end);
  canvas.addEventListener("pointercancel", end);

  function release(n) { n.fx = n.fy = null; alphaTarget = 0; }

  canvas.addEventListener("wheel", function (e) {
    e.preventDefault();
    var p = local(e);
    zoomAt(p.x, p.y, Math.exp(-e.deltaY * (e.deltaMode ? 0.05 : 0.002)));
    schedule();
  }, { passive: false });

  function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y) || 1; }
  function mid(a, b) { return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }; }

  // ---- Selection and the panel ----

  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }

  function rich(s) {
    return esc(s).replace(/&lt;em&gt;/g, "<em>").replace(/&lt;\/em&gt;/g, "</em>");
  }

  function relLabel(e, id) {
    if (e.type === "inf") return e.s === id ? "Influenced" : "Influenced by";
    return e.type === "col" ? "Worked with" : "Affinity";
  }

  function select(id, opts) {
    state.sel = id && byId[id] && visNodes.indexOf(byId[id]) !== -1 ? id : null;
    neighbours();
    renderPanel();
    schedule();
    try {
      history.replaceState(null, "", state.sel ? "#" + state.sel : location.pathname + location.search);
    } catch (e) { /* file:// */ }
    if (state.sel && opts && opts.center) {
      var n = byId[state.sel];
      // On a phone the sheet covers the lower half of the screen: bring
      // the canvas to the top and centre the node in what stays visible.
      var cy = H / 2;
      if (W < 760) {
        canvas.scrollIntoView({ block: "start" });
        cy = Math.min(H, window.innerHeight * 0.5) / 2;
      }
      T.k = Math.max(T.k, 0.8);
      T.x = W / 2 - n.x * T.k; T.y = cy - n.y * T.k;
    }
  }

  function renderPanel() {
    var edited = Object.keys(overrides).length;
    var tools = edited
      ? '<p class="nw-tools"><button type="button" data-act="copy">Copy ' + edited +
        ' edited weight' + (edited > 1 ? "s" : "") + '</button>' +
        '<button type="button" data-act="reset">Reset</button></p>'
      : "";
    if (!state.sel) {
      panel.classList.remove("is-open");
      panel.innerHTML = '<p class="nw-hint">Select a director to see their connections. ' +
        "Drag a name to move it, drag the background to pan, and scroll or pinch to zoom.</p>" + tools;
      return;
    }
    var n = byId[state.sel];
    var mine = visEdges.filter(function (e) { return e.s === n.id || e.t === n.id; })
      .sort(function (a, b) { return b.w - a.w; });
    var rows = mine.map(function (e) {
      var o = e.s === n.id ? e.target : e.source;
      var w = overrides[e.key] != null
        ? "edited from " + e.w0 + (e.unset ? " (default)" : "")
        : e.unset ? "not yet weighted" : e.prov || "";
      return '<li class="edge">' +
        '<span class="edge-rel">' + relLabel(e, n.id) + "</span>" +
        '<button type="button" class="nw-to" data-sel="' + o.id + '">' + esc(o.name) + "</button>" +
        (e.note ? '<span class="edge-why">' + esc(e.note) + "</span>" : "") +
        (e.ref ? '<span class="edge-why">' + (/^https?:\/\//.test(e.ref)
          ? '<a href="' + esc(e.ref) + '">Source</a>'
          : "Source: " + esc(e.ref)) + "</span>" : "") +
        '<span class="nw-w">' +
        '<button type="button" data-w="-1" data-key="' + e.key + '" aria-label="Lighter">−</button>' +
        '<span class="nw-wn">' + e.w + "</span>" +
        '<button type="button" data-w="1" data-key="' + e.key + '" aria-label="Heavier">+</button>' +
        (w ? '<span class="nw-wnote">' + esc(w) + "</span>" : "") +
        "</span></li>";
    }).join("");
    panel.innerHTML =
      '<button type="button" class="nw-close" data-act="close" aria-label="Close">×</button>' +
      '<h2 class="nw-name">' + esc(n.name) + "</h2>" +
      '<p class="d-meta">' + esc(n.meta) + "</p>" +
      (n.bio ? '<p class="nw-bio">' + rich(n.bio) + "</p>" : "") +
      (n.lb ? '<p class="nw-lb"><a href="' + esc(n.lb) +
        '" target="_blank" rel="noopener">Letterboxd</a></p>' : "") +
      '<ul class="d-edges">' + (rows || '<li class="edge"><span class="edge-why">No edges yet.</span></li>') +
      "</ul>" + tools;
    panel.classList.add("is-open");
  }

  panel.addEventListener("click", function (e) {
    var b = e.target.closest("button");
    if (!b) return;
    if (b.dataset.sel) { select(b.dataset.sel, { center: true }); return; }
    if (b.dataset.w) {
      var edge = edges.find(function (x) { return x.key === b.dataset.key; });
      var w = Math.min(5, Math.max(1, edge.w + Number(b.dataset.w)));
      if (w === edge.w) return;
      edge.w = w;
      if (w === edge.w0 && !edge.unset) delete overrides[edge.key]; else overrides[edge.key] = w;
      save();
      filter();
      renderPanel();
      reheat(0.3);
      return;
    }
    var act = b.dataset.act;
    if (act === "close") select(null);
    if (act === "reset") {
      overrides = {};
      save();
      edges.forEach(function (x) { x.w = x.w0; });
      filter(); renderPanel(); reheat(0.3);
    }
    if (act === "copy") copyEdits(b);
  });

  // Edits leave the browser as JSON, to be written back into
  // content/directors.json as `w` on each edge.
  function copyEdits(btn) {
    var out = edges.filter(function (e) { return overrides[e.key] != null; })
      .map(function (e) { return { a: e.s, b: e.t, type: e.type, w: e.w }; });
    var text = JSON.stringify(out, null, 2);
    var done = function () { btn.textContent = "Copied"; };
    if (navigator.clipboard) navigator.clipboard.writeText(text).then(done, function () { prompt("Edited weights", text); });
    else prompt("Edited weights", text);
  }

  // The index below doubles as the accessible list: a name there selects
  // it here.
  document.querySelector(".nw-index").addEventListener("click", function (e) {
    var a = e.target.closest("a[data-sel]");
    if (!a || !byId[a.dataset.sel] || visNodes.indexOf(byId[a.dataset.sel]) === -1) return;
    e.preventDefault();
    select(a.dataset.sel, { center: true });
    root.scrollIntoView({ behavior: "smooth", block: "start" });
  });

  // ---- Controls: type, not widgets (DESIGN.md → Views) ----

  function btn(label, on, data) {
    return '<button type="button" class="nw-switch-btn' + (on ? " is-active" : "") +
      '" aria-pressed="' + on + '" ' + data + ">" + label + "</button>";
  }
  function renderControls() {
    var html = '<span class="nw-group">' +
      btn("Core", state.core, 'data-core="1"') + btn("Full list", !state.core, 'data-core="0"') +
      "</span>";
    if (TYPES.length > 1) {
      html += '<span class="nw-group">' + TYPES.map(function (t) {
        return btn(t[1], state.types[t[0]], 'data-type="' + t[0] + '"');
      }).join("") + "</span>";
    }
    var cats = AXES.concat(nodes.some(function (n) { return !n.cat; }) ? [OFF] : []);
    html += '<span class="nw-group nw-group--cats">' + btn("All", !anyCat(), 'data-cat=""') +
      cats.map(function (c) { return btn(c, !!state.cats[c], 'data-cat="' + c + '"'); }).join("") +
      btn("+ Secondary", state.secondary, 'data-secondary="1"') + "</span>";
    html += '<span class="nw-group">' + btn("Without edges", state.loose, 'data-loose="1"') + "</span>";
    html += '<span class="nw-group"><span class="nw-label">Weight \u2265</span>' +
      [1, 2, 3, 4, 5].map(function (w) {
        return btn(String(w), state.minW === w, 'data-min="' + w + '"');
      }).join("") + "</span>" +
      '<span class="nw-group">' + btn("Free", state.layout === "free", 'data-layout="free"') +
      btn("Diagram", state.layout === "diagram", 'data-layout="diagram"') +
      btn("Fit", false, 'data-fit="1"') + "</span>";
    controls.innerHTML = html;
  }
  controls.addEventListener("click", function (e) {
    var b = e.target.closest("button");
    if (!b) return;
    if (b.dataset.fit) { fit(); schedule(); return; }
    if (b.dataset.core) state.core = b.dataset.core === "1";
    if (b.dataset.type) state.types[b.dataset.type] = !state.types[b.dataset.type];
    if (b.dataset.min) state.minW = Number(b.dataset.min);
    if (b.dataset.cat != null) {
      if (!b.dataset.cat) state.cats = {};
      else if (state.cats[b.dataset.cat]) delete state.cats[b.dataset.cat];
      else state.cats[b.dataset.cat] = true;
    }
    if (b.dataset.secondary) state.secondary = !state.secondary;
    if (b.dataset.loose) state.loose = !state.loose;
    if (b.dataset.layout) state.layout = b.dataset.layout;
    filter();
    renderControls();
    renderPanel();
    // Any change to what is shown re-settles and re-fits, so a filtered
    // handful fills the stage instead of keeping its old corner.
    settle();
  });

  // ---- Start: settle off-screen, then draw once, fitted ----

  // A change of arrangement settles off-screen and is shown fitted,
  // rather than animating every name across the canvas.
  function settle() {
    alpha = 1;
    for (var i = 0; i < 320; i++) tick();
    alpha = 0;
    fit();
    schedule();
  }

  readColors();
  filter();
  size();
  settle();
  renderControls();
  // Names elsewhere link here as #g-<slug>; the index entry is the anchor,
  // so open the index when the hash names one, and select it on the canvas.
  var initial = decodeURIComponent(location.hash.slice(1));
  if (initial.indexOf("g-") === 0) initial = initial.slice(2);
  select(byId[initial] ? initial : null, { center: !!byId[initial] });
  if (byId[initial]) {
    var index = document.querySelector(".nw-index");
    if (index) index.open = true;
  }
  draw();

  if (window.ResizeObserver) {
    new ResizeObserver(function () { size(); schedule(); }).observe(stage);
  }
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(schedule);
})();
