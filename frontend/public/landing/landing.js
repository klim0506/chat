const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

const supportsReducedMotion =
  window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ?? false;

function setupMobileMenu() {
  const menu = $("[data-menu]");
  const btn = $("[data-menu-btn]");
  if (!menu || !btn) return;

  const close = () => {
    menu.hidden = true;
    btn.setAttribute("aria-expanded", "false");
  };

  const open = () => {
    menu.hidden = false;
    btn.setAttribute("aria-expanded", "true");
  };

  close();

  btn.addEventListener("click", () => {
    if (menu.hidden) open();
    else close();
  });

  menu.addEventListener("click", (e) => {
    const a = e.target.closest("a");
    if (a) close();
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") close();
  });
}

function setupSmoothScroll() {
  if (supportsReducedMotion) return;
  $$('a[href^="#"]').forEach((a) => {
    a.addEventListener("click", (e) => {
      const href = a.getAttribute("href");
      if (!href || href === "#") return;
      const target = $(href);
      if (!target) return;
      e.preventDefault();
      target.scrollIntoView({ behavior: "smooth", block: "start" });
      history.pushState(null, "", href);
    });
  });
}

function setupAccordion() {
  const root = $("[data-accordion]");
  if (!root) return;
  const items = $$("details", root);
  items.forEach((d) => {
    d.addEventListener("toggle", () => {
      if (!d.open) return;
      items.forEach((other) => {
        if (other !== d) other.open = false;
      });
    });
  });
}

function setupCounters() {
  if (supportsReducedMotion) return;
  const nodes = $$("[data-counter]");
  if (!nodes.length) return;

  const animate = (node) => {
    const to = Number(node.getAttribute("data-counter"));
    if (!Number.isFinite(to)) return;

    const from = 0;
    const ms = 650;
    const start = performance.now();

    const tick = (now) => {
      const t = Math.min(1, (now - start) / ms);
      const eased = 1 - Math.pow(1 - t, 3);
      const val = Math.round(from + (to - from) * eased);
      node.textContent = String(val);
      if (t < 1) requestAnimationFrame(tick);
    };

    requestAnimationFrame(tick);
  };

  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        io.unobserve(e.target);
        animate(e.target);
      }
    },
    { threshold: 0.55 }
  );

  nodes.forEach((n) => io.observe(n));
}

function setupYear() {
  const y = $("[data-year]");
  if (y) y.textContent = String(new Date().getFullYear());
}

setupMobileMenu();
setupSmoothScroll();
setupAccordion();
setupCounters();
setupYear();
