// @vitest-environment happy-dom
import { mount, flushPromises } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { defineComponent, ref, watch } from 'vue';

/** The requests page: a public list rendered on the server, votes and boosts for signed-in readers, and the form. */

vi.mock('~/utils/apiError', () => ({
  handleApiError: vi.fn(),
  apiErrorStatus: (err: { status?: number }) => err?.status,
}));

const $fetch = vi.fn();
const openLoginModal = vi.fn();
const toastSuccess = vi.fn();
const userState = { isLoggedIn: false };
vi.stubGlobal('$fetch', $fetch);
vi.stubGlobal('useI18n', () => ({
  t: (k: string, p?: Record<string, unknown>) => (p ? `${k} ${JSON.stringify(p)}` : k),
  locale: ref('en'),
}));
vi.stubGlobal('useLocalePath', () => (p: string) => `/en${p}`);
vi.stubGlobal('useRequestURL', () => new URL('https://nadeshiko.test/requests'));
vi.stubGlobal('useSeoMeta', vi.fn());
vi.stubGlobal('userStore', () => userState);
vi.stubGlobal('useLoginModal', () => ({ openLoginModal }));
vi.stubGlobal('useToastSuccess', toastSuccess);
vi.stubGlobal('useAsyncData', async (_k: unknown, handler: () => Promise<unknown>, options?: { watch?: unknown[] }) => {
  const data = ref<unknown>(null);
  const refresh = async () => {
    data.value = await handler();
  };
  await refresh();
  if (options?.watch) watch(options.watch as never, refresh, { deep: true });
  return { data, refresh, pending: ref(false), error: ref(null) };
});

import RequestsPage from './requests.vue';

const frieren = {
  id: '11111111-1111-4111-8111-111111111111',
  category: 'ANIME',
  kind: 'NEW',
  status: 'OPEN',
  title: 'Frieren',
  note: 'Season 2',
  sourceUrl: 'https://anilist.co/anime/154587',
  coverUrl: null,
  declineReason: null,
  voteCount: 3,
  boostCount: 1,
  score: 8,
  media: null,
  createdAt: '2026-11-20T00:00:00Z',
  releasedAt: null,
};

const allowance = {
  isPatron: true,
  openCount: 1,
  openLimit: 30,
  boosts: { perMonth: 5, used: 1, remaining: 4, resetsAt: '2026-12-01T00:00:00Z' },
  votedIds: [] as string[],
  boostedIds: [] as string[],
  ownIds: [] as string[],
};

const mounted: { unmount: () => void }[] = [];

async function render() {
  const Host = defineComponent({
    components: { Page: RequestsPage },
    template: '<Suspense><Page /></Suspense>',
  });
  const wrapper = mount(Host, {
    attachTo: document.body,
    global: {
      stubs: { UiBaseIcon: true, NuxtLink: { props: ['to'], template: '<a :href="to"><slot /></a>' } },
    },
  });
  mounted.push(wrapper);
  await flushPromises();
  return wrapper;
}

function route(handlers: Record<string, (options?: { method?: string; body?: unknown; query?: unknown }) => unknown>) {
  $fetch.mockImplementation(async (url: string, options?: { method?: string }) => {
    const key = `${options?.method ?? 'GET'} ${url}`;
    const handler = handlers[key] ?? handlers[url];
    if (!handler) throw new Error(`unexpected ${key}`);
    return handler(options);
  });
}

beforeEach(() => {
  $fetch.mockReset();
  openLoginModal.mockReset();
  toastSuccess.mockReset();
  userState.isLoggedIn = false;
});

afterEach(() => {
  while (mounted.length) mounted.pop()?.unmount();
});

