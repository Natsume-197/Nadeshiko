// @vitest-environment happy-dom
import { mount } from '@vue/test-utils';
import { describe, expect, test, vi } from 'vitest';
import { ref } from 'vue';

vi.stubGlobal('useI18n', () => ({ t: (k: string) => k, locale: ref('en') }));

import SupportDonate from './Donate.vue';

const render = (props: { kofiUrl?: string; githubSponsorsUrl?: string } = {}) =>
  mount(SupportDonate, { props, global: { stubs: { UiBaseIcon: true } } });

describe('Supporters donations', () => {
  test('stays hidden while neither link is set', () => {
    expect(render({ kofiUrl: '', githubSponsorsUrl: '' }).find('[data-testid="support-donate"]').exists()).toBe(false);
  });

  test('shows a button for each link that is set, opening in a new tab', () => {
    const wrapper = render({
      kofiUrl: 'https://ko-fi.com/example',
      githubSponsorsUrl: 'https://github.com/sponsors/example',
    });

    const kofi = wrapper.get('[data-testid="support-donate-kofi"]');
    expect(kofi.attributes('href')).toBe('https://ko-fi.com/example');
    expect(kofi.attributes('target')).toBe('_blank');
    expect(wrapper.get('[data-testid="support-donate-github"]').attributes('href')).toBe(
      'https://github.com/sponsors/example',
    );
  });

  test('leaves out the button whose link is empty', () => {
    const wrapper = render({ kofiUrl: 'https://ko-fi.com/example', githubSponsorsUrl: '' });

    expect(wrapper.find('[data-testid="support-donate-kofi"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="support-donate-github"]').exists()).toBe(false);
  });
});
