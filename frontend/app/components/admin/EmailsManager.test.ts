// @vitest-environment happy-dom
import { flushPromises, mount } from '@vue/test-utils';
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { ref } from 'vue';
import type { AdminEmailSend } from '@brigadasos/nadeshiko-sdk';

const sdk = {
  listAdminEmails: vi.fn(),
  listAdminEmailSuppressions: vi.fn(),
  getAdminEmail: vi.fn(),
  liftAdminEmailSuppression: vi.fn(),
  resendAdminEmail: vi.fn(),
};
const routeQuery: Record<string, string> = {};
const handleApiError = vi.fn();

vi.stubGlobal('useI18n', () => ({
  t: (k: string, params?: Record<string, unknown>) => (params ? `${k}:${JSON.stringify(params)}` : k),
  locale: ref('en'),
}));
vi.stubGlobal('useFormat', () => ({
  formatNumber: (n: number) => n.toLocaleString('en-US'),
  formatDate: (v: string) => v,
}));
vi.stubGlobal('useLocalePath', () => (p: unknown) => p);
vi.stubGlobal('useRoute', () => ({ query: routeQuery }));
vi.stubGlobal('useNadeshikoSdk', () => sdk);
vi.mock('~/utils/apiError', () => ({ handleApiError: (...args: unknown[]) => handleApiError(...args) }));

import EmailsManager from './EmailsManager.vue';

/** The generated type drops `nullable`, so build the real wire shape and cast it. */
function email(overrides: Partial<AdminEmailSend> = {}): AdminEmailSend {
  return {
    id: 1,
    sentAt: '2026-11-25T05:00:00.000Z',
    address: 'reader@example.com',
    userId: 42,
    username: 'reader',
    kind: 'magic-link',
    campaign: null,
    subject: 'Nadeshiko: Your sign-in link',
    status: 'delivered',
    error: null,
    sesMessageId: 'ses-1',
    source: 'live',
    resendable: true,
    ...overrides,
  } as unknown as AdminEmailSend;
}

const mounted: { unmount: () => void }[] = [];

async function render() {
  const wrapper = mount(EmailsManager, {
    global: {
      stubs: {
        UiBaseIcon: true,
        NuxtLink: { template: '<a><slot /></a>' },
        CommonBaseModal: {
          props: ['open'],
          template: '<div v-if="open" data-testid="email-detail"><slot /></div>',
        },
      },
    },
  });
  mounted.push(wrapper);
  await flushPromises();
  return wrapper;
}

beforeEach(() => {
  vi.clearAllMocks();
  sdk.listAdminEmails.mockResolvedValue({
    emails: [email(), email({ id: 2, address: 'gone@example.com', status: 'bounced', sesMessageId: 'ses-2' })],
    total: 2,
    last24h: { sent: 30, failed: 1, bounced: 2, suppressed: 0 },
  });
  sdk.listAdminEmailSuppressions.mockResolvedValue({
    suppressions: [
      {
        address: 'gone@example.com',
        cause: 'hard_bounce',
        reason: '550',
        suppressedAt: '2026-11-20T00:00:00Z',
        permanent: false,
      },
      {
        address: 'angry@example.com',
        cause: 'complaint',
        reason: null,
        suppressedAt: '2026-11-21T00:00:00Z',
        permanent: true,
      },
    ],
    total: 2,
  });
  sdk.getAdminEmail.mockResolvedValue({
    email: email({ id: 2, status: 'bounced' }),
    events: [
      {
        id: 9,
        event: 'hard_bounce',
        occurredAt: '2026-11-25T05:00:01Z',
        reason: null,
        diagnosticMessage: '550 5.1.1 User unknown',
      },
    ],
  });
  sdk.liftAdminEmailSuppression.mockResolvedValue(undefined);
  sdk.resendAdminEmail.mockResolvedValue(undefined);
  for (const key of Object.keys(routeQuery)) delete routeQuery[key];
});

afterEach(() => {
  for (const w of mounted.splice(0)) w.unmount();
});