describe('/requests', () => {
  test('lists open requests by score for anonymous readers, and asks them to sign in to vote', async () => {
    route({ '/v1/requests': () => ({ items: [frieren], total: 1 }) });
    const wrapper = await render();

    expect($fetch).toHaveBeenCalledWith('/v1/requests', {
      query: { status: 'ACTIVE', sort: 'TOP', page: 1, take: 24 },
    });
    expect(wrapper.get(`[data-testid="request-${frieren.id}"]`).text()).toContain('Frieren');
    expect(wrapper.find('[data-testid="requests-allowance"]').exists()).toBe(false);

    await wrapper.get(`[data-testid="request-vote-${frieren.id}"]`).trigger('click');
    expect(openLoginModal).toHaveBeenCalledWith('content_request');
  });

  test('labels open drama requests as not ingestable yet', async () => {
    const drama = { ...frieren, id: '22222222-2222-4222-8222-222222222222', category: 'JDRAMA', title: 'First Love' };
    route({ '/v1/requests': () => ({ items: [frieren, drama], total: 2 }) });
    const wrapper = await render();

    expect(wrapper.find(`[data-testid="request-no-ingest-${drama.id}"]`).text()).toBe('requests.noIngestYet');
    expect(wrapper.find(`[data-testid="request-no-ingest-${frieren.id}"]`).exists()).toBe(false);
  });

  test('filters by category and status', async () => {
    route({ '/v1/requests': () => ({ items: [], total: 0 }) });
    const wrapper = await render();

    await wrapper.get('[data-testid="requests-category-JDRAMA"]').trigger('click');
    await flushPromises();
    expect($fetch).toHaveBeenLastCalledWith('/v1/requests', {
      query: { status: 'ACTIVE', sort: 'TOP', page: 1, take: 24, category: 'JDRAMA' },
    });

    await wrapper.get('[data-testid="requests-tab-RELEASED"]').trigger('click');
    await flushPromises();
    expect($fetch).toHaveBeenLastCalledWith('/v1/requests', {
      query: { status: 'RELEASED', sort: 'TOP', page: 1, take: 24, category: 'JDRAMA' },
    });
    expect(wrapper.get('[data-testid="requests-empty"]').text()).toBe('requests.empty.RELEASED');
  });

  test('a signed-in patron votes and boosts', async () => {
    userState.isLoggedIn = true;
    const state = { ...allowance };
    route({
      '/v1/requests': () => ({ items: [frieren], total: 1 }),
      '/v1/requests/me': () => ({ ...state }),
      [`POST /v1/requests/${frieren.id}/vote`]: () => {
        state.votedIds = [frieren.id];
        return { ...frieren, voteCount: 4, score: 9 };
      },
      [`POST /v1/requests/${frieren.id}/boost`]: () => {
        state.boostedIds = [frieren.id];
        return { ...frieren, voteCount: 4, boostCount: 2, score: 14 };
      },
    });
    const wrapper = await render();
    expect(wrapper.get('[data-testid="requests-allowance"]').text()).toContain('"remaining":4');

    await wrapper.get(`[data-testid="request-vote-${frieren.id}"]`).trigger('click');
    await flushPromises();
    const vote = wrapper.get(`[data-testid="request-vote-${frieren.id}"]`);
    expect(vote.attributes('aria-pressed')).toBe('true');
    expect(vote.text()).toContain('9');

    await wrapper.get(`[data-testid="request-boost-${frieren.id}"]`).trigger('click');
    await flushPromises();
    expect(wrapper.get(`[data-testid="request-vote-${frieren.id}"]`).text()).toContain('14');
    expect(wrapper.get(`[data-testid="request-boost-${frieren.id}"]`).attributes('disabled')).toBeDefined();
    expect(toastSuccess).toHaveBeenCalled();
  });

  test('the form turns a bare ASIN into an Audible link and reports a vote on an existing request', async () => {
    userState.isLoggedIn = true;
    const posted: unknown[] = [];
    route({
      '/v1/requests': () => ({ items: [], total: 0 }),
      '/v1/requests/me': () => allowance,
      'POST /v1/requests': (options) => {
        posted.push(options?.body);
        return { request: { ...frieren, title: 'Oregairu 1' }, outcome: 'voted' };
      },
    });
    const wrapper = await render();
    await wrapper.get('[data-testid="requests-new"]').trigger('click');
    await wrapper.get('#request-url').setValue('b07ppmbzhx');
    await wrapper.get('[data-testid="requests-form"]').trigger('submit');
    await flushPromises();

    expect(posted).toEqual([{ sourceUrl: 'https://www.audible.co.jp/pd/B07PPMBZHX' }]);
    expect(toastSuccess).toHaveBeenCalledWith('requests.outcome.voted {"title":"Oregairu 1"}');
    expect(wrapper.find('[data-testid="requests-form"]').exists()).toBe(false);
  });

  test('the form refuses unsupported sites and asks for a title when the link has none', async () => {
    userState.isLoggedIn = true;
    route({
      '/v1/requests': () => ({ items: [], total: 0 }),
      '/v1/requests/me': () => allowance,
      'POST /v1/requests': () => {
        throw Object.assign(new Error('bad'), { status: 400 });
      },
    });
    const wrapper = await render();
    await wrapper.get('[data-testid="requests-new"]').trigger('click');

    await wrapper.get('#request-url').setValue('https://myanimelist.net/anime/21');
    await wrapper.get('[data-testid="requests-form"]').trigger('submit');
    expect(wrapper.get('[data-testid="requests-form-error"]').text()).toBe('requests.form.unsupported');

    await wrapper.get('#request-url').setValue('https://www.themoviedb.org/tv/94796');
    await wrapper.get('[data-testid="requests-form"]').trigger('submit');
    await flushPromises();
    expect(wrapper.get('[data-testid="requests-form-error"]').text()).toBe('requests.form.needsTitle');
    expect(wrapper.find('[data-testid="requests-title"]').exists()).toBe(true);
  });
});
