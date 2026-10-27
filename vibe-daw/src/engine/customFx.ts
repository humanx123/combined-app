import * as Tone from 'tone';
import { reportCustomFxError as report } from '../state/customFxErrors';
import type { Effect } from '../model/types';
import { customValues } from '../model/customEffect';
import { compileCustomFx, runCustomBlock, workletMain } from './customRuntime';
import type { EffectUnit } from './effects';

export { useCustomFxErrors } from '../state/customFxErrors';

const workletSource = `(${workletMain})(${compileCustomFx}, ${runCustomBlock});`;
let workletUrl: string | null = null;
const modules = new WeakMap<BaseAudioContext, Promise<void>>();

/** Each context (realtime, and every offline render) needs the processor registered once. */
function loadWorklet(context: BaseAudioContext): Promise<void> {
  let loading = modules.get(context);
  if (!loading) {
    workletUrl ??= URL.createObjectURL(new Blob([workletSource], { type: 'text/javascript' }));
    loading = context.audioWorklet.addModule(workletUrl);
    modules.set(context, loading);
  }
  return loading;
}

export function createCustomEffect(effect: Effect): EffectUnit {
  const context = Tone.getContext();
  const raw = context.rawContext as unknown as BaseAudioContext;
  const live = !context.isOffline;
  const def = effect.custom;
  const input = new Tone.Gain(1);
  const output = new Tone.Gain(1);
  const values: Record<string, number | string> = { ...effect.params };
  const bpm = () => context.transport.bpm.value;
  let node: AudioWorkletNode | null = null;
  let disposed = false;
  const bypass = (error: string) => { input.connect(output); if (live) report(effect.id, error); };
  const ready = (async () => {
    if (!def) return bypass('This custom effect has no code');
    if (!raw.audioWorklet) return bypass('Custom effects need a secure (https) page');
    try { await loadWorklet(raw); } catch (error) { return bypass(`Could not start the effect runtime: ${String(error)}`); }
    if (disposed) return;
    node = context.createAudioWorkletNode('vibe-custom-fx', {
      numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2],
      channelCount: 2, channelCountMode: 'explicit', channelInterpretation: 'speakers',
      processorOptions: { code: def.code, params: customValues(def, values), bpm: bpm() },
    });
    if (live) {
      report(effect.id, undefined);
      node.port.onmessage = (e: MessageEvent<{ error?: string }>) => { if (e.data.error && !disposed) report(effect.id, e.data.error); };
    }
    Tone.connect(input, node);
    Tone.connect(node, output);
  })();
  return {
    input, output, ready,
    update: (q) => {
      Object.assign(values, q);
      if (def) node?.port.postMessage({ params: customValues(def, values), bpm: bpm() });
    },
    dispose: () => {
      disposed = true;
      node?.port.close();
      node?.disconnect();
      input.dispose();
      output.dispose();
    },
  };
}
