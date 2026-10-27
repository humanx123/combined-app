class Capture extends AudioWorkletProcessor {
  process(inputs) {
    const channels = inputs[0];
    if (channels.length) {
      const data = channels.map((c) => c.slice());
      this.port.postMessage({ frame: currentFrame, channels: data }, data.map((c) => c.buffer));
    }
    return true;
  }
}
registerProcessor('capture', Capture);
