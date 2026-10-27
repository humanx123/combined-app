import type { Project } from '../model/types';
import { barToBeat, beatToBar, beatsPerBar, beatsToSeconds, projectLength, secondsToBeats } from '../model/project';
import { formatKey } from '../model/theory';
import { renderProject, renderSamplePreview } from '../engine/api';
import { getProject } from '../state/store';
import { arrayBufferToBase64, audioBufferToPcm } from '../engine/wav';
import { describeStats, mixStats, estimatePitch, estimateTempo, estimateKey } from '../samples/analysis';
import { decodeAudio, getSampleMeta, loadBuffer, updateSampleMeta } from '../samples/library';
import { generateText } from './llm';
import { useSettings } from '../state/settings';
import { prepareListeningAudio } from './listeningAudio';

// The agent's ears. Gemini hears the actual rendered audio (not the MIDI), and we
// pair what it hears with objective measurements so feedback is grounded.

const MAX_LISTEN_SECONDS = 60;

const concise = (text: string, chars: number) => text.length <= chars ? text : text.slice(0, chars) + '…';
const listenCache = new WeakMap<Project, Map<string, ListenResult>>();

const EARS_SYSTEM = `You are the ears of an AI music producer working inside a DAW. You will hear a rendered audio excerpt.
Listen closely and report what is actually audible - never guess from the description alone.
Be concrete and critical like a top mix engineer and A&R: name the instruments you hear, the vibe, groove, tuning/key clashes,
timing problems, low-end conflicts (kick vs 808), muddiness, harshness, masking, stereo image, levels, energy and arrangement.
Use bar numbers when pointing at moments (the user tells you which bar the excerpt starts on and the bar length in seconds).
Separate audible observations from interpretations and uncertain guesses. The declared project key and instrument labels are context, not proof of what sounds. Do not invent exact pitches, frequencies, clipping, or whole-song structure from an excerpt. A low peak is not by itself a problem; preserve intentional dynamics, sparse arrangements, distortion and genre character.
Keep it under 110 words: Works (one specific strength); Issues (at most 2 supported problems with bar/time and evidence); Next (one highest-impact fix). Answer the focused question. If no meaningful issue is audible, say so. Judge against the brief, not a generic loud/bright/wide target.`;

export interface ListenRequest {
  project: Project;
  startBar?: number;
  endBar?: number;
  trackIds?: string[] | null;
  question?: string;
  goal?: string;
  signal?: AbortSignal;
}

export interface ListenResult {
  heard: string;
  stats: string;
  seconds: number;
  startBar: number;
  endBar: number;
}

export async function listen(req: ListenRequest): Promise<ListenResult> {
  req.signal?.throwIfAborted();
  const p = req.project;
  const bpb = beatsPerBar(p);
  const lastBar = Math.ceil(projectLength(p) / bpb) + 1;
  const startBar = Math.max(1, Math.min(lastBar - 1, Math.floor(req.startBar ?? 1)));
  let endBar = Math.min(lastBar, Math.ceil(req.endBar ?? startBar + 4));
  const barSec = beatsToSeconds(p, bpb);
  if ((endBar - startBar) * barSec > MAX_LISTEN_SECONDS) endBar = startBar + Math.floor(MAX_LISTEN_SECONDS / barSec);
  if (endBar <= startBar) endBar = startBar + 1;
  const endBeat = Math.min(barToBeat(p, endBar), barToBeat(p, startBar) + secondsToBeats(p, req.endBar === undefined ? 12 : MAX_LISTEN_SECONDS));
  endBar = beatToBar(p, endBeat);
  const { listeningQuality, listeningChannels } = useSettings.getState();
  const cacheKey = JSON.stringify([startBar, endBar, req.trackIds, req.question, req.goal, listeningQuality, listeningChannels]);
  const cached = listenCache.get(p)?.get(cacheKey);
  if (cached) return cached;

  const pcm = await renderProject(p, {
    startBeat: barToBeat(p, startBar),
    endBeat,
    onlyTracks: req.trackIds?.length ? req.trackIds : null,
    tail: 0,
  });
  req.signal?.throwIfAborted();
  const audio = prepareListeningAudio(pcm, listeningQuality, listeningChannels);
  const stats = mixStats(audio.pcm);
  if (stats.peakDb <= -90) return {
    heard: 'The rendered excerpt is silent or effectively silent (measured peak at or below -90 dBFS). Check the chosen bars, mute/solo, clips, instrument and sample loading. No model listening call was made.',
    stats: describeStats(stats), seconds: stats.durationSec, startBar, endBar,
  };
  const trackNames = req.trackIds?.length
    ? p.tracks.filter((t) => req.trackIds!.includes(t.id)).map((t) => t.name).join(', ')
    : 'full mix';

  const prompt = [
    `Excerpt: bars [${startBar}, ${endBar}) (${trackNames}); end is exclusive. ${p.bpm} BPM, ${formatKey(p.key)}, ${p.timeSignature.join('/')}. One bar = ${barSec.toFixed(2)} s; 0:00 in the audio is the start of bar ${startBar}.`,
    req.goal ? `What the producer is going for: ${req.goal}` : '',
    `Measured: ${describeStats(stats)}.`,
    `Audio provided: ${audio.label}. ${listeningChannels === 'mono' ? 'This is a mono downmix; do not judge stereo width or panning.' : ''}`,
    req.question ? `Question: ${req.question}` : 'Give your honest critique.',
  ].filter(Boolean).join('\n');

  const heard = await generateText({
    system: EARS_SYSTEM,
    contents: [{ role: 'user', parts: [{ inlineData: { mimeType: 'audio/wav', data: arrayBufferToBase64(audio.wav) } }, { text: prompt }] }],
    thinking: 'MINIMAL',
    signal: req.signal,
    maxOutputTokens: 700,
  });
  req.signal?.throwIfAborted();
  const result = { heard: concise(heard, 1400), stats: describeStats(stats), seconds: stats.durationSec, startBar, endBar };
  const cache = listenCache.get(p) ?? new Map<string, ListenResult>();
  if (cache.size >= 12) cache.delete(cache.keys().next().value!);
  cache.set(cacheKey, result);
  listenCache.set(p, cache);
  return result;
}

