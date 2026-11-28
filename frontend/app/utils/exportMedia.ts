import { z } from 'zod';

const percentSchema = z.number().int().min(25).max(100).multipleOf(5).catch(100).brand<'ExportPercent'>();
export type ExportPercent = z.infer<typeof percentSchema>;
export const normalizeExportPercent = (value: unknown): ExportPercent => percentSchema.parse(value);

export type MediaExportSource =
  | { kind: 'url'; url: string; filename: string }
  | { kind: 'blob'; blob: Blob; filename: string };

export async function prepareImageExport(
  source: MediaExportSource,
  quality: ExportPercent,
): Promise<MediaExportSource> {
  if (quality === 100) return source;
  let blob: Blob;
  if (source.kind === 'blob') {
    blob = source.blob;
  } else {
    const response = await fetch(source.url).catch(() => fetch(source.url, { cache: 'reload' }));
    if (!response.ok) throw new Error(`Image download failed with status ${response.status}`);
    blob = await response.blob();
  }
  const bitmap = await createImageBitmap(blob);
  try {
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Image conversion is unavailable');
    context.drawImage(bitmap, 0, 0);
    const converted = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (result) => {
          if (result?.type === 'image/webp') resolve(result);
          else reject(new Error('WebP export is unavailable in this browser'));
        },
        'image/webp',
        quality / 100,
      );
    });
    return {
      kind: 'blob',
      blob: converted,
      filename: `${source.filename.replace(/\.[^.]+$/, '')}-quality-${quality}.webp`,
    };
  } finally {
    bitmap.close();
  }
}
