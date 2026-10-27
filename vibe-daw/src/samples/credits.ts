import type { Project } from '../model/types';
import { getSampleMeta } from './library';
import { PRESET_BY_ID } from '../model/catalog';

/** Credits for the sounds actually referenced by this session; portable as plain text. */
export function projectCredits(project: Project): string {
  const ids = new Set<string>();
  const instruments = new Set<string>();
  for (const t of project.tracks) {
    for (const lane of t.drumLanes ?? []) ids.add(lane.sampleId);
    for (const c of t.clips) if (c.type === 'audio') ids.add(c.sampleId);
    if (t.instrument && PRESET_BY_ID[t.instrument.preset]?.sampled) instruments.add(t.instrument.preset);
  }
  const entries: string[] = [];
  for (const id of ids) {
    const sample = getSampleMeta(id), credit = sample?.attribution;
    if (credit) entries.push(`${sample!.name}\nAuthor: ${credit.author}\nSource: ${credit.sourceUrl}\nLicense: ${credit.license}\nLicense URL: ${credit.licenseUrl}`);
  }
  if (instruments.has('piano')) entries.push('Salamander Grand Piano by Alexander Holm\nLicense: CC BY 3.0\nhttps://archive.org/details/SalamanderGrandPianoV3\nhttps://creativecommons.org/licenses/by/3.0/');
  const other = [...instruments].filter((id) => id !== 'piano');
  if (other.length) entries.push(`${other.map((id) => PRESET_BY_ID[id].name).join(', ')}\nSample library: tonejs-instruments by Nicholaus Brosowsky\nLicense: CC BY 3.0\nhttps://github.com/nbrosowsky/tonejs-instruments\nhttps://creativecommons.org/licenses/by/3.0/`);
  return `${project.name}: sound credits\nMade with Vibe · https://vibedaw.org\n\n${entries.join('\n\n') || 'No attributed library sounds are referenced by this session.'}\n\nEdits and processing may have been applied in this session. Check source pages for exact authorship and license terms. Add credits for any user-uploaded recordings separately.\n`;
}
