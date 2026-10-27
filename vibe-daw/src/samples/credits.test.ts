import { describe, expect, it, vi } from 'vitest';
vi.mock('./library', () => ({ getSampleMeta: (id: string) => id === 'rain' ? { name: 'Rain', attribution: { author: 'Field recordist', sourceUrl: 'https://commons.wikimedia.org/wiki/File:Rain.ogg', license: 'CC BY-SA 4.0', licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/' } } : undefined }));
import { projectCredits } from './credits';
import { createAudioClip, createProject, createTrack } from '../model/project';

describe('sound credits', () => {
  it('exports attribution only once for repeated online sounds and includes sampled instruments', () => {
    const p = createProject('Rain song'); const t = createTrack(p, 'audio');
    t.clips.push(createAudioClip(p, 'rain', 0, 4), createAudioClip(p, 'rain', 4, 4));
    p.tracks.push(t, createTrack(p, 'instrument', { preset: 'piano' }));
    const text = projectCredits(p);
    expect(text).toContain('CC BY-SA 4.0'); expect(text).toContain('Alexander Holm');
    expect(text.split('Field recordist')).toHaveLength(2);
    expect(text).toContain('https://commons.wikimedia.org/wiki/File:Rain.ogg');
  });
});
