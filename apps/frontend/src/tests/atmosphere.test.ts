import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, vaporInteropPlugin } from 'vue';
import BackgroundAtmosphere from '../components/ui/BackgroundAtmosphere.vue';

// Vapor components must mount through a VDOM host (M0 §6.1 / test-utils 2.5.0).
function host(
  template: string,
  components: Record<string, object>,
): ReturnType<typeof defineComponent> {
  return defineComponent({ components, template });
}

function mountAtmosphere(effect: 'embers' | 'aurora' | 'stars' | 'off') {
  const Host = host('<div><BackgroundAtmosphere :effect="effect" /></div>', {
    BackgroundAtmosphere,
  });
  return mount(Host, {
    data: () => ({ effect }),
    global: { plugins: [vaporInteropPlugin] },
  });
}

/** jsdom keeps document.hidden on the prototype — shadow it with an own property. */
function setDocumentHidden(value: boolean): void {
  Object.defineProperty(document, 'hidden', { configurable: true, value });
}

let wrapper: ReturnType<typeof mount> | null = null;

beforeEach(() => {
  setDocumentHidden(false);
});

afterEach(() => {
  wrapper?.unmount();
  wrapper = null;
  setDocumentHidden(false);
  delete (document as unknown as { hidden?: boolean }).hidden;
  // Remove a per-test window.matchMedia fake (jsdom ships none by default).
  delete (window as unknown as { matchMedia?: unknown }).matchMedia;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('BackgroundAtmosphere', () => {
  it('renders the low-density star field (45 stars) for stars', () => {
    wrapper = mountAtmosphere('stars');
    expect(wrapper.findAll('.lk-star')).toHaveLength(45);
    expect(wrapper.find('.lk-ember').exists()).toBe(false);
    expect(wrapper.find('.lk-atmosphere').attributes('aria-hidden')).toBe('true');
  });

  it('renders 18 embers for embers', () => {
    wrapper = mountAtmosphere('embers');
    expect(wrapper.findAll('.lk-ember')).toHaveLength(18);
  });

  it('renders the three aurora blobs for aurora', () => {
    wrapper = mountAtmosphere('aurora');
    expect(wrapper.findAll('.lk-aurora-blob')).toHaveLength(3);
    expect(wrapper.find('.lk-aurora-b1').exists()).toBe(true);
  });

  it('renders nothing at all for off', () => {
    wrapper = mountAtmosphere('off');
    expect(wrapper.find('.lk-atmosphere').exists()).toBe(false);
  });

  it('clears particles while the tab is hidden and restores them on return', async () => {
    wrapper = mountAtmosphere('stars');
    expect(wrapper.findAll('.lk-star')).toHaveLength(45);

    setDocumentHidden(true);
    document.dispatchEvent(new Event('visibilitychange'));
    await flushPromises();
    expect(wrapper.find('.lk-atmosphere').exists()).toBe(false);

    setDocumentHidden(false);
    document.dispatchEvent(new Event('visibilitychange'));
    await flushPromises();
    expect(wrapper.findAll('.lk-star')).toHaveLength(45);
  });

  it('renders nothing when the user prefers reduced motion', async () => {
    // jsdom has no matchMedia at all — install a matching fake to simulate the
    // prefers-reduced-motion: reduce media query.
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: () =>
        ({
          matches: true,
          addEventListener: () => {},
          removeEventListener: () => {},
        }) as unknown as MediaQueryList,
    });
    wrapper = mountAtmosphere('stars');
    // The matchMedia read happens in onMounted, after the first render — the
    // resulting unmount of the particle layer flushes on the next tick.
    await flushPromises();
    expect(wrapper.find('.lk-atmosphere').exists()).toBe(false);
  });
});
