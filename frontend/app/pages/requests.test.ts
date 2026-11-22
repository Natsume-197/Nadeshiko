// @vitest-environment happy-dom
import { mount, flushPromises } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { defineComponent, reactive, ref, watch } from 'vue';

/** The requests page: a public list rendered on the server, votes and boosts for signed-in readers, and the form. */

vi.mock('~/utils/apiError', () => ({
  handleApiError: vi.fn(),
  apiErrorStatus: (err: { status?: number }) => err?.status,
}));

const $fetch = vi.fn();
const openLoginModal = vi.fn();
const toastSuccess = vi.fn();
const userState = { isLoggedIn: false, isAdmin: false };
const routeState = reactive({ query: {} as Record<string, string> });
vi.stubGlobal('$fetch', $fetch);
vi.stubGlobal('useI18n', () => ({
  t: (k: string, p?: Record<string, unknown>) => (p ? `${k} ${JSON.stringify(p)}` : k),
  locale: ref('en'),
}));
vi.stubGlobal('useRoute', () => routeState);
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
  boosts: {
    perMonth: 5,
    used: 1,
    remaining: 4,
    resetsAt: '2026-12-01T00:00:00Z',
  },
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
      stubs: {
        UiBaseIcon: true,
        NuxtLink: { props: ['to'], template: '<a :href="to"><slot /></a>' },
      },
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
  userState.isAdmin = false;
  routeState.query = {};
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
    expect(wrapper.find('[data-testid="requests-patreon-cta"]').exists()).toBe(false);

    // Clicking the locked boost icon opens the Patreon unlock modal instead of doing nothing.
    const boostBtn = wrapper.get(`[data-testid="request-boost-${frieren.id}"]`);
    expect(boostBtn.attributes('disabled')).toBeUndefined();
    await boostBtn.trigger('click');
    expect(wrapper.find('[data-testid="requests-boost-unlock-modal"]').exists()).toBe(true);
    expect(wrapper.get('[data-testid="requests-boost-unlock-cta"]').attributes('href')).toBe('/en/supporters#support');

    await wrapper.get(`[data-testid="request-vote-${frieren.id}"]`).trigger('click');
    expect(openLoginModal).toHaveBeenCalledWith('content_request');
  });

  test('filters by category and status', async () => {
    route({ '/v1/requests': () => ({ items: [], total: 0 }) });
    const wrapper = await render();

    await wrapper.get('[data-testid="requests-category-JDRAMA"]').trigger('click');
    await flushPromises();
    expect($fetch).toHaveBeenLastCalledWith('/v1/requests', {
      query: {
        status: 'ACTIVE',
        sort: 'TOP',
        page: 1,
        take: 24,
        category: 'JDRAMA',
      },
    });

    await wrapper.get('[data-testid="requests-tab-IN_PROGRESS"]').trigger('click');
    await flushPromises();
    expect($fetch).toHaveBeenLastCalledWith('/v1/requests', {
      query: {
        status: 'IN_PROGRESS',
        sort: 'TOP',
        page: 1,
        take: 24,
        category: 'JDRAMA',
      },
    });
    expect(wrapper.get('[data-testid="requests-empty"]').text()).toBe('requests.empty.IN_PROGRESS');

    await wrapper.get('[data-testid="requests-tab-RELEASED"]').trigger('click');
    await flushPromises();
    expect($fetch).toHaveBeenLastCalledWith('/v1/requests', {
      query: {
        status: 'RELEASED',
        sort: 'TOP',
        page: 1,
        take: 24,
        category: 'JDRAMA',
      },
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
    await wrapper.get('[data-testid="requests-boost-confirm"]').trigger('click');
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
        return {
          request: { ...frieren, title: 'Oregairu 1' },
          outcome: 'voted',
        };
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

  test('personal tabs ask anonymous readers to sign in, and fetch own and voted requests when signed in', async () => {
    route({ '/v1/requests': () => ({ items: [], total: 0 }) });
    const anon = await render();

    await anon.get('[data-testid="requests-tab-MINE"]').trigger('click');
    expect(openLoginModal).toHaveBeenCalledWith('content_request');
    await anon.get('[data-testid="requests-tab-VOTED"]').trigger('click');
    expect(openLoginModal).toHaveBeenCalledTimes(2);

    userState.isLoggedIn = true;
    route({
      '/v1/requests': () => ({ items: [], total: 0 }),
      '/v1/requests/me': () => ({
        ...allowance,
        ownIds: [frieren.id],
        votedIds: [frieren.id],
      }),
      '/v1/requests/mine': () => ({ items: [frieren], total: 1 }),
    });
    const signedIn = await render();

    await signedIn.get('[data-testid="requests-tab-MINE"]').trigger('click');
    await flushPromises();
    expect($fetch).toHaveBeenLastCalledWith('/v1/requests/mine', {
      query: { scope: 'OWN', sort: 'TOP', page: 1, take: 24 },
    });
    expect(signedIn.get(`[data-testid="request-${frieren.id}"]`).text()).toContain('Frieren');

    await signedIn.get('[data-testid="requests-tab-VOTED"]').trigger('click');
    await flushPromises();
    expect($fetch).toHaveBeenLastCalledWith('/v1/requests/mine', {
      query: { scope: 'VOTED', sort: 'TOP', page: 1, take: 24 },
    });
  });

  test('votes optimistically, shows a dismissible boost nudge for non-patrons, and rolls back on error', async () => {
    userState.isLoggedIn = true;
    let resolveVote!: (value: unknown) => void;
    const nonPatronAllowance = {
      ...allowance,
      isPatron: false,
      ownCount: 2,
      votedCount: 4,
      boosts: {
        perMonth: 0,
        used: 0,
        remaining: 0,
        resetsAt: '2026-12-01T00:00:00Z',
      },
    };
    route({
      '/v1/requests': () => ({ items: [frieren], total: 1 }),
      '/v1/requests/me': () => ({ ...nonPatronAllowance }),
      [`POST /v1/requests/${frieren.id}/vote`]: () =>
        new Promise((resolve) => {
          resolveVote = (value) => {
            nonPatronAllowance.votedIds = [frieren.id];
            nonPatronAllowance.votedCount = 5;
            resolve(value);
          };
        }),
    });
    const wrapper = await render();

    // Exact totals from `/v1/requests/me` appear on the personal tabs.
    expect(wrapper.get('[data-testid="requests-tab-MINE"]').text()).toContain('2');
    expect(wrapper.get('[data-testid="requests-tab-VOTED"]').text()).toContain('4');

    // Clicking vote updates score & shows the non-patron boost nudge immediately before the request resolves.
    await wrapper.get(`[data-testid="request-vote-${frieren.id}"]`).trigger('click');
    expect(wrapper.get(`[data-testid="request-vote-${frieren.id}"]`).text()).toContain('9');
    expect(wrapper.find('[data-testid="requests-boost-nudge"]').exists()).toBe(true);

    resolveVote({ ...frieren, voteCount: 4, score: 9 });
    await flushPromises();

    await wrapper.get('[data-testid="requests-boost-nudge-dismiss"]').trigger('click');
    expect(wrapper.find('[data-testid="requests-boost-nudge"]').exists()).toBe(false);
  });

  test('rolls back optimistic vote when the API rejects', async () => {
    userState.isLoggedIn = true;
    route({
      '/v1/requests': () => ({ items: [frieren], total: 1 }),
      '/v1/requests/me': () => ({ ...allowance }),
      [`POST /v1/requests/${frieren.id}/vote`]: () => Promise.reject(new Error('boom')),
    });
    const wrapper = await render();

    await wrapper.get(`[data-testid="request-vote-${frieren.id}"]`).trigger('click');
    await flushPromises();
    expect(wrapper.get(`[data-testid="request-vote-${frieren.id}"]`).text()).toContain('8');
    expect(wrapper.get(`[data-testid="request-vote-${frieren.id}"]`).attributes('aria-pressed')).toBe('false');
  });

  test('confirms withdrawal in a custom modal and seeds search from ?q=', async () => {
    userState.isLoggedIn = true;
    routeState.query = { q: 'Frieren' };
    const ownOpen = { ...frieren, voteCount: 1, boostCount: 0, score: 1 };
    const deleted: string[] = [];
    route({
      '/v1/requests': () => ({
        items: deleted.length ? [] : [ownOpen],
        total: deleted.length ? 0 : 1,
      }),
      '/v1/requests/me': () => ({
        ...allowance,
        ownIds: deleted.length ? [] : [ownOpen.id],
      }),
      [`DELETE /v1/requests/${ownOpen.id}`]: () => {
        deleted.push(ownOpen.id);
      },
    });
    const wrapper = await render();
    expect($fetch).toHaveBeenCalledWith('/v1/requests', {
      query: { status: 'ACTIVE', sort: 'TOP', page: 1, take: 24, q: 'Frieren' },
    });

    await wrapper.get(`[data-testid="request-withdraw-${ownOpen.id}"]`).trigger('click');
    expect(deleted).toEqual([]);
    await wrapper.get('[data-testid="requests-withdraw-confirm"]').trigger('click');
    await flushPromises();
    expect(deleted).toEqual([ownOpen.id]);
    expect(wrapper.find('[data-testid="requests-empty-new"]').exists()).toBe(true);
  });

  test('hides Patreon CTA for patrons/admins, tags own requests, and filters personal tabs by status', async () => {
    userState.isLoggedIn = true;
    userState.isAdmin = true;
    route({
      '/v1/requests': () => ({ items: [frieren], total: 1 }),
      '/v1/requests/me': () => ({ ...allowance, ownIds: [frieren.id] }),
      '/v1/requests/mine': () => ({ items: [frieren], total: 1 }),
    });
    const wrapper = await render();

    expect(wrapper.find('[data-testid="requests-patreon-cta"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="requests-admin-link"]').exists()).toBe(true);
    expect(wrapper.find(`[data-testid="request-yours-${frieren.id}"]`).exists()).toBe(true);

    await wrapper.get('[data-testid="requests-tab-MINE"]').trigger('click');
    await flushPromises();
    await wrapper.get('[data-testid="requests-personal-status-DECLINED"]').trigger('click');
    await flushPromises();
    expect($fetch).toHaveBeenLastCalledWith('/v1/requests/mine', {
      query: {
        scope: 'OWN',
        status: 'DECLINED',
        sort: 'TOP',
        page: 1,
        take: 24,
      },
    });
  });

  test('hides new boost button on IN_PROGRESS items, avoids Patreon flash while loading, and jumps to IN_PROGRESS on submit', async () => {
    userState.isLoggedIn = true;
    const inProgressUnboosted = {
      ...frieren,
      id: '33333333-3333-4333-8333-333333333333',
      status: 'IN_PROGRESS',
      title: 'Dandadan',
    };
    const inProgressBoosted = {
      ...frieren,
      id: '44444444-4444-4444-8444-444444444444',
      status: 'IN_PROGRESS',
      title: 'Frieren',
    };
    let resolveAllowance!: (value: unknown) => void;
    route({
      '/v1/requests': () => ({ items: [inProgressUnboosted, inProgressBoosted], total: 2 }),
      '/v1/requests/me': () =>
        new Promise((resolve) => {
          resolveAllowance = resolve;
        }),
      'POST /v1/requests': () => ({
        request: inProgressUnboosted,
        outcome: 'voted',
      }),
    });

    const wrapper = await render();
    // Signed-in users do not see the Patreon CTA flash before `/v1/requests/me` resolves.
    expect(wrapper.find('[data-testid="requests-patreon-cta"]').exists()).toBe(false);

    resolveAllowance({ ...allowance, boostedIds: [inProgressBoosted.id] });
    await flushPromises();

    // Unboosted IN_PROGRESS cannot be newly boosted; already-boosted keeps its Boosted indicator.
    expect(wrapper.find(`[data-testid="request-boost-${inProgressUnboosted.id}"]`).exists()).toBe(false);
    expect(wrapper.find(`[data-testid="request-boost-${inProgressBoosted.id}"]`).exists()).toBe(true);

    // Submitting a link whose request is already IN_PROGRESS switches to the IN_PROGRESS tab.
    await wrapper.get('[data-testid="requests-new"]').trigger('click');
    await wrapper.get('#request-url').setValue('https://anilist.co/anime/171018');
    await wrapper.get('[data-testid="requests-form"]').trigger('submit');
    await flushPromises();
    expect(wrapper.get('[data-testid="requests-tab-IN_PROGRESS"]').attributes('aria-selected')).toBe('true');
  });
});
