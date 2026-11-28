import type { SearchResult } from '~/types/search';
import { fetchAudioSegment } from '~/utils/media';
import { encodeWav } from '~/utils/wav';

import type { ExportPercent, MediaExportSource } from '~/utils/exportMedia';

export function sentenceAudioExportSource(sentence: SearchResult): MediaExportSource {
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

export async function prepareAudioExport(source: MediaExportSource, volume: ExportPercent): Promise<MediaExportSource> {
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
