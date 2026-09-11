import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import { defineComponent, vaporInteropPlugin } from 'vue';
import NumberStepper from '../components/ui/NumberStepper.vue';

// Class-presence contract tests: mount the real SFC and assert the Tailwind classes
// that carry its visual design are actually rendered (guards against regressions the
// static scanner cannot see, e.g. classes assembled in :class bindings).

function host(template: string, components: Record<string, object>) {
  return defineComponent({ components, template });
}

function mountStepper() {
  return mount(
    host(
      '<div class="lk-host"><NumberStepper v-model="value" label="Budget" :min="0" :max="10" /></div>',
      {
        NumberStepper,
      },
    ),
    {
      data: () => ({ value: 5 }),
      global: { plugins: [vaporInteropPlugin] },
    },
  );
}

describe('NumberStepper styling contract', () => {
  it('renders the stepper chrome classes on the root', () => {
    const wrapper = mountStepper();
    // '.lk-host > div' targets the Vapor child's root; VTU's find() can otherwise
    // match the VDOM host's own root element (which carries no classes).
    const root = wrapper.find('.lk-host > div');
    for (const cls of ['flex', 'items-center', 'gap-2', 'rounded-lg', 'border', 'p-1']) {
      expect(root.classes(), `root should include \`${cls}\``).toContain(cls);
    }
  });

  it('buttons transition colors and transform through a single utility', () => {
    const wrapper = mountStepper();
    const buttons = wrapper.findAll('button');
    expect(buttons).toHaveLength(2);
    for (const button of buttons) {
      // One transition utility must drive both the hover color shift and active:scale-95;
      // a second transition-* utility would silently override the first (stylesheet order).
      expect(button.classes()).toContain('transition');
      expect(button.classes()).not.toContain('transition-transform');
      expect(button.classes()).not.toContain('transition-colors');
      expect(button.classes()).toContain('active:scale-95');
    }
  });
});
