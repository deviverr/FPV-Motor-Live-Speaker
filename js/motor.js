import { MSP, encodeMspFrame, buildMotorPayload } from './msp.js';

export class MotorController {
  constructor() {
    // Protocol settings
    this.protocol = 'dshot'; // 'dshot' or 'analog'
    this.motorCount = 4;

    // DShot defaults
    this.dshotMin = 48;
    this.dshotMax = 150;       // Conservative default
    this.dshotDisarmed = 0;
    this.dshotHardCap = 400;   // Absolute max allowed

    // Analog defaults
    this.analogMin = 1050;
    this.analogMax = 1150;     // Conservative default
    this.analogDisarmed = 1000;
    this.analogHardCap = 1300; // Absolute max allowed

    // Frequency mapping range
    this.minFrequency = 50;    // Hz
    this.maxFrequency = 500;   // Hz

    // Safety
    this.enabled = false;
    this.slewRate = 15;        // Max throttle change per update cycle
    this.currentThrottle = 0;
    this.lastUpdateTime = 0;

    // Internal
    this._interval = null;
    this._serial = null;
    this._getFrequency = null;
  }

  get minThrottle() {
    return this.protocol === 'dshot' ? this.dshotMin : this.analogMin;
  }

  get maxThrottle() {
    return this.protocol === 'dshot' ? this.dshotMax : this.analogMax;
  }

  set maxThrottle(val) {
    const cap = this.protocol === 'dshot' ? this.dshotHardCap : this.analogHardCap;
    if (this.protocol === 'dshot') {
      this.dshotMax = Math.min(val, cap);
    } else {
      this.analogMax = Math.min(val, cap);
    }
  }

  get disarmedValue() {
    return this.protocol === 'dshot' ? this.dshotDisarmed : this.analogDisarmed;
  }

  get hardCap() {
    return this.protocol === 'dshot' ? this.dshotHardCap : this.analogHardCap;
  }

  /**
   * Map detected audio frequency + intensity to a throttle value.
   */
  frequencyToThrottle(frequency, intensity = 1.0) {
    if (frequency <= 0 || intensity <= 0) {
      return this.disarmedValue;
    }

    const clampedFreq = Math.max(this.minFrequency, Math.min(frequency, this.maxFrequency));
    const t = (clampedFreq - this.minFrequency) / (this.maxFrequency - this.minFrequency);
    const rawThrottle = this.minThrottle + t * (this.maxThrottle - this.minThrottle);

    // Scale by intensity
    const throttle = this.disarmedValue + (rawThrottle - this.disarmedValue) * intensity;
    return Math.round(Math.max(this.disarmedValue, Math.min(throttle, this.maxThrottle)));
  }

  /**
   * Apply slew rate limiting for smooth transitions.
   */
  applySlewRate(target) {
    const delta = target - this.currentThrottle;
    const clamped = Math.max(-this.slewRate, Math.min(this.slewRate, delta));
    return this.currentThrottle + clamped;
  }

  /**
   * Start the motor command loop.
   * @param {SerialConnection} serial
   * @param {Function} getFrequency - Returns { frequency, magnitude }
   */
  startLoop(serial, getFrequency) {
    this._serial = serial;
    this._getFrequency = getFrequency;
    this.enabled = true;
    this.currentThrottle = this.disarmedValue;
    this.lastUpdateTime = Date.now();

    const UPDATE_MS = 20; // 50 Hz

    this._interval = setInterval(() => this._update(), UPDATE_MS);
  }

  stopLoop() {
    this.enabled = false;
    if (this._interval) {
      clearInterval(this._interval);
      this._interval = null;
    }
    // Send stop command
    if (this._serial && this._serial.connected) {
      this._sendMotorValues(this.disarmedValue);
    }
    this.currentThrottle = this.disarmedValue;
  }

  /**
   * Emergency stop: send disarmed values multiple times.
   */
  async emergencyStop() {
    this.enabled = false;
    if (this._interval) {
      clearInterval(this._interval);
      this._interval = null;
    }
    this.currentThrottle = this.disarmedValue;

    if (this._serial && this._serial.connected) {
      for (let i = 0; i < 3; i++) {
        try {
          await this._sendMotorValues(this.disarmedValue);
        } catch (e) { /* best effort */ }
      }
    }
  }

  async _update() {
    if (!this.enabled || !this._serial || !this._serial.connected) {
      this.stopLoop();
      return;
    }

    const { frequency, magnitude } = this._getFrequency();

    // Heartbeat check: if magnitude is very low, send disarmed
    const noiseFloor = -70;
    const intensity = Math.max(0, Math.min(1, (magnitude - (-80)) / ((-10) - (-80))));

    const targetThrottle = this.frequencyToThrottle(frequency, intensity);
    const smoothedThrottle = this.applySlewRate(targetThrottle);
    this.currentThrottle = smoothedThrottle;

    this.lastUpdateTime = Date.now();

    try {
      await this._sendMotorValues(smoothedThrottle);
    } catch (e) {
      this.emergencyStop();
    }
  }

  async _sendMotorValues(throttle) {
    const values = new Array(this.motorCount).fill(Math.round(throttle));
    const payload = buildMotorPayload(values, this.disarmedValue);
    const frame = encodeMspFrame(MSP.MSP_SET_MOTOR, payload);
    await this._serial.write(frame);
  }
}
