import { z } from 'zod';
import type { SearchResult } from '~/types/search';
import { fetchAudioSegment } from '~/utils/media';
import { encodeWav } from '~/utils/wav';

const volumeSchema = z.union([z.literal(25), z.literal(50), z.literal(75), z.literal(100)]).catch(100);
export type AudioExportVolume = z.infer<typeof volumeSchema>;
export const audioExportVolumes = [100, 75, 50, 25] as const;
export const normalizeAudioExportVolume = (value: unknown): AudioExportVolume => volumeSchema.parse(value);

export type AudioExportSource =
  | { kind: 'url'; url: string; filename: string }
  | { kind: 'blob'; blob: Blob; filename: string };

export function sentenceAudioExportSource(sentence: SearchResult): AudioExportSource {
  const id = sentence.segment.publicId;
  if (sentence.blobAudioUrl && sentence.blobAudio) {
    const window = sentence.expandedWindow ?? {
      startMs: sentence.segment.startTimeMs,
      endMs: sentence.segment.endTimeMs,
    };
    return {
      kind: 'blob',
      blob: sentence.blobAudio,
      filename: `${id}-expanded-${window.startMs}-${window.endMs}.wav`,
    };
  }
  return { kind: 'url', url: sentence.segment.urls.audioUrl, filename: `${id}.mp3` };
}

export async function prepareAudioExport(
  source: AudioExportSource,
  volume: AudioExportVolume,
): Promise<AudioExportSource> {
  if (volume === 100) return source;

  const bytes =
    source.kind === 'blob'
      ? await source.blob.arrayBuffer()
      : await (await fetchAudioSegment(source.url)).response.arrayBuffer();
  const context = new AudioContext();
  try {
    const decoded = await context.decodeAudioData(bytes);
    return {
      kind: 'blob',
      blob: encodeWav(decoded, volume / 100),
      filename: `${source.filename.replace(/\.[^.]+$/, '')}-volume-${volume}.wav`,
    };
  } finally {
    await context.close();
  }
}
