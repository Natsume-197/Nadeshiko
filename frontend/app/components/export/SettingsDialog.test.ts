// @vitest-environment happy-dom
import { mount } from '@vue/test-utils';
import { expect, test } from 'vitest';
import SettingsDialog from './SettingsDialog.vue';
import SettingsButton from './SettingsButton.vue';
import { useExportSettingsStore } from '~/stores/exportSettings';

const options = {
  global: {
    mocks: { $t: (key: string) => key },
    stubs: {
      CommonBaseModal: { template: '<div role="dialog"><slot /></div>' },
      UiBaseIcon: true,
    },
  },
};

test('sliders share persisted settings, leave the other media unchanged, and restore originals', async () => {
  const first = mount(SettingsDialog, options);
  const second = mount(SettingsDialog, options);
  const ranges = first.findAll<HTMLInputElement>('input[type=range]');
  expect(ranges).toHaveLength(2);
  expect(ranges.map((r) => r.element.value)).toEqual(['100', '100']);
  await ranges[0]!.setValue('55');
  expect(useExportSettingsStore().audioVolume).toBe(55);
  expect(useExportSettingsStore().imageQuality).toBe(100);
  expect(second.findAll<HTMLInputElement>('input')[0]!.element.value).toBe('55');
  await ranges[1]!.setValue('75');
  expect(useExportSettingsStore().imageQuality).toBe(75);
  const restore = first.findAll('button').find((button) => button.text() === 'exportSettings.restore');
  await restore!.trigger('click');
  expect(ranges.map((r) => r.element.value)).toEqual(['100', '100']);
  first.unmount();
  second.unmount();
});

test('a settings button opens the panel and Done closes it', async () => {
  const wrapper = mount(SettingsButton, options);
  expect(wrapper.find('[role=dialog]').exists()).toBe(false);
  await wrapper.get('button').trigger('click');
  expect(wrapper.find('[role=dialog]').exists()).toBe(true);
  await wrapper
    .findAll('button')
    .find((b) => b.text() === 'exportSettings.done')!
    .trigger('click');
  expect(wrapper.find('[role=dialog]').exists()).toBe(false);
  wrapper.unmount();
});
