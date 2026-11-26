// @vitest-environment happy-dom
import { mount, flushPromises } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

/** Admin requests Kanban board & list manager: column triage, drag transitions, media linking, and duplicate merging. */

const handleApiError = vi.fn();
vi.mock('~/utils/apiError', () => ({
  handleApiError: (...a: unknown[]) => handleApiError(...a),
}));

const $fetch = vi.fn();
const listMedia = vi.fn();
const toastSuccess = vi.fn();

vi.stubGlobal('$fetch', $fetch);
vi.stubGlobal('useLocalePath', () => (p: string) => `/en${p}`);
vi.stubGlobal('useToastSuccess', toastSuccess);
vi.stubGlobal('useNadeshikoSdk', () => ({ listMedia }));

import RequestsManager from './RequestsManager.vue';

const baseRequest = (over: Record<string, unknown> = {}) => ({
  id: '11111111-1111-4111-8111-111111111111',
  category: 'ANIME',
  kind: 'NEW',
  status: 'OPEN',
  title: 'Frieren',
  note: '',
  sourceUrl: 'https://anilist.co/anime/154587',
  coverUrl: null,
  declineReason: null,
  voteCount: 3,
  boostCount: 1,
  score: 8,
  media: null,
  createdAt: '2026-11-20T00:00:00Z',
  releasedAt: null,
  externalSource: 'ANILIST',
  externalId: '154587',
  requester: { id: 13, username: 'alice' },
  possibleDuplicateOf: null,
  ...over,
});

const mounted: { unmount: () => void }[] = [];

function route(handlers: Record<string, (options?: { method?: string; body?: unknown; query?: unknown }) => unknown>) {
  $fetch.mockImplementation(async (url: string, options?: { method?: string }) => {
    const key = `${options?.method ?? 'GET'} ${url}`;
    const handler = handlers[key] ?? handlers[url];
    if (!handler) throw new Error(`unexpected ${key}`);
    return handler(options);
  });
}

async function render() {
  const wrapper = mount(RequestsManager, {
    attachTo: document.body,
    global: {
      stubs: {
        UiBaseIcon: true,
        NuxtLink: { props: ['to'], template: '<a :href="to"><slot /></a>' },
        CommonBaseModal: {
          props: ['open'],
          template: '<div v-if="open"><slot /></div>',
        },
      },
    },
  });
  mounted.push(wrapper);
  await flushPromises();
  return wrapper;
}

beforeEach(() => {
  vi.useFakeTimers();
  $fetch.mockReset();
  listMedia.mockReset();
  handleApiError.mockReset();
  toastSuccess.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
  while (mounted.length) mounted.pop()?.unmount();
});

