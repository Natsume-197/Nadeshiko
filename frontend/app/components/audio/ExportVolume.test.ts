// @vitest-environment happy-dom
import { mount } from '@vue/test-utils';
import { expect, test } from 'vitest';
import ExportVolume from './ExportVolume.vue';
import { useAudioExportStore } from '~/stores/audioExport';

test('both controls share an independent export preference and default to original', async () => {
  const options = { global: { mocks: { $t: (key: string) => key } } };
  const downloads = mount(ExportVolume, options);
  const anki = mount(ExportVolume, options);
  expect(downloads.get('select').element.value).toBe('100');
  expect(anki.get('select').element.value).toBe('100');
  expect(downloads.get('label').attributes('for')).toBe(downloads.get('select').attributes('id'));
  await downloads.get('select').setValue('50');
  expect(useAudioExportStore().volume).toBe(50);
  expect(anki.get('select').element.value).toBe('50');
  await anki.get('select').setValue('100');
  expect(downloads.get('select').element.value).toBe('100');
  downloads.unmount();
  anki.unmount();
});
