export class AudioCapture {
  constructor() {
    this.audioContext = null;
    this.analyser = null;
    this.sourceNode = null;
    this.stream = null;
    this.frequencyData = null;
    this.timeDomainData = null;
    this.active = false;
    this.lastResult = { frequency: 0, magnitude: -100 };

    this.onFrequencyUpdate = null;
    this._animFrameId = null;
  }

  async start() {
    this.stream = await navigator.mediaDevices.getDisplayMedia({
      video: true,
      audio: true,
    });

    // Stop video track — we only need audio
    this.stream.getVideoTracks().forEach(track => track.stop());

    const audioTracks = this.stream.getAudioTracks();
    if (audioTracks.length === 0) {
      this.stream.getTracks().forEach(t => t.stop());
      throw new Error('No audio track. Make sure to check "Share audio" in the dialog.');
    }

    // Stop when user ends sharing from browser UI
    audioTracks[0].addEventListener('ended', () => this.stop());

    this.audioContext = new AudioContext();
    this.analyser = this.audioContext.createAnalyser();
    this.analyser.fftSize = 8192;
    this.analyser.smoothingTimeConstant = 0.8;
    this.analyser.minDecibels = -100;
    this.analyser.maxDecibels = -10;

    this.sourceNode = this.audioContext.createMediaStreamSource(this.stream);
    this.sourceNode.connect(this.analyser);

    this.frequencyData = new Float32Array(this.analyser.frequencyBinCount);
    this.timeDomainData = new Uint8Array(this.analyser.frequencyBinCount);

    this.active = true;
    this._analysisLoop();
  }

  stop() {
    this.active = false;
    if (this._animFrameId) {
      cancelAnimationFrame(this._animFrameId);
      this._animFrameId = null;
    }
    if (this.sourceNode) {
      this.sourceNode.disconnect();
      this.sourceNode = null;
    }
    if (this.stream) {
      this.stream.getTracks().forEach(t => t.stop());
      this.stream = null;
    }
    if (this.audioContext) {
      this.audioContext.close();
      this.audioContext = null;
    }
    this.analyser = null;
    this.lastResult = { frequency: 0, magnitude: -100 };
  }

  getDominantFrequency() {
    if (!this.analyser) return { frequency: 0, magnitude: -100 };

    this.analyser.getFloatFrequencyData(this.frequencyData);

    const sampleRate = this.audioContext.sampleRate;
    const binCount = this.analyser.frequencyBinCount;
    const binWidth = (sampleRate / 2) / binCount;

    // Scan 50–1000 Hz range
    const minBin = Math.floor(50 / binWidth);
    const maxBin = Math.min(Math.ceil(1000 / binWidth), binCount - 1);

    let peakBin = minBin;
    let peakMag = -Infinity;

    for (let i = minBin; i <= maxBin; i++) {
      if (this.frequencyData[i] > peakMag) {
        peakMag = this.frequencyData[i];
        peakBin = i;
      }
    }

    // Noise gate
    if (peakMag < -70) {
      return { frequency: 0, magnitude: peakMag };
    }

    // Parabolic interpolation for sub-bin accuracy
    let interpolatedBin = peakBin;
    if (peakBin > 0 && peakBin < binCount - 1) {
      const alpha = this.frequencyData[peakBin - 1];
      const beta = this.frequencyData[peakBin];
      const gamma = this.frequencyData[peakBin + 1];
      const denom = alpha - 2 * beta + gamma;
      if (denom !== 0) {
        const correction = 0.5 * (alpha - gamma) / denom;
        if (Math.abs(correction) < 1) {
          interpolatedBin = peakBin + correction;
        }
      }
    }

    return {
      frequency: interpolatedBin * binWidth,
      magnitude: peakMag,
    };
  }

  /**
   * Get byte frequency data for spectrum visualization (0-255 range).
   */
  getSpectrumData() {
    if (!this.analyser) return null;
    const data = new Uint8Array(this.analyser.frequencyBinCount);
    this.analyser.getByteFrequencyData(data);
    return data;
  }

  _analysisLoop() {
    if (!this.active) return;
    this.lastResult = this.getDominantFrequency();
    if (this.onFrequencyUpdate) {
      this.onFrequencyUpdate(this.lastResult.frequency, this.lastResult.magnitude);
    }
    this._animFrameId = requestAnimationFrame(() => this._analysisLoop());
  }
}
