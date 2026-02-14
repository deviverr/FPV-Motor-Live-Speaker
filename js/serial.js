import { decodeMspFrame } from './msp.js';

export class SerialConnection {
  constructor() {
    this.port = null;
    this.reader = null;
    this.writer = null;
    this.connected = false;
    this.readBuffer = new Uint8Array(0);

    this.onDisconnect = null;
    this.onMspFrame = null;

    this._readLoopActive = false;

    // Listen for USB disconnect events
    if ('serial' in navigator) {
      navigator.serial.addEventListener('disconnect', (e) => {
        if (this.port && e.target === this.port) {
          this._handleDisconnect();
        }
      });
    }
  }

  async connect(baudRate = 115200) {
    this.port = await navigator.serial.requestPort();
    await this.port.open({ baudRate });
    this.writer = this.port.writable.getWriter();
    this.connected = true;
    this._startReadLoop();
  }

  async disconnect() {
    this._readLoopActive = false;
    try {
      if (this.reader) {
        await this.reader.cancel();
        this.reader.releaseLock();
        this.reader = null;
      }
    } catch (e) { /* ignore */ }
    try {
      if (this.writer) {
        this.writer.releaseLock();
        this.writer = null;
      }
    } catch (e) { /* ignore */ }
    try {
      if (this.port) {
        await this.port.close();
      }
    } catch (e) { /* ignore */ }
    this.port = null;
    this.connected = false;
    this.readBuffer = new Uint8Array(0);
  }

  async write(data) {
    if (!this.writer || !this.connected) {
      throw new Error('Not connected');
    }
    await this.writer.write(data);
  }

  _startReadLoop() {
    this._readLoopActive = true;
    this.reader = this.port.readable.getReader();
    this._readLoop();
  }

  async _readLoop() {
    try {
      while (this._readLoopActive) {
        const { value, done } = await this.reader.read();
        if (done) break;
        if (value) {
          this._appendToBuffer(value);
          this._processBuffer();
        }
      }
    } catch (err) {
      // Read error = disconnected
    } finally {
      try { this.reader.releaseLock(); } catch (e) { /* ignore */ }
      this.reader = null;
      if (this.connected) {
        this._handleDisconnect();
      }
    }
  }

  _appendToBuffer(chunk) {
    const newBuffer = new Uint8Array(this.readBuffer.length + chunk.length);
    newBuffer.set(this.readBuffer);
    newBuffer.set(chunk, this.readBuffer.length);
    this.readBuffer = newBuffer;
  }

  _processBuffer() {
    while (this.readBuffer.length >= 6) {
      const result = decodeMspFrame(this.readBuffer);
      if (!result) break;
      this.readBuffer = this.readBuffer.slice(result.bytesConsumed);
      if (!result.error && this.onMspFrame) {
        this.onMspFrame(result);
      }
    }
    // Prevent buffer from growing unbounded with garbage data
    if (this.readBuffer.length > 4096) {
      this.readBuffer = this.readBuffer.slice(-256);
    }
  }

  _handleDisconnect() {
    this.connected = false;
    if (this.onDisconnect) {
      this.onDisconnect();
    }
  }
}
