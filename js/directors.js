// The directors map — draws the affinity edges as hairlines between the
// column names, and switches between the map's views (affinities by era,
// circles). Enhancement only: without script every view renders in turn
// and the index below states every edge as text.

(function () {
  "use strict";

  var views = {};
  document.querySelectorAll(".dmap").forEach(function (el) {
    views[el.dataset.view] = {
      map: el,
      svg: el.querySelector(".dmap-lines"),
      anchors: {},
      lines: []
    };
    el.querySelectorAll(".dmap-node").forEach(function (a) {
      views[el.dataset.view].anchors[a.dataset.d] = a;
    });
  });
  if (!Object.keys(views).length) return;

  // Edge pairs are read from the index below, where each is declared once.
  // Each carries its weight, one to five, drawn as the line's width: the
  // lightest stays a hairline. An unweighted edge draws at the middle.
  var pairs = [];
  var weight = {};
  document.querySelectorAll(".d-edges .edge").forEach(function (li) {
    var p = [li.dataset.a, li.dataset.b].sort().join("|");
    if (pairs.indexOf(p) === -1) pairs.push(p);
    weight[p] = Number(li.dataset.w) || 3;
  });
  function strokeFor(p) { return (0.6 + (weight[p] - 1) * 0.45).toFixed(2); }

  var neighbors = {};
  pairs.forEach(function (p) {
    var s = p.split("|");
    (neighbors[s[0]] = neighbors[s[0]] || []).push(s[1]);
    (neighbors[s[1]] = neighbors[s[1]] || []).push(s[0]);
  });

  // How far a same-column bracket swings out past the left of its column,
  // and the breathing room kept between a name and the edges that touch it.
  var OFFSET = 10;
  var GAP = 3;

  // The box of the name's own text, not of its column-wide block — edge
  // starts sit just past the last glyph, however long the name is.
  function textRect(el) {
    var range = document.createRange();
    range.selectNodeContents(el);
    var r = range.getBoundingClientRect();
    return r.width ? r : el.getBoundingClientRect();
  }

  function draw(v) {
    while (v.svg.firstChild) v.svg.removeChild(v.svg.firstChild);
    v.lines = [];
    var box = v.map.getBoundingClientRect();
    pairs.forEach(function (p) {
      var slugs = p.split("|");
      var a = v.anchors[slugs[0]];
      var b = v.anchors[slugs[1]];
      // A name filtered out (hidden li) has no box on the page; an edge
      // to it is not drawn rather than sent to the frame's origin.
      function shown(el) { return el && !el.closest("li").hidden; }
      if (!shown(a) || !shown(b)) return;
      var ra = a.getBoundingClientRect();
      var rb = b.getBoundingClientRect();
      var el;
      if (a.closest(".dmap-col") === b.closest(".dmap-col")) {
        // Same column: a bracket on the left, upper name to lower name,
        // both meeting the names just left of the number.
        var top = ra.top <= rb.top ? ra : rb;
        var bot = ra.top <= rb.top ? rb : ra;
        var x1 = top.left - box.left - GAP;
        var y1 = top.top + top.height / 2 - box.top;
        var x2 = bot.left - box.left - GAP;
        var y2 = bot.top + bot.height / 2 - box.top;
        var xo = Math.min(x1, x2) - OFFSET;
        el = document.createElementNS("http://www.w3.org/2000/svg", "path");
        el.setAttribute("d",
          "M " + x1.toFixed(1) + " " + y1.toFixed(1) +
          " L " + xo.toFixed(1) + " " + y1.toFixed(1) +
          " L " + xo.toFixed(1) + " " + y2.toFixed(1) +
          " L " + x2.toFixed(1) + " " + y2.toFixed(1));
      } else {
        // Left to right: from just past the end of the left column's
        // name to just left of the number on the target.
        var leftEl = ra.left < rb.left ? a : b;
        var rightEl = ra.left < rb.left ? b : a;
        var lr = leftEl.getBoundingClientRect();
        var rr = rightEl.getBoundingClientRect();
        var tr = textRect(leftEl);
        el = document.createElementNS("http://www.w3.org/2000/svg", "line");
        el.setAttribute("x1", (tr.right - box.left + GAP).toFixed(1));
        el.setAttribute("y1", (lr.top + lr.height / 2 - box.top).toFixed(1));
        el.setAttribute("x2", (rr.left - box.left - GAP).toFixed(1));
        el.setAttribute("y2", (rr.top + rr.height / 2 - box.top).toFixed(1));
      }
      el.dataset.a = slugs[0];
      el.dataset.b = slugs[1];
      el.style.strokeWidth = strokeFor(p);
      v.svg.appendChild(el);
      v.lines.push(el);
    });
  }

  function focus(v, slug) {
    v.lines.forEach(function (l) {
      var hit = l.dataset.a === slug || l.dataset.b === slug;
      l.classList.toggle("on", hit);
      l.classList.toggle("off", !hit);
    });
    var near = neighbors[slug] || [];
    Object.keys(v.anchors).forEach(function (s) {
      v.anchors[s].classList.toggle(
        "near", s === slug || near.indexOf(s) !== -1
      );
    });
  }

  function blur(v) {
    v.lines.forEach(function (l) {
      l.classList.remove("on", "off");
    });
    Object.keys(v.anchors).forEach(function (s) {
      v.anchors[s].classList.remove("near");
    });
  }

  Object.keys(views).forEach(function (key) {
    var v = views[key];
    v.map.querySelectorAll(".dmap-node").forEach(function (a) {
      a.addEventListener("mouseenter", function () { focus(v, a.dataset.d); });
      a.addEventListener("mouseleave", function () { blur(v); });
      a.addEventListener("focus", function () { focus(v, a.dataset.d); });
      a.addEventListener("blur", function () { blur(v); });
    });
  });

  // ---- The switcher ----

  var sections = {};
  document.querySelectorAll(".dmap-view").forEach(function (s) {
    sections[s.dataset.view] = s;
  });
  var switcher = document.querySelector(".dmap-switch");
  if (!switcher) return;

  function activate(key) {
    if (!views[key]) key = Object.keys(views)[0];
    Object.keys(sections).forEach(function (k) {
      sections[k].hidden = k !== key;
    });
    switcher.querySelectorAll("button").forEach(function (b) {
      var on = b.dataset.view === key;
      b.classList.toggle("is-active", on);
      b.setAttribute("aria-pressed", on ? "true" : "false");
    });
    draw(views[key]);
    if (history.replaceState) {
      history.replaceState(null, "", "#" + key);
    }
  }

  switcher.hidden = false;
  switcher.querySelectorAll("button").forEach(function (b) {
    b.addEventListener("click", function () { activate(b.dataset.view); });
  });
  activate((location.hash || "").replace("#", ""));
  window.addEventListener("resize", function () {
    Object.keys(sections).forEach(function (k) {
      if (!sections[k].hidden) draw(views[k]);
    });
  });

  // ---- The tier filter ----

  // The rest of the list is present in the era view and the index, marked
  // data-tier="2"; Core hides it. Without script nothing is hidden.
  var tierSwitch = document.querySelector(".dmap-switch--tier");
  if (!tierSwitch) return;

  function setTier(which) {
    var core = which === "core";
    document.querySelectorAll('li[data-tier="2"]').forEach(function (li) {
      li.hidden = core;
    });
    tierSwitch.querySelectorAll("button").forEach(function (b) {
      var on = b.dataset.tierBtn === which;
      b.classList.toggle("is-active", on);
      b.setAttribute("aria-pressed", on ? "true" : "false");
    });
    Object.keys(sections).forEach(function (k) {
      if (!sections[k].hidden) draw(views[k]);
    });
  }

  tierSwitch.hidden = false;
  tierSwitch.querySelectorAll("button").forEach(function (b) {
    b.addEventListener("click", function () { setTier(b.dataset.tierBtn); });
  });
  setTier("core");
})();
