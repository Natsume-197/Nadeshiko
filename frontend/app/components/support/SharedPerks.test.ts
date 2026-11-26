// @vitest-environment happy-dom
import { mount } from '@vue/test-utils';
import { describe, expect, test, vi } from 'vitest';
import { ref } from 'vue';

vi.stubGlobal('useMotionPreference', () => ({ prefersReducedMotion: () => true }));
vi.stubGlobal('useI18n', () => ({
  t: (k: string, p?: Record<string, unknown>) => (p ? `${k}(${JSON.stringify(p)})` : k),
  locale: ref('en'),
}));

import SupportSharedPerks from './SharedPerks.vue';

function render() {
  return mount(SupportSharedPerks, {
    global: {
      stubs: {
        UiBaseIcon: true,
        SupportTryIt: true,
        'i18n-t': { props: ['keypath'], template: '<span>{{ keypath }}<slot name="accent" /></span>' },
      },
    },
  });
}

const pressed = (els: { attributes: (n: string) => string | undefined }[]) =>
  els.map((e) => e.attributes('aria-pressed'));

describe('Shared perks', () => {
  test('is the #perks anchor the hero links to', () => {
    expect(render().get('[data-testid="support-shared-perks"]').attributes('id')).toBe('perks');
  });

  test('picking an episode marks it and every earlier one as watched', async () => {
    const wrapper = render();
    const episodes = wrapper.findAll('[data-testid="perk-episode"]');

    await episodes[4]?.trigger('click');
    expect(pressed(wrapper.findAll('[data-testid="perk-episode"]'))).toEqual([
      'true',
      'true',
      'true',
      'true',
      'true',
      'false',
    ]);
  });

  test('the Plan to Watch switch toggles', async () => {
    const wrapper = render();
    const toggle = wrapper.get('[data-testid="perk-hide-planning"]');

    expect(toggle.attributes('aria-checked')).toBe('true');
    await toggle.trigger('click');
    expect(toggle.attributes('aria-checked')).toBe('false');
  });

  test('one custom list is picked at a time', async () => {
    const wrapper = render();

    await wrapper.findAll('[data-testid="perk-custom-list"]')[2]?.trigger('click');
    expect(pressed(wrapper.findAll('[data-testid="perk-custom-list"]'))).toEqual(['false', 'false', 'true', 'false']);
  });

  test('a boost adds five votes and moves the request up the ranking', async () => {
    const wrapper = render();
    const order = () =>
      wrapper
        .findAll('[data-testid^="perk-request-"]')
        .filter((el) => !el.attributes('data-testid')?.endsWith('score'))
        .map((el) => el.attributes('data-testid'));

    expect(order().at(-1)).toBe('perk-request-fmab');

    const fmab = wrapper.get('[data-testid="perk-request-fmab"]');
    await fmab.get('[data-testid="perk-boost"]').trigger('click');

    expect(order()[1]).toBe('perk-request-fmab');
    expect(wrapper.get('[data-testid="perk-request-fmab"] [data-testid="perk-request-score"]').text()).toBe('11');
  });

  test('unfollowing the word hides its alert', async () => {
    const wrapper = render();
    expect(wrapper.find('[data-testid="perk-alert"]').exists()).toBe(true);

    await wrapper.get('[data-testid="perk-follow"]').trigger('click');
    expect(wrapper.find('[data-testid="perk-alert"]').exists()).toBe(false);
  });
});
