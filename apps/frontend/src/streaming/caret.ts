// ---------------------------------------------------------------------------
// Streaming caret animation helper (plan §6.7, D9 — Stage A).
//
// The caret is an inline-block bar that reflows with the text (it follows line
// wraps automatically). After each delta batch a FLIP step (First, Last,
// Invert, Play) animates it from its old position to the new one so rapid
// tokens produce a continuous glide. Reduced motion or a delta rate beyond the
// animation budget skips the FLIP step (the caret simply reflows).
// ---------------------------------------------------------------------------

export const FLIP_DURATION_MS = 150;
export const MAX_COMMITS_PER_SECOND = 30;

export function prefersReducedMotion(): boolean {
  try {
    return (
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true
    );
  } catch {
    return false;
  }
}

export class CaretAnimator {
  #commits: number[] = [];

  constructor(private readonly getCaret: () => HTMLElement | null) {}

  /**
   * Applies a DOM update that moves the text end, animating the caret's slide
   * with FLIP when the environment allows it.
   */
  apply(update: () => void): void {
    const caret = this.getCaret();
    if (
      !caret ||
      prefersReducedMotion() ||
      this.#overBudget() ||
      typeof caret.animate !== 'function'
    ) {
      update();
      return;
    }
    // First: position before the update commits.
    const first = caret.getBoundingClientRect();
    update();
    // Last / Invert / Play: animate old → new with an interruptible WAAPI step
    // (each new delta starts from the current interpolated position).
    const last = caret.getBoundingClientRect();
    const dx = first.left - last.left;
    const dy = first.top - last.top;
    if (dx === 0 && dy === 0) return;
    caret.animate(
      [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'translate(0, 0)' }],
      { duration: FLIP_DURATION_MS, easing: 'ease-out' },
    );
  }

  /** Coalescing guard: beyond ~30 commits/s the FLIP step is skipped. */
  #overBudget(): boolean {
    const now = performance.now();
    this.#commits = this.#commits.filter((timestamp) => now - timestamp < 1000);
    this.#commits.push(now);
    return this.#commits.length > MAX_COMMITS_PER_SECOND;
  }
}
