import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('./library', () => ({ addSample: vi.fn(), decodeAudio: vi.fn(), getSampleMeta: vi.fn(), useLibrary: { getState: () => ({ samples: {} }) } }));
import { importOnlineSound, searchOnlineSounds } from './online';
import { addSample, decodeAudio } from './library';

const page = (overrides: Record<string, unknown> = {}) => ({ title: 'File:Rain.ogg', imageinfo: [{
  url: 'https://upload.wikimedia.org/wikipedia/commons/a/ab/Rain.ogg', descriptionurl: 'https://commons.wikimedia.org/wiki/File:Rain.ogg',
  mime: 'audio/ogg', size: 100, metadata: [{ name: 'length', value: 2 }],
  extmetadata: { LicenseShortName: { value: 'CC BY 4.0' }, LicenseUrl: { value: 'https://creativecommons.org/licenses/by/4.0/' }, Artist: { value: '<a>A composer</a>' } }, ...overrides,
}] });
const metadataResponse = (pages: unknown[]) => new Response(JSON.stringify({ query: { pages: Object.fromEntries(pages.map((p, i) => [i, p])) } }));
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });
describe('online audio discovery', () => {
  it('encodes searches and returns supported audio with plain-text attribution', async () => {
    const fetcher = vi.fn().mockResolvedValue(metadataResponse([page(), page({ mime: 'image/png' }), page({ metadata: [{ name: 'length', value: 600 }] }), page({ size: 32 * 1024 * 1024 }), page({ url: 'https://other.test/clip.ogg' }), page({ extmetadata: { LicenseShortName: { value: 'All rights reserved' } } })]));
    vi.stubGlobal('fetch', fetcher);
    const results = await searchOnlineSounds('rain & thunder');
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ name: 'Rain', author: 'A composer', license: 'CC BY 4.0' });
    const url = new URL(fetcher.mock.calls[0][0]);
    expect(url.searchParams.get('gsrsearch')).toBe('filetype:audio rain & thunder');
    expect(fetcher.mock.calls[0][1].credentials).toBe('omit');
  });
  it('supports Commons Ogg audio MIME without accepting video', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(metadataResponse([page({ mime: 'application/ogg', mediatype: 'AUDIO' }), page({ mime: 'application/ogg', mediatype: 'VIDEO' })])));
    const sounds = await searchOnlineSounds('rain');
    expect(sounds).toHaveLength(1); expect(sounds[0].mime).toBe('audio/ogg');
  });
  it('validates licensing again before import and retains credits', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(metadataResponse([page()])).mockResolvedValueOnce(new Response(new Uint8Array([1, 2, 3]))));
    vi.mocked(decodeAudio).mockResolvedValue({ duration: 2 } as AudioBuffer);
    vi.mocked(addSample).mockResolvedValue({ id: 'sample' } as never);
    await importOnlineSound('File:Rain.ogg');
    expect(addSample).toHaveBeenCalledWith(expect.objectContaining({ source: 'online', attribution: expect.objectContaining({ author: 'A composer', license: 'CC BY 4.0' }) }), expect.anything(), expect.objectContaining({ duration: 2 }));
  });
  it('rejects oversized streamed content even without a content-length header', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(metadataResponse([page()])).mockResolvedValueOnce(new Response(new Uint8Array(17 * 1024 * 1024))));
    await expect(importOnlineSound('File:Rain.ogg')).rejects.toThrow('16 MB');
    expect(decodeAudio).not.toHaveBeenCalled(); expect(addSample).not.toHaveBeenCalled();
  });
  it('handles failed search and cancellation without creating samples', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 503 })));
    await expect(searchOnlineSounds('rain')).rejects.toThrow('503');
    await expect(importOnlineSound('https://other.test/file.ogg')).rejects.toThrow('File title');
    expect(addSample).not.toHaveBeenCalled();
  });
});
