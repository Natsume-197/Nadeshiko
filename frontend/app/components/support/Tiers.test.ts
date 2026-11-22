// @vitest-environment happy-dom
import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { defineComponent, reactive, ref } from 'vue';

/** The support section on the Supporters page states the tiers from the shared list, links directly to each tier's
 * Patreon checkout URL, and guides readers to link their Patreon account (or highlights their active tier). */

const $fetch = vi.fn();
const openLoginModal = vi.fn();
const storeState = reactive({ isLoggedIn: false });

vi.stubGlobal('$fetch', $fetch);
vi.stubGlobal('userStore', () => storeState);
vi.stubGlobal('useLoginModal', () => ({ openLoginModal }));
vi.stubGlobal('useI18n', () => ({
  t: (k: string, p?: Record<string, unknown>) => (p ? `${k}(${JSON.stringify(p)})` : k),
  locale: ref('en'),
}));
vi.stubGlobal('useFormat', () => ({ formatNumber: (n: number) => String(n) }));
vi.stubGlobal('useLocalePath', () => (p: string) => `/en${p}`);

import { SUPPORT_TIERS, tierCheckoutUrl } from '~/utils/supportTiers';
import SupportTiers from './Tiers.vue';

const mounted: { unmount: () => void }[] = [];

async function render() {
  const Host = defineComponent({ components: { SupportTiers }, template: '<SupportTiers />' });
  const wrapper = mount(Host, {
    global: {
      stubs: {
        NuxtLink: { props: ['to'], template: '<a :href="to"><slot /></a>' },
        UiBaseIcon: true,
        'i18n-t': {
          props: ['keypath'],
          template: '<span>{{ keypath }}<slot name="terms" /><slot name="price" /></span>',
        },
      },
    },
  });
  mounted.push(wrapper);
  await flushPromises();
  return wrapper;
}

beforeEach(() => {
  $fetch.mockReset();
  openLoginModal.mockReset();
  storeState.isLoggedIn = false;
});

afterEach(() => {
  while (mounted.length) mounted.pop()?.unmount();
});

describe('Support section', () => {
  test('is the #support anchor the footer and Settings link to', async () => {
    const section = (await render()).get('[data-testid="support-section"]');

    expect(section.attributes('id')).toBe('support');
  });

  test('lists every tier with its price and API limit', async () => {
    const wrapper = await render();
    const cards = wrapper.findAll('[data-testid="support-tier-cards"] > li');

    expect(cards).toHaveLength(SUPPORT_TIERS.length);
    SUPPORT_TIERS.forEach((tier, i) => {
      expect(cards[i]?.text()).toContain(tier.kanji);
      expect(cards[i]?.text()).toContain(`"count":"${tier.monthlyApiRequests}"`);
      expect(cards[i]?.text()).toContain('$');
    });
  });

  test('each tier states its monthly request boosts; Nadeshiko builds on Flower', async () => {
    const cards = (await render()).findAll('[data-testid="support-tier-cards"] > li');

    expect(cards[0]?.text()).toContain('support.perks.requestBoosts({"count":3})');
    expect(cards[1]?.text()).toContain('support.perks.requestBoosts({"count":5})');
    expect(cards[1]?.text()).toContain('support.perks.talkToDevs');
    expect(cards[2]?.text()).toContain('support.perks.everythingIn({"tier":"support.tiers.flower"})');
    expect(cards[2]?.text()).toContain('support.perks.requestBoosts({"count":10})');
  });

  test('links each tier card directly to its Patreon checkout URL', async () => {
    const links = (await render()).findAll('[data-testid="support-patreon-link"]');

    expect(links).toHaveLength(SUPPORT_TIERS.length);
    SUPPORT_TIERS.forEach((tier, i) => {
      expect(links[i]?.attributes('href')).toBe(tierCheckoutUrl(tier));
    });
  });

  test('each tier card carries its short description and the Discord line', async () => {
    const cards = (await render()).findAll('[data-testid="support-tier-cards"] > li');

    SUPPORT_TIERS.forEach((tier, i) => {
      expect(cards[i]?.text()).toContain(`support.tierText.${tier.key}`);
      expect(cards[i]?.text()).toContain('support.discord');
    });
  });

  test('guides signed-out readers to sign in to link Patreon', async () => {
    const wrapper = await render();

    expect(wrapper.find('[data-testid="support-active-banner"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="support-link-strip"]').exists()).toBe(true);
    await wrapper.get('[data-testid="support-link-login-cta"]').trigger('click');
    expect(openLoginModal).toHaveBeenCalledTimes(1);
  });

  test('guides signed-in free readers to Settings #connections', async () => {
    storeState.isLoggedIn = true;
    $fetch.mockResolvedValue({ quota: { limit: 5000, tier: { id: 'free', displayName: 'Free' } } });

    const wrapper = await render();

    expect(wrapper.find('[data-testid="support-active-banner"]').exists()).toBe(false);
    expect(wrapper.get('[data-testid="support-link-settings-cta"]').attributes('href')).toBe(
      '/en/user/settings#connections',
    );
  });

  test('highlights the active tier and hides the link strip for signed-in supporters', async () => {
    storeState.isLoggedIn = true;
    $fetch.mockResolvedValue({ quota: { limit: 30000, tier: { id: 'pro', displayName: 'Flower' } } });

    const wrapper = await render();

    expect(wrapper.get('[data-testid="support-active-banner"]').text()).toContain('support.tiers.flower');
    expect(wrapper.find('[data-testid="support-link-strip"]').exists()).toBe(false);
    const cards = wrapper.findAll('[data-testid="support-tier-cards"] > li');
    expect(cards[1]?.find('[data-testid="support-current-tier-badge"]').exists()).toBe(true);
    expect(cards[0]?.find('[data-testid="support-current-tier-badge"]').exists()).toBe(false);
  });

  test('the app question points at the Terms', async () => {
    const answer = (await render()).get('[data-testid="support-faq-apps"]');

    expect(answer.get('a').attributes('href')).toBe('/en/terms-and-conditions');
  });
});
