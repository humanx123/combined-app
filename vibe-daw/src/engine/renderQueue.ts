import { audioBudget } from './budget';

// Freeze jobs, agent listening and user exports share the same native audio threads.
// Separate per-operation pools must not each consume a full device budget at once.
let active = 0;
const pending: Array<() => void> = [];
function drain() {
  while (pending.length && active < audioBudget().workers) pending.shift()!();
}

export function withRenderSlot<T>(render: () => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    pending.push(() => {
      active++;
      Promise.resolve().then(render).then(resolve, reject).finally(() => { active--; drain(); });
    });
    drain();
  });
}
