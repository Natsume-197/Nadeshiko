// @vitest-environment happy-dom
import { mount } from '@vue/test-utils';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { defineComponent, ref } from 'vue';

/** The support section on the Roadmap states the tiers from the shared list, links to the existing Patreon campaign,
 * with one card per tier worded as on Patreon. */

vi.stubGlobal('useI18n', () => ({
  t: (k: string, p?: Record<string, unknown>) => (p ? `${k}(${JSON.stringify(p)})` : k),
  locale: ref('en'),
}));
vi.stubGlobal('useFormat', () => ({ formatNumber: (n: number) => String(n) }));
vi.stubGlobal('useLocalePath', () => (p: string) => `/en${p}`);

import { PATREON_URL } from '#shared/utils/socialLinks';
import { SUPPORT_TIERS } from '~/utils/supportTiers';
import SupportTiers from './Tiers.vue';

const mounted: { unmount: () => void }[] = [];

function render() {
  const Host = defineComponent({ components: { SupportTiers }, template: '<SupportTiers />' });
  const wrapper = mount(Host, {
    global: {
      stubs: {
        NuxtLink: { props: ['to'], template: '<a :href="to"><slot /></a>' },
        UiBaseIcon: true,
        'i18n-t': { props: ['keypath'], template: '<span>{{ keypath }}<slot name="terms" /></span>' },
      },
    },
  });
  mounted.push(wrapper);
  return wrapper;
}

afterEach(() => {
  while (mounted.length) mounted.pop()?.unmount();
});

describe('Support section', () => {
  test('is the #support anchor the footer and Settings link to', () => {
    const section = render().get('[data-testid="support-section"]');

    expect(section.attributes('id')).toBe('support');
  });

  test('lists every tier with its price and API limit', () => {
    const wrapper = render();
    const cards = wrapper.findAll('[data-testid="support-tier-cards"] > li');

    expect(cards).toHaveLength(SUPPORT_TIERS.length);
    SUPPORT_TIERS.forEach((tier, i) => {
      expect(cards[i]?.text()).toContain(tier.kanji);
      expect(cards[i]?.text()).toContain(`"count":"${tier.monthlyApiRequests}"`);
      expect(cards[i]?.text()).toContain('$');
    });
  });

  test('each tier states its monthly request boosts; Nadeshiko builds on Flower', () => {
    const cards = render().findAll('[data-testid="support-tier-cards"] > li');

    expect(cards[0]?.text()).toContain('support.perks.requestBoosts({"count":3})');
    expect(cards[1]?.text()).toContain('support.perks.requestBoosts({"count":5})');
    expect(cards[1]?.text()).toContain('support.perks.talkToDevs');
    expect(cards[2]?.text()).toContain('support.perks.everythingIn({"tier":"support.tiers.flower"})');
    expect(cards[2]?.text()).toContain('support.perks.requestBoosts({"count":10})');
  });

  test('sends readers to the existing Patreon campaign', () => {
    const wrapper = render();

    expect(wrapper.get('[data-testid="support-patreon-link"]').attributes('href')).toBe(PATREON_URL);
  });

  test('each tier card carries its Patreon description and the Discord line', () => {
    const cards = render().findAll('[data-testid="support-tier-cards"] > li');

    SUPPORT_TIERS.forEach((tier, i) => {
      expect(cards[i]?.text()).toContain(`support.tierText.${tier.key}.0`);
      expect(cards[i]?.text()).toContain(`support.tierText.${tier.key}.1`);
      expect(cards[i]?.text()).toContain('support.discord');
    });
  });

  test('the app question points at the Terms', () => {
    const answer = render().get('[data-testid="support-faq-apps"]');

    expect(answer.get('a').attributes('href')).toBe('/en/terms-and-conditions');
  });
});
