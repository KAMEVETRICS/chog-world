// Chog World landing page: scroll reveals, cube parallax and live numbers from the city.
import "../theme/chog.css";
import "./home.css";

const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// Reveal on scroll.
const reveal = new IntersectionObserver((entries) => {
  for (const entry of entries) {
    if (!entry.isIntersecting) continue;
    entry.target.classList.add("is-in");
    reveal.unobserve(entry.target);
  }
}, { threshold: 0.18, rootMargin: "0px 0px -40px 0px" });
document.querySelectorAll(".cw-reveal").forEach((el) => (reduced ? el.classList.add("is-in") : reveal.observe(el)));

// The hero's cubes drift a little with the pointer.
if (!reduced) {
  const cubes = [...document.querySelectorAll<HTMLElement>(".hero .cube")];
  window.addEventListener("pointermove", (event) => {
    const x = event.clientX / window.innerWidth - 0.5;
    const y = event.clientY / window.innerHeight - 0.5;
    cubes.forEach((cube, i) => {
      const depth = 10 + i * 6;
      cube.style.setProperty("--px", `${(x * depth).toFixed(1)}px`);
      cube.style.setProperty("--py", `${(y * depth).toFixed(1)}px`);
    });
  }, { passive: true });
}

/** Counts a number up when it scrolls into view. */
function countTo(el: Element, value: number): void {
  const format = (n: number) => Math.round(n).toLocaleString("en-US");
  if (reduced) { el.textContent = format(value); return; }
  const observer = new IntersectionObserver((entries) => {
    if (!entries.some((e) => e.isIntersecting)) return;
    observer.disconnect();
    const start = performance.now();
    const frame = (now: number) => {
      const t = Math.min(1, (now - start) / 1400);
      el.textContent = format(value * (1 - Math.pow(1 - t, 3)));
      if (t < 1) requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }, { threshold: 0.4 });
  observer.observe(el);
}

interface Snapshot {
  world: {
    agents: unknown[];
    citizens?: unknown[];
    treasury?: { coins: number };
    params?: { values: { wage: number } };
    proposals?: Array<{ status: string }>;
  };
}

async function liveNumbers(): Promise<void> {
  let snapshot: Snapshot;
  try {
    const response = await fetch("/api/city/snapshot");
    if (!response.ok) return;
    snapshot = (await response.json()) as Snapshot;
  } catch {
    return; // The page still reads fine with its zeros; the numbers are a bonus.
  }
  const { world } = snapshot;
  const values: Record<string, number | string> = {
    chogs: world.agents.length,
    villagers: world.citizens?.length ?? 0,
    treasury: world.treasury?.coins ?? 0,
    proposals: world.proposals?.filter((p) => p.status === "open").length ?? 0,
    wage: world.params ? `${world.params.values.wage}c` : "–",
  };
  document.querySelectorAll<HTMLElement>("[data-stat]").forEach((el) => {
    const value = values[el.dataset.stat!];
    if (typeof value === "number") countTo(el, value);
    else if (value !== undefined) el.textContent = value;
  });
}

void liveNumbers();
