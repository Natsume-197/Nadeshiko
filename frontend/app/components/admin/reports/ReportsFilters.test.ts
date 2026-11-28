// @vitest-environment happy-dom
import { mount } from '@vue/test-utils';
import { describe, test, expect, vi } from 'vitest';

/** The status control offers "all" or one status; the parent keeps a set and is told which statuses to flip. */
vi.stubGlobal('useI18n', () => ({ t: (key: string) => key }));

import ReportsFilters from './ReportsFilters.vue';

const ALL = ['OPEN', 'PROCESSING', 'FIXED', 'DISMISSED'];

function render(active: string[]) {
  return mount(ReportsFilters, {
    props: { source: '', orphaned: false, activeStatuses: new Set(active) },
    global: { stubs: { UiBaseIcon: true } },
  });
}

const statusButton = (wrapper: ReturnType<typeof render>, label: string) =>
  wrapper.findAll('button').find((b) => b.text().trim() === label);

describe('the status filter', () => {
  test('picking one status from "all" flips every other one off', async () => {
    const wrapper = render(ALL);

    await statusButton(wrapper, 'reports.statuses.OPEN')?.trigger('click');

    expect(wrapper.emitted('toggle-status')?.map(([s]) => s)).toEqual(['PROCESSING', 'FIXED', 'DISMISSED']);
  });

  test('switching from one status to another flips just those two', async () => {
    const wrapper = render(['OPEN']);

    await statusButton(wrapper, 'reports.statuses.FIXED')?.trigger('click');

    expect(wrapper.emitted('toggle-status')?.map(([s]) => s)).toEqual(['OPEN', 'FIXED']);
  });

  test('"all" turns every missing status back on', async () => {
    const wrapper = render(['FIXED']);

    await statusButton(wrapper, 'reports.admin.filters.all')?.trigger('click');

    expect(wrapper.emitted('toggle-status')?.map(([s]) => s)).toEqual(['OPEN', 'PROCESSING', 'DISMISSED']);
  });

  test('the orphaned chip toggles', async () => {
    const wrapper = render(ALL);

    await wrapper.get('[data-testid="orphaned-filter"]').trigger('click');

    expect(wrapper.emitted('update:orphaned')?.[0]).toEqual([true]);
  });
});
