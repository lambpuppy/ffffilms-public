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
