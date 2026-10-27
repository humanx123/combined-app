import { beforeEach, expect, it, vi } from 'vitest';
const fake = vi.hoisted(() => ({ instances: [] as Array<{ triggerAttackRelease: ReturnType<typeof vi.fn>; triggerRelease: ReturnType<typeof vi.fn>; dispose: ReturnType<typeof vi.fn> }> }));
vi.mock('tone', () => ({
  ToneAudioNode: class { context = {}; now() { return 0; } dispose() { return this; } },
  Gain: class { dispose() {} },
}));
import { VoicePool } from './voicePool';
import type * as Tone from 'tone';

class FakeVoice {
  triggerAttackRelease = vi.fn(); triggerRelease = vi.fn(); dispose = vi.fn();
  constructor() { fake.instances.push(this); }
  connect() {} set() {}
  get() { return { envelope: { release: 2 } }; }
}
beforeEach(() => { fake.instances.length = 0; });
const make = () => new VoicePool(FakeVoice as unknown as typeof Tone.Synth, {});

it('plays every incoming note while keeping allocation bounded', () => {
  const pool = make(); pool.maxPolyphony = 2;
  for (let i = 0; i < 80; i++) pool.triggerAttackRelease(220 + i, 1, i * 0.01, 0.5);
  expect(fake.instances).toHaveLength(2);
  expect(fake.instances.reduce((sum, voice) => sum + voice.triggerAttackRelease.mock.calls.length, 0)).toBe(80);
  pool.dispose();
  expect(fake.instances.every((voice) => voice.dispose.mock.calls.length === 1)).toBe(true);
});

it('steals a release tail before a sustained note and reuses free slots', () => {
  const pool = make(); pool.maxPolyphony = 2;
  pool.triggerAttackRelease(220, 10, 0);
  pool.triggerAttackRelease(330, 0.1, 0.01);
  pool.triggerAttackRelease(440, 0.1, 0.2);
  expect(fake.instances[0].triggerAttackRelease).toHaveBeenCalledTimes(1);
  expect(fake.instances[1].triggerAttackRelease).toHaveBeenCalledTimes(2);
  pool.triggerAttackRelease(550, 0.1, 3);
  expect(fake.instances).toHaveLength(2);
  expect(fake.instances[1].triggerAttackRelease).toHaveBeenCalledTimes(3);
});
