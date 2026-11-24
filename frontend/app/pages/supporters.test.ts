// @vitest-environment happy-dom
import { mount, flushPromises } from '@vue/test-utils';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { ref } from 'vue';

vi.stubGlobal('useI18n', () => ({ t: (k: string) => k, locale: ref('en') }));
vi.stubGlobal('useLocalePath', () => (p: string) => `/en${p}`);
vi.stubGlobal('useRequestURL', () => new URL('https://nadeshiko.test/supporters'));
vi.stubGlobal('useSeoMeta', vi.fn());

import { PATREON_URL } from '#shared/utils/socialLinks';
import SupportersPage from './supporters.vue';

const mounted: { unmount: () => void }[] = [];

async function render() {
  const wrapper = mount(SupportersPage, {
    attachTo: document.body,
    global: {
      stubs: {
        SupportTiers: { template: '<div data-testid="tiers-stub" />' },
        UiBaseIcon: true,
        NuxtLink: { props: ['to'], template: '<a :href="to"><slot /></a>' },
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
  test('renders the tiers section and links hero CTAs to Patreon and content requests', async () => {
    const wrapper = await render();

    expect(wrapper.find('[data-testid="tiers-stub"]').exists()).toBe(true);
    expect(wrapper.get('[data-testid="supporters-hero-patreon-cta"]').attributes('href')).toBe(PATREON_URL);
    expect(wrapper.get('[data-testid="supporters-requests-cta"]').attributes('href')).toBe('/en/requests');
  });
});
