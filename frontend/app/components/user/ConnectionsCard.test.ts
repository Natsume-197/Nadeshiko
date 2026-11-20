// @vitest-environment happy-dom
import { mount } from '@vue/test-utils';
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { nextTick } from 'vue';

const handleApiError = vi.fn();
vi.mock('~/utils/apiError', () => ({ handleApiError: (...a: unknown[]) => handleApiError(...a) }));

const $fetch = vi.fn();
vi.stubGlobal('$fetch', $fetch);
vi.stubGlobal('useI18n', () => ({
  t: (key: string, params?: Record<string, unknown>) => (params ? `${key}(${params.name})` : key),
}));

import ConnectionsCard from './ConnectionsCard.vue';

interface PatreonConnection {
  linked: true;
  fullName: string | null;
  active: boolean;
  patronStatus: string | null;
}

const mounted: { unmount: () => void }[] = [];

async function render(conn: PatreonConnection | null, patreonUrl = 'https://www.patreon.com/c/NadeshikoApp') {
  $fetch.mockResolvedValueOnce({ connection: conn, patreonUrl });
  const wrapper = mount(ConnectionsCard, { global: { stubs: { UiBaseIcon: true } } });
  mounted.push(wrapper);
  for (let i = 0; i < 5; i++) await nextTick();
  return wrapper;
}

const toggle = (w: ReturnType<typeof mount>) => w.get('[data-testid="patreon-connection-toggle"]');
const description = (w: ReturnType<typeof mount>) => w.get('[data-testid="patreon-connection-description"]');

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal(
    'confirm',
    vi.fn(() => true),
  );
});

afterEach(() => {
  for (const wrapper of mounted.splice(0)) wrapper.unmount();
});

describe('Patreon connection states', () => {
  test('offers to connect when no Patreon account is linked', async () => {
    const wrapper = await render(null);

    expect(toggle(wrapper).text()).toBe('connections.patreon.connect');
    expect(description(wrapper).text()).toBe('connections.patreon.description');
  });

  test('names an active patron and offers to disconnect', async () => {
    const wrapper = await render({ linked: true, fullName: 'Lumi', active: true, patronStatus: 'active_patron' });

    expect(toggle(wrapper).text()).toBe('connections.patreon.disconnect');
    expect(description(wrapper).text()).toBe('connections.patreon.active(Lumi)');
    expect(wrapper.find('a[href*="patreon"]').exists()).toBe(false);
  });

  test('shows a join link for a linked but inactive patron', async () => {
    const wrapper = await render(
      { linked: true, fullName: null, active: false, patronStatus: 'former_patron' },
      'https://patreon.test/join',
    );

    expect(description(wrapper).text()).toBe('connections.patreon.inactive(connections.patreon.member)');
    expect(wrapper.get('a[href="https://patreon.test/join"]').text()).toBe('connections.patreon.join');
  });
});

describe('connecting and disconnecting Patreon', () => {
  test('starts OAuth via POST when connecting', async () => {
    const wrapper = await render(null);
    $fetch.mockResolvedValueOnce({ authorizeUrl: 'https://patreon.test/oauth' });

    await toggle(wrapper).trigger('click');
    await nextTick();

    expect($fetch).toHaveBeenLastCalledWith('/v1/user/connections/patreon', { method: 'POST' });
  });

  test('reports a start failure and re-enables the button', async () => {
    const wrapper = await render(null);
    $fetch.mockRejectedValueOnce(new Error('down'));

    await toggle(wrapper).trigger('click');
    await nextTick();

    expect(handleApiError).toHaveBeenCalledWith('patreonConnection.start', expect.anything());
    expect(toggle(wrapper).attributes('disabled')).toBeUndefined();
  });

  test('asks for confirmation before disconnecting', async () => {
    const wrapper = await render({ linked: true, fullName: 'Lumi', active: true, patronStatus: 'active_patron' });
    vi.stubGlobal(
      'confirm',
      vi.fn(() => false),
    );

    await toggle(wrapper).trigger('click');
    await nextTick();

    expect($fetch).not.toHaveBeenCalledWith('/v1/user/connections/patreon', { method: 'DELETE' });
  });

  test('unlinks and returns the card to unlinked state', async () => {
    const wrapper = await render({ linked: true, fullName: 'Lumi', active: true, patronStatus: 'active_patron' });
    $fetch.mockResolvedValueOnce({});

    await toggle(wrapper).trigger('click');
    await nextTick();
    await nextTick();

    expect($fetch).toHaveBeenLastCalledWith('/v1/user/connections/patreon', { method: 'DELETE' });
    expect(toggle(wrapper).text()).toBe('connections.patreon.connect');
  });

  test('reports a load failure without throwing', async () => {
    $fetch.mockRejectedValueOnce(new Error('down'));
    const wrapper = mount(ConnectionsCard, { global: { stubs: { UiBaseIcon: true } } });
    mounted.push(wrapper);
    for (let i = 0; i < 5; i++) await nextTick();

    expect(handleApiError).toHaveBeenCalledWith('patreonConnection.load', expect.anything(), { toastKey: false });
  });
});
