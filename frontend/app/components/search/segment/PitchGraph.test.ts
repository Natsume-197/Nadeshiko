// @vitest-environment happy-dom
import { mount } from '@vue/test-utils';
import { describe, expect, test } from 'vitest';
import PitchGraph from './PitchGraph.vue';
import { pitchMorae } from '~/utils/wordCard';

const graph = (reading: string, downstep: number) =>
  mount(PitchGraph, { props: { morae: pitchMorae(reading, downstep), downstep } });

describe('the pitch graph', () => {
  test('a dot per mora with its kana over it, then a hollow dot for the particle', () => {
    const wrapper = graph('みんな', 0);

    expect(wrapper.findAll('.pitch-graph__kana').map((text) => text.text())).toEqual(['み', 'ん', 'な']);
    expect(wrapper.findAll('.pitch-graph__dot')).toHaveLength(3);
    expect(wrapper.findAll('.pitch-graph__particle')).toHaveLength(1);
    expect(wrapper.attributes('aria-label')).toBe('みんな [0]');
  });

  test('high and low follow the accent; the particle stays high only after a flat word', () => {
    const heights = (reading: string, downstep: number) =>
      graph(reading, downstep)
        .findAll('circle')
        .map((dot) => (dot.attributes('cy') === '26' ? 'H' : 'L'))
        .join('');

    expect(heights('みんな', 0)).toBe('LHHH');
    expect(heights('みんな', 3)).toBe('LHHL');
    expect(heights('たべる', 2)).toBe('LHLL');
    expect(heights('いのち', 1)).toBe('HLLL');
  });

  test('coloured by accent type', () => {
    expect(graph('みんな', 0).classes()).toContain('is-heiban');
    expect(graph('いのち', 1).classes()).toContain('is-atamadaka');
    expect(graph('たべる', 2).classes()).toContain('is-nakadaka');
    expect(graph('みんな', 3).classes()).toContain('is-odaka');
  });

  test('a mora of two kana gets a wider column', () => {
    const xs = graph('しゃしん', 0)
      .findAll('.pitch-graph__dot')
      .map((dot) => Number(dot.attributes('cx')));

    expect((xs[1] ?? 0) - (xs[0] ?? 0)).toBeGreaterThan((xs[2] ?? 0) - (xs[1] ?? 0));
  });
});
