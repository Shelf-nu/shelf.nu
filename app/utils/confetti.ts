type ConfettiFn = (options?: Record<string, unknown>) => PromiseLike<unknown>;

let confettiInstancePromise: Promise<ConfettiFn> | null = null;

async function loadConfetti() {
  if (!confettiInstancePromise) {
    confettiInstancePromise = import("canvas-confetti").then(
      (module) => module.default as unknown as ConfettiFn
    );
  }

  return confettiInstancePromise;
}

export async function fireConfettiFromElement(
  element: HTMLElement | null
): Promise<void> {
  if (typeof window === "undefined") return;
  if (!element) return;

  const prefersReducedMotion = window.matchMedia?.(
    "(prefers-reduced-motion: reduce)"
  ).matches;

  if (prefersReducedMotion) return;

  const confetti = await loadConfetti();
  if (!confetti) return;

  const rect = element.getBoundingClientRect();
  const origin = {
    x: (rect.left + rect.width / 2) / window.innerWidth,
    y: (rect.top + rect.height / 2) / window.innerHeight,
  };

  const baseOptions = {
    origin,
    zIndex: 2147483647,
  } as const;

  void confetti({
    ...baseOptions,
    particleCount: 120,
    spread: 70,
    startVelocity: 45,
    gravity: 1.1,
    ticks: 400,
  });

  void confetti({
    ...baseOptions,
    particleCount: 60,
    spread: 50,
    startVelocity: 35,
    scalar: 0.75,
    decay: 0.9,
  });
}
