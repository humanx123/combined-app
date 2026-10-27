import type { CustomEffectDef } from '../model/types';
import { customValues } from '../model/customEffect';
import { compileCustomFx, lockDownWorker, runCustomBlock, runCustomTest, workerMain, type CustomTestResult } from './customRuntime';

const workerSource = `(${workerMain})(${compileCustomFx}, ${runCustomBlock}, ${runCustomTest}, ${lockDownWorker});`;

export interface CustomCheck { ok: boolean; error?: string; warnings: string[]; result?: CustomTestResult }

/**
 * Compile and run the effect over a few seconds of test audio before it can reach the
 * audio thread. Runs in a locked-down worker that is terminated after `timeoutMs`, so
 * syntax errors, exceptions, NaNs and runaway loops come back as messages instead of
 * hanging playback. Only for code someone is writing now; never run on project load.
 */
export async function checkCustomEffect(def: CustomEffectDef, values: Record<string, number | string>, bpm: number, timeoutMs = 2500): Promise<CustomCheck> {
  try { new Function('sampleRate', 'bpm', `"use strict";\n${def.code}`); } // parse only: nothing executes
  catch (error) { return { ok: false, error: `${(error as Error).name}: ${(error as Error).message}`, warnings: [] }; }
  const request = { code: def.code, params: customValues(def, values), bpm, sampleRate: 48000, seconds: 2 };
  let result: CustomTestResult;
  if (typeof Worker === 'undefined') result = runCustomTest(compileCustomFx, runCustomBlock, request); // tests (Node)
  else {
    const url = URL.createObjectURL(new Blob([workerSource], { type: 'text/javascript' }));
    const worker = new Worker(url);
    try {
      result = await new Promise<CustomTestResult>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`process() did not finish ${request.seconds}s of audio within ${timeoutMs / 1000}s. Look for an endless loop, or work that grows with each call.`)), timeoutMs);
        worker.onmessage = (e: MessageEvent<CustomTestResult>) => { clearTimeout(timer); resolve(e.data); };
        worker.onerror = (e) => { clearTimeout(timer); e.preventDefault(); reject(new Error(e.message || 'The effect crashed while loading')); };
        worker.postMessage(request);
      });
    } catch (error) {
      return { ok: false, error: (error as Error).message, warnings: [] };
    } finally {
      worker.terminate();
      URL.revokeObjectURL(url);
    }
  }
  if (result.error) return { ok: false, error: result.error, warnings: [], result };
  const warnings: string[] = [];
  if (result.nonFinite) warnings.push(`${result.nonFinite} NaN/infinite samples were silenced. Guard divisions and feedback.`);
  if (result.peak === 0) warnings.push('The effect output pure silence on the test signal.');
  else if (result.peak >= 4) warnings.push('Output hit the ±4 safety clamp. Lower the gain or feedback.');
  else if (result.peak > 1.5) warnings.push(`Output peaks at ${result.peak.toFixed(2)} (+${(20 * Math.log10(result.peak)).toFixed(1)} dBFS). Consider an output trim.`);
  const load = result.ms / 1000 / result.seconds;
  if (load > 0.25) warnings.push(`Heavy: ${Math.round(load * 100)}% of one CPU core in the test. Avoid allocating or heavy math per sample.`);
  return { ok: true, warnings, result };
}