describe('EmailsManager', () => {
  test('loads the last 30 days of sends with the 24 h counts and statuses', async () => {
    const wrapper = await render();

    expect(sdk.listAdminEmails).toHaveBeenCalledWith({ limit: 25, offset: 0, days: 30 });
    expect(wrapper.get('[data-testid="emails-kpi-sent"]').text()).toBe('30');
    expect(wrapper.get('[data-testid="emails-kpi-failed"]').text()).toBe('1');
    expect(wrapper.findAll('[data-testid="emails-row"]')).toHaveLength(2);
    expect(wrapper.get('[data-testid="emails-status-2"]').text()).toBe('adminEmails.status.bounced');
  });

  test('refetches from the first page when a filter changes', async () => {
    const wrapper = await render();

    await wrapper.get('[data-testid="emails-status"]').setValue('failed');
    await flushPromises();

    expect(sdk.listAdminEmails).toHaveBeenLastCalledWith({ limit: 25, offset: 0, days: 30, status: 'failed' });
  });

  test('opens a send with its SES events', async () => {
    const wrapper = await render();

    await wrapper.findAll('[data-testid="emails-row"]').at(1)?.trigger('click');
    await flushPromises();

    expect(sdk.getAdminEmail).toHaveBeenCalledWith(2);
    expect(wrapper.get('[data-testid="email-detail-events"]').text()).toContain('550 5.1.1 User unknown');
  });

  test('lists suppressions and lifts only the ones that are not permanent', async () => {
    const wrapper = await render();

    await wrapper.get('[data-testid="emails-tab-suppressed"]').trigger('click');
    await flushPromises();

    expect(wrapper.findAll('[data-testid="suppressions-row"]')).toHaveLength(2);
    expect(wrapper.find('[data-testid="suppressions-lift-angry@example.com"]').exists()).toBe(false);

    await wrapper.get('[data-testid="suppressions-lift-gone@example.com"]').trigger('click');
    await flushPromises();

    expect(sdk.liftAdminEmailSuppression).toHaveBeenCalledWith({ address: 'gone@example.com' });
    expect(sdk.listAdminEmailSuppressions).toHaveBeenCalledTimes(2);
  });

  test('reports a failed load', async () => {
    sdk.listAdminEmails.mockRejectedValueOnce(new Error('boom'));
    await render();

    expect(handleApiError).toHaveBeenCalledWith('admin:emails-fetch-failed', expect.any(Error));
  });

  test('resends a sign-in link and reloads the first page', async () => {
    const wrapper = await render();

    await wrapper.findAll('[data-testid="emails-row"]').at(0)?.trigger('click');
    await flushPromises();
    await wrapper.get('[data-testid="email-resend"]').trigger('click');
    await flushPromises();

    expect(sdk.resendAdminEmail).toHaveBeenCalledWith(2);
    expect(sdk.listAdminEmails).toHaveBeenCalledTimes(2);
    expect(wrapper.find('[data-testid="email-detail"]').exists()).toBe(false);
  });

  test('offers no resend when the backend says it cannot send it again', async () => {
    sdk.listAdminEmails.mockResolvedValue({
      emails: [email({ kind: 'word-digest', resendable: false })],
      total: 1,
      last24h: { sent: 1, failed: 0, bounced: 0, suppressed: 0 },
    });
    sdk.getAdminEmail.mockResolvedValue({ email: email({ kind: 'word-digest', resendable: false }), events: [] });
    const wrapper = await render();

    await wrapper.get('[data-testid="emails-row"]').trigger('click');
    await flushPromises();

    expect(wrapper.find('[data-testid="email-resend"]').exists()).toBe(false);
  });

  test('opens on the search and range passed in the link', async () => {
    routeQuery.q = 'reader@example.com';
    routeQuery.days = '365';
    await render();

    expect(sdk.listAdminEmails).toHaveBeenCalledWith({ limit: 25, offset: 0, days: 365, search: 'reader@example.com' });
  });
});
