// @vitest-environment happy-dom
import { mount, flushPromises } from '@vue/test-utils';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { ref } from 'vue';

vi.stubGlobal('useI18n', () => ({
  t: (k: string, p?: Record<string, unknown>) => (p ? `${k}(${JSON.stringify(p)})` : k),
  locale: ref('en'),
}));
vi.stubGlobal('useFormat', () => ({ formatUsdWhole: (n: number) => `$${n}` }));
vi.stubGlobal('useLocalePath', () => (p: string) => `/en${p}`);
vi.stubGlobal('useRequestURL', () => new URL('https://nadeshiko.test/supporters'));
vi.stubGlobal('useSeoMeta', vi.fn());

import SupportersPage from './supporters.vue';

const mounted: { unmount: () => void }[] = [];

async function render() {
  const wrapper = mount(SupportersPage, {
    attachTo: document.body,
    global: {
      stubs: {
        SupportSharedPerks: { template: '<div data-testid="perks-stub" />' },
        SupportTiers: { template: '<div data-testid="tiers-stub" />' },
        UiBaseIcon: true,
        NuxtLink: { props: ['to'], template: '<a :href="to"><slot /></a>' },
        'i18n-t': { props: ['keypath'], template: '<span>{{ keypath }}<slot name="accent" /></span>' },
      },
    },
  });
  mounted.push(wrapper);
  await flushPromises();
  return wrapper;
}

afterEach(() => {
  while (mounted.length) mounted.pop()?.unmount();
});

describe('Supporters page', () => {
  test('shows what you get before the tiers', async () => {
    const html = (await render()).html();

    expect(html.indexOf('perks-stub')).toBeGreaterThan(-1);
    expect(html.indexOf('perks-stub')).toBeLessThan(html.indexOf('tiers-stub'));
  });

  test('the hero states the lowest price and links down to the tiers', async () => {
    const wrapper = await render();

    expect(wrapper.text()).toContain('supporters.fromPrice({"price":"$5"})');
    expect(wrapper.get('[data-testid="supporters-see-tiers"]').attributes('href')).toBe('#support');
  });
});