const SAMPLE_SYSTEM = `You are auditioning a sample for a music producer. Listen and describe it in 2-4 short lines:
what it is (instrument/sound), character and texture, apparent pitch/key and tempo feel if any, genres it fits, and anything wrong (clicks, noise, off-tempo, clipped, fades).
Be literal about what you hear. No preamble.`;

export async function audition(sampleId: string, question?: string, signal?: AbortSignal): Promise<{ heard: string }> {
  signal?.throwIfAborted();
  const meta = getSampleMeta(sampleId);
  if (!meta) throw new Error(`No sample with id ${sampleId}`);
  const buf = await loadBuffer(sampleId);
  if (!buf) throw new Error(`Couldn't load audio for ${meta.name}`);
  signal?.throwIfAborted();
  const preview = await renderSamplePreview(getProject(), sampleId);
  signal?.throwIfAborted();
  const pcm = preview.pcm;
  const { listeningQuality, listeningChannels } = useSettings.getState();
  const audio = prepareListeningAudio(pcm, listeningQuality, listeningChannels, 30);
  if (!question && meta.aiDescription && meta.aiDescriptionAudio === audio.label && meta.aiDescriptionContext === preview.signature) return { heard: concise(meta.aiDescription, 1200) };
  const facts: string[] = [`Duration ${buf.duration.toFixed(2)} s`, `category "${meta.category}"`];
  if (meta.bpm) facts.push(`tagged ${meta.bpm} BPM`);
  if (meta.key) facts.push(`tagged key ${meta.key}`);
  if (meta.kind === 'loop' && !meta.bpm) {
    const t = estimateTempo(pcm);
    if (t) facts.push(`detected tempo ≈${t.bpm}`);
  }
  if (meta.kind === 'oneshot') {
    const pitch = estimatePitch(pcm);
    if (pitch) facts.push(`detected pitch ≈${pitch.note}`);
  } else {
    const k = estimateKey(pcm);
    if (k && k.confidence > 0.4) facts.push(`detected key ≈${k.key}`);
  }
  const text = await generateText({
    system: SAMPLE_SYSTEM,
    contents: [{ role: 'user', parts: [{ inlineData: { mimeType: 'audio/wav', data: arrayBufferToBase64(audio.wav) } }, { text: `Sample "${meta.name}". ${facts.join(', ')}. ${preview.context} Audio: ${audio.label}.${question ? `\nQuestion: ${question}` : ''}` }] }],
    thinking: 'MINIMAL',
    signal,
    maxOutputTokens: 800,
  });
  signal?.throwIfAborted();
  const result = concise(text, 1200);
  if (!question) updateSampleMeta(sampleId, { aiDescription: result, aiDescriptionAudio: audio.label, aiDescriptionContext: preview.signature });
  return { heard: result };
}

/** Listen to arbitrary user-provided audio (a reference track) and extract a production brief. */
export async function analyzeReference(data: ArrayBuffer, name: string, signal?: AbortSignal): Promise<string> {
  signal?.throwIfAborted();
  const buf = await decodeAudio(data);
  signal?.throwIfAborted();
  const pcm = audioBufferToPcm(buf, 60);
  const { listeningQuality, listeningChannels } = useSettings.getState();
  const audio = prepareListeningAudio(pcm, listeningQuality, listeningChannels);
  const tempo = estimateTempo(pcm);
  const key = estimateKey(pcm);
  const text = await generateText({
    system: 'You are a producer breaking down a reference track so another producer can make something in the same style (not a copy). Be specific.',
    contents: [{
      role: 'user',
      parts: [
        { inlineData: { mimeType: 'audio/wav', data: arrayBufferToBase64(audio.wav) } },
        { text: `Reference "${name}". Measured tempo ≈${tempo?.bpm ?? '?'} BPM (could be half/double), key ≈${key?.key ?? '?'}.\nBreak it down: tempo feel, key/mood, drum pattern (kick/snare/hat placement, rolls), bass/808 behavior, melodic instruments & processing, arrangement, mix character. Then give a recipe as bullet points.` },
      ],
    }],
    thinking: 'LOW',
    signal,
    maxOutputTokens: 1800,
  });
  signal?.throwIfAborted();
  return concise(text, 4000);
}
