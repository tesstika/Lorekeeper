import { nextTick, onScopeDispose, type Ref, watch } from 'vue';

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

export interface OverlayA11yOptions {
  /** Called when Escape is pressed while this overlay is the topmost one. */
  onEscape?: () => void;
}

// ---------------------------------------------------------------------------
// Overlay a11y (M4, no external deps) — designed for Vapor components, where
// template refs (`ref="x"`) do not bind to setup refs. Instead each overlay
// marks its root with a `data-lk-overlay="<token>"` attribute and this module
// resolves containers through the DOM directly.
//
// Behaviour:
//  - focus moves into the overlay on open (first focusable element),
//  - Tab / Shift+Tab are cycled inside the topmost overlay (capture phase),
//  - Escape closes the topmost overlay via `onEscape` (a confirm dialog
//    stacked over a sheet is the topmost one and wins),
//  - focus returns to the triggering element on close/unmount.
// ---------------------------------------------------------------------------

interface OverlayEntry {
  onEscape?: () => void;
}

const overlayStack: string[] = [];
const overlayEntries = new Map<string, OverlayEntry>();
let nextToken = 1;
let listening = false;

function containerOf(token: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(`[data-lk-overlay="${token}"]`);
}

function handleKeydown(event: KeyboardEvent): void {
  const token = overlayStack[overlayStack.length - 1];
  if (!token) return;
  if (event.key === 'Escape') {
    event.stopPropagation();
    overlayEntries.get(token)?.onEscape?.();
    return;
  }
  if (event.key !== 'Tab') return;
  const node = containerOf(token);
  if (!node) return;
  const focusables = Array.from(node.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
  const first = focusables[0];
  if (!first) {
    event.preventDefault();
    node.focus();
    return;
  }
  const last = focusables[focusables.length - 1] ?? first;
  const current = document.activeElement;
  const inside = current instanceof HTMLElement && node.contains(current);
  if (event.shiftKey) {
    if (!inside || current === first) {
      event.preventDefault();
      last.focus();
    }
    return;
  }
  if (!inside || current === last) {
    event.preventDefault();
    first.focus();
  }
}

function ensureListener(): void {
  if (listening) return;
  // Capture phase: the trap wins over any delegated page-level handling.
  document.addEventListener('keydown', handleKeydown, true);
  listening = true;
}

/**
 * Activates overlay a11y behaviour for one overlay. Returns the token that
 * the caller must bind as `:data-lk-overlay="token"` on the overlay root.
 * `open` accepts a ref or a getter so store-driven dialogs (ConfirmDialog)
 * can pass a computed state.
 */
export function useOverlayA11y(
  open: Ref<boolean> | (() => boolean),
  options: OverlayA11yOptions = {},
): { token: number } {
  const token = nextToken++;
  let opener: HTMLElement | null = null;

  function isOpen(): boolean {
    return typeof open === 'function' ? open() : open.value;
  }

  // `immediate` covers call-site-gated sheets that mount with open=true —
  // their watch never sees a false→true flip.
  watch(
    isOpen,
    (open) => {
      if (open) {
        opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        overlayEntries.set(String(token), options);
        overlayStack.push(String(token));
        ensureListener();
        void nextTick(() => {
          const node = containerOf(String(token));
          if (!node) return;
          const first = node.querySelector<HTMLElement>(FOCUSABLE_SELECTOR);
          (first ?? node).focus();
        });
        return;
      }
      const index = overlayStack.indexOf(String(token));
      if (index >= 0) overlayStack.splice(index, 1);
      overlayEntries.delete(String(token));
      opener?.focus();
      opener = null;
    },
    { immediate: true },
  );

  onScopeDispose(() => {
    const index = overlayStack.indexOf(String(token));
    if (index >= 0) overlayStack.splice(index, 1);
    overlayEntries.delete(String(token));
    opener?.focus();
    opener = null;
  });

  return { token };
}
