import { addSample, decodeAudio, getSampleMeta, useLibrary } from './library';
import type { SampleMeta } from '../model/types';

export interface OnlineSound {
  title: string;
  name: string;
  url: string;
  sourceUrl: string;
  license: string;
  licenseUrl: string;
  author: string;
  bytes: number;
  mime: string;
  seconds: number;
}
const API = 'https://commons.wikimedia.org/w/api.php';
const MAX_BYTES = 16 * 1024 * 1024;
const plain = (s = '') => s.replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').trim().slice(0, 500);
const https = (s: string) => { try { return new URL(s).protocol === 'https:'; } catch { return false; } };

async function commons(params: Record<string, string>, signal?: AbortSignal): Promise<OnlineSound[]> {
  const response = await fetch(`${API}?${new URLSearchParams({ action: 'query', format: 'json', origin: '*', prop: 'imageinfo', iiprop: 'url|size|mime|mediatype|metadata|extmetadata', ...params })}`, { signal, credentials: 'omit' });
  if (!response.ok) throw new Error(`Sound search failed (${response.status})`);
  const data = await response.json();
  if (data.error) throw new Error(data.error.info ?? 'Sound search failed');
  const results: OnlineSound[] = [];
  for (const page of Object.values(data.query?.pages ?? {}) as Array<{ title: string; imageinfo?: Array<{ url: string; descriptionurl: string; size: number; mime: string; mediatype?: string; metadata?: Array<{ name: string; value: unknown }>; extmetadata?: Record<string, { value: string }> }> }>) {
    const info = page.imageinfo?.[0];
    if (!info || !(info.mime?.startsWith('audio/') || (info.mime === 'application/ogg' && info.mediatype === 'AUDIO')) || !Number.isFinite(info.size) || info.size <= 0 || info.size > MAX_BYTES) continue;
    const seconds = Number(info.metadata?.find((field) => field.name === 'length')?.value);
    if (!Number.isFinite(seconds) || seconds <= 0 || seconds > 180) continue;
    const meta = info.extmetadata ?? {};
    const license = plain(meta.LicenseShortName?.value);
    if (!/^(CC0|Public domain|CC BY(?:-SA)? [\d.]+)$/i.test(license)) continue;
    const url = new URL(info.url);
    if (url.protocol !== 'https:' || url.hostname !== 'upload.wikimedia.org') continue;
    if (!https(info.descriptionurl)) continue;
    const rawLicenseUrl = meta.LicenseUrl?.value ?? '';
    const licenseUrl = rawLicenseUrl.startsWith('//') ? `https:${rawLicenseUrl}` : rawLicenseUrl;
    results.push({ title: page.title, name: plain(page.title.replace(/^File:/, '').replace(/\.[^.]+$/, '')), url: info.url, sourceUrl: info.descriptionurl, license, licenseUrl: https(licenseUrl) ? licenseUrl : info.descriptionurl, author: plain(meta.Artist?.value) || 'See source page', bytes: info.size, seconds, mime: info.mime === 'application/ogg' ? 'audio/ogg' : info.mime });
  }
  return results;
}

/** Anonymous, CORS-enabled search. Licensing and authorship travel with each import. */
export async function searchOnlineSounds(query: string, signal?: AbortSignal): Promise<OnlineSound[]> {
  const q = query.trim().slice(0, 200);
  if (!q) throw new Error('Enter a sound to search for');
  signal = signal ? AbortSignal.any([signal, AbortSignal.timeout(30_000)]) : AbortSignal.timeout(30_000);
  return commons({ generator: 'search', gsrsearch: `filetype:audio ${q}`, gsrnamespace: '6', gsrlimit: '20' }, signal);
}

export async function importOnlineSound(title: string, signal?: AbortSignal): Promise<SampleMeta> {
  if (!title.startsWith('File:') || title.length > 300) throw new Error('Use a File title returned by search_online_sounds');
  signal = signal ? AbortSignal.any([signal, AbortSignal.timeout(30_000)]) : AbortSignal.timeout(30_000);
  const sound = (await commons({ titles: title }, signal))[0];
  if (!sound) throw new Error('This sound is unavailable, too large, or has an unsupported license');
  const existing = Object.values(useLibrary.getState().samples).find((m) => m.attribution?.sourceUrl === sound.sourceUrl);
  if (existing) return getSampleMeta(existing.id)!;
  const response = await fetch(sound.url, { signal, credentials: 'omit' });
  if (!response.ok) throw new Error(`Sound download failed (${response.status})`);
  if (Number(response.headers.get('content-length')) > MAX_BYTES) throw new Error('Sound exceeds the 16 MB import limit');
  const reader = response.body?.getReader();
  if (!reader) throw new Error('Sound download is unavailable');
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BYTES) throw new Error('Sound exceeds the 16 MB import limit');
      chunks.push(value);
    }
  } catch (e) { await reader.cancel(); throw e; }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  const decoded = await decodeAudio(bytes.buffer);
  if (decoded.duration > 180) throw new Error('Choose a clip under three minutes');
  signal?.throwIfAborted();
  return addSample({ name: sound.name, category: 'texture', source: 'online', tags: ['commons', sound.license], skipAnalysis: true,
    attribution: { sourceUrl: sound.sourceUrl, license: sound.license, licenseUrl: sound.licenseUrl, author: sound.author },
  }, { data: bytes.buffer, mime: sound.mime }, decoded);
}
