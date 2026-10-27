// Offline renders swap Tone's global context while they build their graph.
// Anything that constructs Tone nodes must hold this lock so live nodes never
// land in an offline context (or vice versa).

class Mutex {
  private tail: Promise<unknown> = Promise.resolve();

  run<T>(fn: () => Promise<T> | T): Promise<T> {
    const result = this.tail.then(fn, fn);
    this.tail = result.catch(() => undefined);
    return result;
  }
}

export const contextLock = new Mutex();