describe('RequestsManager', () => {
  test('renders all 5 Trello Kanban columns and filters by category', async () => {
    const open = baseRequest();
    const declined = baseRequest({
      id: '22222222-2222-4222-8222-222222222222',
      status: 'DECLINED',
      title: 'Hanzawa Naoki',
      declineReason: 'No Japanese subtitles exist.',
    });
    route({
      '/v1/admin/requests': () => ({ items: [open, declined], total: 2 }),
    });

    const wrapper = await render();
    expect(wrapper.find('[data-testid="admin-column-OPEN"]').text()).toContain('Frieren');
    expect(wrapper.find('[data-testid="admin-column-PLANNED"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="admin-column-IN_PROGRESS"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="admin-column-RELEASED"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="admin-column-DECLINED"]').text()).toContain('Hanzawa Naoki');

    await wrapper.get('[data-testid="admin-category-ANIME"]').trigger('click');
    await flushPromises();
    expect($fetch).toHaveBeenLastCalledWith('/v1/admin/requests', {
      query: { page: 1, take: 100, category: 'ANIME' },
    });
  });

  test('links Nadeshiko media via live search in the detail modal and saves changes', async () => {
    const open = baseRequest();
    const patches: unknown[] = [];
    listMedia.mockResolvedValue({
      media: [
        {
          publicId: 'med_frieren',
          nameEn: 'Frieren: Beyond Journey’s End',
          category: 'ANIME',
        },
      ],
    });
    route({
      '/v1/admin/requests': () => ({ items: [open], total: 1 }),
      [`PATCH /v1/admin/requests/${open.id}`]: (opts) => {
        patches.push(opts?.body);
        return {
          ...open,
          media: {
            id: 'med_frieren',
            slug: 'frieren',
            name: 'Frieren: Beyond Journey’s End',
          },
        };
      },
    });

    const wrapper = await render();
    await wrapper.get(`[data-testid="admin-request-${open.id}"]`).trigger('click');

    await wrapper.get('[data-testid="admin-media-search"]').setValue('Frieren');
    vi.advanceTimersByTime(300);
    await flushPromises();

    expect(listMedia).toHaveBeenCalledWith({ query: 'Frieren', take: 6 });
    await wrapper.get('[data-testid="admin-media-option-med_frieren"]').trigger('click');

    const saveBtn = wrapper.findAll('button').find((b) => b.text() === 'Save changes');
    expect(saveBtn).toBeDefined();
    await saveBtn!.trigger('click');
    await flushPromises();

    expect(patches).toEqual([
      {
        status: 'OPEN',
        title: 'Frieren',
        declineReason: null,
        mediaId: 'med_frieren',
      },
    ]);
    expect(toastSuccess).toHaveBeenCalledWith('Request saved.');
  });

  test('drag to PLANNED saves immediately, while drag to DECLINED requires a reason in the modal', async () => {
    const open = baseRequest();
    const patches: unknown[] = [];
    route({
      '/v1/admin/requests': () => ({ items: [open], total: 1 }),
      [`PATCH /v1/admin/requests/${open.id}`]: (opts) => {
        patches.push(opts?.body);
        const body = opts?.body as { status?: string; declineReason?: string };
        return {
          ...open,
          status: body.status ?? open.status,
          declineReason: body.declineReason ?? null,
        };
      },
    });

    const wrapper = await render();
    await wrapper.get(`[data-testid="admin-request-${open.id}"]`).trigger('dragstart');
    await wrapper.get('[data-testid="admin-column-PLANNED"]').trigger('drop');
    await flushPromises();

    expect(patches).toEqual([{ status: 'PLANNED' }]);
    expect(wrapper.find('[data-testid="admin-column-PLANNED"]').text()).toContain('Frieren');

    // Drag to Declined column opens the reason modal before patching.
    await wrapper.get(`[data-testid="admin-request-${open.id}"]`).trigger('dragstart');
    await wrapper.get('[data-testid="admin-column-DECLINED"]').trigger('drop');
    expect(patches).toHaveLength(1);
    expect(wrapper.get('[data-testid="admin-move-confirm"]').attributes('disabled')).toBeDefined();

    await wrapper.get('input[aria-label="Decline reason"]').setValue('No Japanese subtitles exist.');
    await wrapper.get('[data-testid="admin-move-confirm"]').trigger('click');
    await flushPromises();

    expect(patches).toHaveLength(2);
    expect(patches[1]).toEqual({
      status: 'DECLINED',
      declineReason: 'No Japanese subtitles exist.',
      mediaId: null,
    });
  });

  test('moving to a status that emails voters asks whether to send the email', async () => {
    const open = baseRequest();
    const patches: unknown[] = [];
    route({
      '/v1/admin/requests': () => ({ items: [open], total: 1 }),
      [`PATCH /v1/admin/requests/${open.id}`]: (opts) => {
        patches.push(opts?.body);
        return { ...open, status: (opts?.body as { status: string } | undefined)?.status ?? open.status };
      },
    });

    const wrapper = await render();
    await wrapper.get(`[data-testid="admin-request-${open.id}"]`).trigger('dragstart');
    await wrapper.get('[data-testid="admin-column-IN_PROGRESS"]').trigger('drop');
    expect(patches).toHaveLength(0);
    expect(wrapper.get('[data-testid="admin-move-confirm"]').text()).toBe('Move and email');

    await wrapper.get('[data-testid="admin-move-quiet"]').trigger('click');
    await flushPromises();
    expect(patches).toEqual([{ status: 'IN_PROGRESS', declineReason: null, mediaId: null, notify: false }]);
    expect(toastSuccess).toHaveBeenCalledWith('Moved to In progress, no email sent.');

    await wrapper.get(`[data-testid="admin-request-${open.id}"]`).trigger('dragstart');
    await wrapper.get('[data-testid="admin-column-RELEASED"]').trigger('drop');
    await wrapper.get('[data-testid="admin-move-confirm"]').trigger('click');
    await flushPromises();
    expect(patches[1]).toEqual({ status: 'RELEASED', declineReason: null, mediaId: null, notify: true });
  });

  test('merges a flagged duplicate via the confirmation modal', async () => {
    const keep = baseRequest({
      id: '99999999-9999-4999-8999-999999999999',
      title: 'Frieren Keep',
    });
    const dup = baseRequest({
      title: 'Frieren Dup',
      possibleDuplicateOf: { id: keep.id, title: keep.title, status: 'OPEN' },
    });
    const merges: unknown[] = [];
    route({
      '/v1/admin/requests': () => ({
        items: merges.length ? [keep] : [keep, dup],
        total: merges.length ? 1 : 2,
      }),
      [`POST /v1/admin/requests/${dup.id}/merge`]: (opts) => {
        merges.push(opts?.body);
        return keep;
      },
    });

    const wrapper = await render();
    await wrapper.get(`[data-testid="admin-request-${dup.id}"]`).trigger('click');
    const mergeIntoBtn = wrapper.findAll('button').find((b) => b.text() === 'Merge into it');
    await mergeIntoBtn!.trigger('click');
    expect(merges).toEqual([]);

    const confirmBtn = wrapper.findAll('button').find((b) => b.text() === 'Merge requests');
    await confirmBtn!.trigger('click');
    await flushPromises();

    expect(merges).toEqual([{ intoId: keep.id }]);
    expect(toastSuccess).toHaveBeenCalledWith('Requests merged.');
  });
});
