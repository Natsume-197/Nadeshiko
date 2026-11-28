import { beforeEach, afterEach, expect, test, vi } from 'vitest';
import { normalizeExportPercent, prepareImageExport } from './exportMedia';

const source = { kind: 'url' as const, url: 'https://cdn.test/frame.webp', filename: 'frame.webp' };
const close = vi.fn();
const drawImage = vi.fn();
const toBlob = vi.fn();
const fetchMock = vi.fn();
let canvas: { width: number; height: number; getContext: ReturnType<typeof vi.fn>; toBlob: ReturnType<typeof vi.fn> };
beforeEach(() => {
  vi.clearAllMocks();
  canvas = { width: 0, height: 0, getContext: vi.fn(() => ({ drawImage })), toBlob };
  toBlob.mockImplementation((callback: BlobCallback) => callback(new Blob(['encoded'], { type: 'image/webp' })));
  fetchMock.mockImplementation(async () => new Response('source'));
  vi.stubGlobal('fetch', fetchMock);
  vi.stubGlobal(
    'createImageBitmap',
    vi.fn(async () => ({ width: 640, height: 360, close })),
  );
  vi.stubGlobal('document', { createElement: () => canvas });
});
afterEach(() => vi.unstubAllGlobals());

test('original quality keeps the URL and does not fetch or re-encode', async () => {
  expect(await prepareImageExport(source, normalizeExportPercent(100))).toBe(source);
  expect(fetchMock).not.toHaveBeenCalled();
  expect(createImageBitmap).not.toHaveBeenCalled();
});
test('re-encodes WebP at the selected quality without changing resolution', async () => {
  const image = await prepareImageExport(source, normalizeExportPercent(75));
  expect(image.filename).toBe('frame-quality-75.webp');
  expect(image.kind).toBe('blob');
  expect(canvas.width).toBe(640);
  expect(canvas.height).toBe(360);
  expect(drawImage).toHaveBeenCalledWith(expect.objectContaining({ width: 640 }), 0, 0);
  expect(toBlob).toHaveBeenCalledWith(expect.any(Function), 'image/webp', 0.75);
  expect(close).toHaveBeenCalledOnce();
});
test('unsupported encoders and empty output fail without substituting the original', async () => {
  for (const blob of [new Blob(['png'], { type: 'image/png' }), null]) {
    toBlob.mockImplementationOnce((callback: BlobCallback) => callback(blob));
    await expect(prepareImageExport(source, normalizeExportPercent(50))).rejects.toThrow('WebP export is unavailable');
  }
  expect(close).toHaveBeenCalledTimes(2);
});
test('fetch/decode errors fail and an unavailable canvas closes the bitmap', async () => {
  fetchMock.mockResolvedValueOnce(new Response('', { status: 403 }));
  await expect(prepareImageExport(source, normalizeExportPercent(50))).rejects.toThrow('403');
  canvas.getContext.mockReturnValueOnce(null);
  await expect(prepareImageExport(source, normalizeExportPercent(50))).rejects.toThrow('conversion is unavailable');
  expect(close).toHaveBeenCalledOnce();
});
test('network errors retry past the media cache and existing blobs avoid the network', async () => {
  fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
  await prepareImageExport(source, normalizeExportPercent(50));
  expect(fetchMock).toHaveBeenLastCalledWith(source.url, { cache: 'reload' });
  fetchMock.mockClear();
  await prepareImageExport(
    { kind: 'blob', blob: new Blob(['source']), filename: 'frame.webp' },
    normalizeExportPercent(50),
  );
  expect(fetchMock).not.toHaveBeenCalled();
});
test('slider values are validated at the preference boundary', () => {
  expect(normalizeExportPercent(55)).toBe(55);
  for (const value of [0, 24, 26, 1000, NaN, '50', null]) expect(normalizeExportPercent(value)).toBe(100);
});
