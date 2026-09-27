// The Circle's side panel — the same reading of a director the network's
// panel gives: the meta line, the guide's bio, the Letterboxd page and
// every edge with its reason. Enhancement only: without script each name
// is a link to the director's entry on the network page.

(function () {
  "use strict";
  var dataEl = document.getElementById("dg-data");
  var panel = document.querySelector(".dg-panel");
  if (!dataEl || !panel) return;
  var DATA = JSON.parse(dataEl.textContent);

  var byId = {};
  DATA.nodes.forEach(function (n) { byId[n.id] = n; });
  var edges = DATA.edges.map(function (e) {
    return { s: e[0], t: e[1], type: e[2], w: e[3], note: e[4], prov: e[5],
             ref: e[6], unset: e[7] };
  });

  var sel = null;

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

  function render() {
    var n = byId[sel];
    var mine = edges.filter(function (e) { return e.s === sel || e.t === sel; })
      .sort(function (a, b) { return b.w - a.w; });
    var rows = mine.map(function (e) {
      var o = byId[e.s === sel ? e.t : e.s];
      var w = e.unset ? "not yet weighted" : e.prov || "";
      return '<li class="edge">' +
        '<span class="edge-rel">' + relLabel(e, sel) + "</span>" +
        '<button type="button" class="nw-to" data-sel="' + o.id + '">' + esc(o.name) + "</button>" +
        (e.note ? '<span class="edge-why">' + esc(e.note) + "</span>" : "") +
        (e.ref ? '<span class="edge-why">' + (/^https?:\/\//.test(e.ref)
          ? '<a href="' + esc(e.ref) + '">Source</a>'
          : "Source: " + esc(e.ref)) + "</span>" : "") +
        '<span class="nw-w"><span class="nw-wn">' + e.w + "</span>" +
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
      '<ul class="d-edges">' + (rows ||
        '<li class="edge"><span class="edge-why">No edges yet.</span></li>') +
      "</ul>";
  }

  function select(id) {
    if (!id || !byId[id]) {
      sel = null;
      panel.classList.remove("is-open");
      return;
    }
    sel = id;
    render();
    panel.classList.add("is-open");
  }

  document.addEventListener("click", function (e) {
    var a = e.target.closest("[data-sel]");
    if (!a || !byId[a.dataset.sel]) return;
    e.preventDefault();
    select(a.dataset.sel);
  });

  panel.addEventListener("click", function (e) {
    var b = e.target.closest("button");
    if (b && b.dataset.act === "close") select(null);
  });

  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && sel) select(null);
  });
})();
