import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import { defineComponent, vaporInteropPlugin } from 'vue';
import BottomNav from '../components/ui/BottomNav.vue';
import VaporHost from '../components/vapor/VaporHost.vue';
import { router } from '../router';

describe('vapor interop (M0 verification, decision D4)', () => {
  it('mounts a pure-vapor SFC inside a classic vdom host', () => {
    const wrapper = mount(VaporHost, {
      props: { message: 'hello from vapor' },
      global: { plugins: [vaporInteropPlugin] },
    });
    expect(wrapper.find('[data-testid="vapor-probe"]').text()).toBe('hello from vapor');
  });

  it('renders vue-router RouterLink inside a vapor component', async () => {
    // test-utils expects a vdom root (its $el accessor does not cover vapor
    // roots yet), so the vapor BottomNav is mounted through a vdom host —
    // the documented interop-wrapper fallback from IMPLEMENTATION_PLAN.md §6.1.
    const NavHost = defineComponent({
      components: { BottomNav },
      template: '<div><BottomNav /></div>',
    });
    const wrapper = mount(NavHost, {
      global: { plugins: [vaporInteropPlugin, router] },
    });
    await router.isReady();
    const links = wrapper.findAll('a');
    expect(links).toHaveLength(3);
    expect(links[0]?.text()).toContain('Chats');
    expect(links[1]?.text()).toContain('Characters');
    expect(links[2]?.text()).toContain('Settings');
  });
});
