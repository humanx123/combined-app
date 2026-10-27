export interface AudioDevice {
  userAgent?: string;
  hardwareConcurrency?: number;
  maxTouchPoints?: number;
  deviceMemory?: number;
}
const MiB = 1024 * 1024;

/** iOS browser brands still share WebKit's page memory limits. */
export function audioBudget(device: AudioDevice = globalThis.navigator ?? {}) {
  const ua = device.userAgent ?? '';
  const webkit = /AppleWebKit/i.test(ua) && !/(Chrome|Chromium|Edg|OPR)\//i.test(ua);
  const mobile = /Android|iPhone|iPad|iPod|Mobile/i.test(ua) || (webkit && (device.maxTouchPoints ?? 0) > 1);
  const constrained = mobile || webkit || (device.deviceMemory !== undefined && device.deviceMemory <= 4);
  return {
    workers: constrained ? 1 : Math.max(1, Math.min(4, (device.hardwareConcurrency || 2) - 1)),
    freezeCacheBytes: (constrained ? 64 : 256) * MiB,
    workingBytes: (constrained ? 96 : 256) * MiB,
    maxOutputBytes: (constrained ? 128 : 512) * MiB,
  };
}

/** Reserve the stereo mix and master copy before allocating parallel stem buffers. */
export function renderWorkers(outputBytes: number, device?: AudioDevice): number {
  const budget = audioBudget(device);
  return Math.max(1, Math.min(budget.workers, Math.floor((budget.workingBytes - outputBytes * 2) / Math.max(1, outputBytes))));
}
