// Scroll reveal — enhancement only; pages render fully without it.
document.documentElement.classList.add("js");

const io = new IntersectionObserver(
  (entries) => {
    for (const e of entries) {
      if (e.isIntersecting) {
        e.target.classList.add("in-view");
        io.unobserve(e.target);
      }
    }
  },
  { rootMargin: "0px 0px -8% 0px" }
);

document
  .querySelectorAll(
    ".view figure, .view .entry-head, .view .entry-bio, " +
      ".network figure, .network .entry-head, .network .entry-bio"
  )
  .forEach((el) => io.observe(el));

// Category tooltips — enhancement only. Any label or control carrying
// data-tip (SVG text on the maps, network switches) shows its one line in
// a small box. Without script the page is unchanged.
const tip = document.createElement("div");
tip.className = "tip";
tip.hidden = true;
document.body.appendChild(tip);

const tipped = (e) => (e.target.closest ? e.target.closest("[data-tip]") : null);

function showTip(el) {
  tip.textContent = el.getAttribute("data-tip");
  tip.hidden = false;
  const r = el.getBoundingClientRect();
  const half = tip.offsetWidth / 2;
  tip.style.left =
    Math.min(Math.max(r.left + r.width / 2, half + 8),
             window.innerWidth - half - 8) + "px";
  const below = r.top < 96;
  tip.style.top = (below ? r.bottom + 8 : r.top - 8) + "px";
  tip.classList.toggle("tip-below", below);
}

document.addEventListener("mouseover", (e) => {
  const el = tipped(e);
  if (el) showTip(el);
});
document.addEventListener("mouseout", (e) => {
  const el = tipped(e);
  if (el && !el.contains(e.relatedTarget)) tip.hidden = true;
});
document.addEventListener("focusin", (e) => {
  const el = tipped(e);
  if (el) showTip(el);
});
document.addEventListener("focusout", () => {
  tip.hidden = true;
});
