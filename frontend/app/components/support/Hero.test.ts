// @vitest-environment happy-dom
import { mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { ref } from 'vue';

const reduced = ref(false);

vi.stubGlobal('useI18n', () => ({
  t: (k: string, p?: Record<string, unknown>) => (p ? `${k}(${JSON.stringify(p)})` : k),
  locale: ref('en'),
}));
vi.stubGlobal('useFormat', () => ({ formatUsdWhole: (n: number) => `$${n}` }));
vi.stubGlobal('useMotionPreference', () => ({ prefersReducedMotion: () => reduced.value }));

import SupportHero from './Hero.vue';

const mounted: { unmount: () => void }[] = [];

function render() {
  const wrapper = mount(SupportHero, {
    global: {
      stubs: {
        UiBaseIcon: true,
        SupportTryIt: true,
        'i18n-t': { props: ['keypath'], template: '<span>{{ keypath }}<slot name="accent" /></span>' },
      },
    },
  });
  mounted.push(wrapper);
  return wrapper;
}

const visible = (wrapper: ReturnType<typeof render>) =>
  wrapper
    .findAll('img')
    .filter((img) => img.classes('opacity-100'))
    .map((img) => img.attributes('data-testid'));

beforeEach(() => {
  vi.useFakeTimers();
  reduced.value = false;
});

afterEach(() => {
  while (mounted.length) mounted.pop()?.unmount();
  vi.useRealTimers();
});

describe('Supporters hero', () => {
  test('states the lowest price and links down to the perks', () => {
    const wrapper = render();

    expect(wrapper.get('[data-testid="support-hero-price"]').text()).toBe('supporters.fromPrice({"price":"$5"})');
    expect(wrapper.get('[data-testid="support-hero-more"]').attributes('href')).toBe('#perks');
  });

  test('the phone steps through the themes by itself', async () => {
    const wrapper = render();
    expect(visible(wrapper)).toEqual(['support-hero-shot-default']);

    await vi.advanceTimersByTimeAsync(3300);
    expect(visible(wrapper)).toEqual(['support-hero-shot-sepia']);
  });

  test('a picked theme stays put', async () => {
    const wrapper = render();

    await wrapper.get('[data-testid="support-hero-theme-midnight"]').trigger('click');
    await vi.advanceTimersByTimeAsync(10_000);
    expect(visible(wrapper)).toEqual(['support-hero-shot-midnight']);
    expect(wrapper.get('[data-testid="support-hero-theme-midnight"]').attributes('aria-pressed')).toBe('true');
  });

  test('stays still with reduced motion', async () => {
    reduced.value = true;
    const wrapper = render();

    await vi.advanceTimersByTimeAsync(10_000);
    expect(visible(wrapper)).toEqual(['support-hero-shot-default']);
  });
});
