import { MSP, encodeMspFrame, parseApiVersion, parseFcVariant, parseMotorConfig } from './msp.js';
import { SerialConnection } from './serial.js';
import { AudioCapture } from './audio.js';
import { MotorController } from './motor.js';

// --- State ---
const State = {
  DISCONNECTED: 'disconnected',
  CONNECTED: 'connected',
  CAPTURING: 'capturing',
  ACTIVE: 'active',
};
let state = State.DISCONNECTED;

// --- Modules ---
const serial = new SerialConnection();
const audio = new AudioCapture();
const motor = new MotorController();

// --- DOM Elements ---
const $ = (id) => document.getElementById(id);

const els = {
  safetyModal: $('safety-modal'),
  btnSafetyConfirm: $('btn-safety-confirm'),
  compatWarning: $('compat-warning'),
  btnConnect: $('btn-connect'),
  btnDisconnect: $('btn-disconnect'),
  serialDot: $('serial-dot'),
  serialStatus: $('serial-status'),
  fcInfo: $('fc-info'),
  btnCapture: $('btn-capture'),
  btnStopAudio: $('btn-stop-audio'),
  audioDot: $('audio-dot'),
  audioStatus: $('audio-status'),
  spectrum: $('spectrum'),
  freqValue: $('freq-value'),
  throttleValue: $('throttle-value'),
  sliderMaxThrottle: $('slider-max-throttle'),
  valMaxThrottle: $('val-max-throttle'),
  sliderMinFreq: $('slider-min-freq'),
  valMinFreq: $('val-min-freq'),
  sliderMaxFreq: $('slider-max-freq'),
  valMaxFreq: $('val-max-freq'),
  sliderSensitivity: $('slider-sensitivity'),
  valSensitivity: $('val-sensitivity'),
  selectProtocol: $('select-protocol'),
  selectMotors: $('select-motors'),
  sliderSlew: $('slider-slew'),
  valSlew: $('val-slew'),
  toggleEnable: $('toggle-enable'),
  btnEstop: $('btn-estop'),
};

// --- Browser Compatibility ---
if (!('serial' in navigator)) {
  els.compatWarning.style.display = 'block';
  els.compatWarning.textContent = 'Web Serial API not supported. Please use Chrome 89+ or Edge 89+.';
}

// --- Safety Modal ---
els.btnSafetyConfirm.addEventListener('click', () => {
  els.safetyModal.classList.add('hidden');
});

// --- State Management ---
function setState(newState) {
  state = newState;
  updateUI();
}

function updateUI() {
  const connected = state !== State.DISCONNECTED;
  const capturing = state === State.CAPTURING || state === State.ACTIVE;
  const active = state === State.ACTIVE;

  els.btnConnect.disabled = connected;
  els.btnDisconnect.disabled = !connected;
  els.btnCapture.disabled = !connected || capturing;
  els.btnStopAudio.disabled = !capturing;
  els.toggleEnable.disabled = !capturing;
  els.toggleEnable.checked = active;

  // Status dots
  els.serialDot.className = 'status-dot' + (connected ? ' connected' : '');
  els.serialStatus.textContent = connected ? 'Connected' : 'Disconnected';

  els.audioDot.className = 'status-dot' + (capturing ? ' capturing' : '');
  els.audioStatus.textContent = capturing ? 'Capturing' : 'Inactive';

  if (!active) {
    els.freqValue.textContent = '0';
    els.throttleValue.textContent = '0';
  }
}

// --- Serial Events ---
serial.onDisconnect = () => {
  motor.emergencyStop();
  audio.stop();
  setState(State.DISCONNECTED);
  els.fcInfo.textContent = '';
};

serial.onMspFrame = (frame) => {
  // Handle FC info responses
  if (frame.command === MSP.MSP_API_VERSION) {
    const info = parseApiVersion(frame.payload);
    if (info) {
      els.fcInfo.textContent = `API: ${info.major}.${info.minor}`;
    }
  } else if (frame.command === MSP.MSP_FC_VARIANT) {
    const variant = parseFcVariant(frame.payload);
    els.fcInfo.textContent += ` | FC: ${variant}`;
  } else if (frame.command === MSP.MSP_MOTOR_CONFIG) {
    const cfg = parseMotorConfig(frame.payload);
    if (cfg) {
      els.fcInfo.textContent += ` | MinThrottle: ${cfg.minThrottle} MaxThrottle: ${cfg.maxThrottle}`;
    }
  }
};

// --- Connect / Disconnect ---
els.btnConnect.addEventListener('click', async () => {
  try {
    await serial.connect(115200);
    setState(State.CONNECTED);

    // Query FC info
    await serial.write(encodeMspFrame(MSP.MSP_API_VERSION));
    setTimeout(async () => {
      try {
        await serial.write(encodeMspFrame(MSP.MSP_FC_VARIANT));
      } catch (e) { /* ignore */ }
    }, 100);
    setTimeout(async () => {
      try {
        await serial.write(encodeMspFrame(MSP.MSP_MOTOR_CONFIG));
      } catch (e) { /* ignore */ }
    }, 200);
  } catch (err) {
    console.error('Connect failed:', err);
  }
});

els.btnDisconnect.addEventListener('click', async () => {
  motor.emergencyStop();
  audio.stop();
  await serial.disconnect();
  setState(State.DISCONNECTED);
  els.fcInfo.textContent = '';
});

// --- Audio Capture ---
els.btnCapture.addEventListener('click', async () => {
  try {
    await audio.start();
    setState(State.CAPTURING);
    startVisualization();
  } catch (err) {
    console.error('Audio capture failed:', err);
    alert('Audio capture failed: ' + err.message);
  }
});

els.btnStopAudio.addEventListener('click', () => {
  motor.emergencyStop();
  audio.stop();
  setState(State.CONNECTED);
  stopVisualization();
});

// Handle audio track ending (user stops sharing)
const origOnFreqUpdate = audio.onFrequencyUpdate;
audio.onFrequencyUpdate = (freq, mag) => {
  if (!audio.active && (state === State.CAPTURING || state === State.ACTIVE)) {
    motor.emergencyStop();
    setState(State.CONNECTED);
    stopVisualization();
  }
};

// --- Motor Enable Toggle ---
els.toggleEnable.addEventListener('change', () => {
  if (els.toggleEnable.checked) {
    applySettings();
    motor.startLoop(serial, () => audio.lastResult);
    setState(State.ACTIVE);
  } else {
    motor.stopLoop();
    setState(State.CAPTURING);
  }
});

// --- Emergency Stop ---
els.btnEstop.addEventListener('click', () => {
  motor.emergencyStop();
  els.toggleEnable.checked = false;
  if (state === State.ACTIVE) {
    setState(State.CAPTURING);
  }
});

// --- Controls ---
function applySettings() {
  motor.protocol = els.selectProtocol.value;
  motor.motorCount = parseInt(els.selectMotors.value);
  motor.maxThrottle = parseInt(els.sliderMaxThrottle.value);
  motor.minFrequency = parseInt(els.sliderMinFreq.value);
  motor.maxFrequency = parseInt(els.sliderMaxFreq.value);
  motor.slewRate = parseInt(els.sliderSlew.value);
}

function updateSliderDisplay(slider, display, suffix = '') {
  display.textContent = slider.value + suffix;
}

// Bind all sliders
els.sliderMaxThrottle.addEventListener('input', () => {
  updateSliderDisplay(els.sliderMaxThrottle, els.valMaxThrottle);
  applySettings();
});
els.sliderMinFreq.addEventListener('input', () => {
  updateSliderDisplay(els.sliderMinFreq, els.valMinFreq);
  applySettings();
});
els.sliderMaxFreq.addEventListener('input', () => {
  updateSliderDisplay(els.sliderMaxFreq, els.valMaxFreq);
  applySettings();
});
els.sliderSensitivity.addEventListener('input', () => {
  updateSliderDisplay(els.sliderSensitivity, els.valSensitivity);
});
els.sliderSlew.addEventListener('input', () => {
  updateSliderDisplay(els.sliderSlew, els.valSlew);
  applySettings();
});

// Protocol change updates throttle slider range
els.selectProtocol.addEventListener('change', () => {
  const isDshot = els.selectProtocol.value === 'dshot';
  els.sliderMaxThrottle.max = isDshot ? 400 : 1300;
  els.sliderMaxThrottle.min = isDshot ? 0 : 1000;
  els.sliderMaxThrottle.value = isDshot ? 150 : 1100;
  updateSliderDisplay(els.sliderMaxThrottle, els.valMaxThrottle);
  applySettings();
});

els.selectMotors.addEventListener('change', applySettings);

// --- Spectrum Visualization ---
let vizAnimFrame = null;
const spectrumCanvas = els.spectrum;
const spectrumCtx = spectrumCanvas.getContext('2d');

function resizeCanvas() {
  spectrumCanvas.width = spectrumCanvas.clientWidth * window.devicePixelRatio;
  spectrumCanvas.height = spectrumCanvas.clientHeight * window.devicePixelRatio;
  spectrumCtx.scale(window.devicePixelRatio, window.devicePixelRatio);
}
resizeCanvas();
window.addEventListener('resize', resizeCanvas);

function startVisualization() {
  function drawFrame() {
    const w = spectrumCanvas.clientWidth;
    const h = spectrumCanvas.clientHeight;

    spectrumCtx.setTransform(window.devicePixelRatio, 0, 0, window.devicePixelRatio, 0, 0);
    spectrumCtx.fillStyle = '#0a0a1a';
    spectrumCtx.fillRect(0, 0, w, h);

    const specData = audio.getSpectrumData();
    if (!specData) {
      vizAnimFrame = requestAnimationFrame(drawFrame);
      return;
    }

    // Draw up to ~2000 Hz worth of bins
    const sampleRate = audio.audioContext ? audio.audioContext.sampleRate : 48000;
    const binsToShow = Math.min(Math.ceil(2000 / (sampleRate / 2) * specData.length), specData.length);
    const barWidth = w / binsToShow;

    for (let i = 0; i < binsToShow; i++) {
      const val = specData[i] / 255;
      const barH = val * h;

      // Color: green to yellow to red based on height
      const hue = 120 - val * 120;
      spectrumCtx.fillStyle = `hsl(${hue}, 80%, 50%)`;
      spectrumCtx.fillRect(i * barWidth, h - barH, Math.max(barWidth - 1, 1), barH);
    }

    // Draw dominant frequency marker
    const { frequency, magnitude } = audio.lastResult;
    if (frequency > 0) {
      const freqBin = frequency / (sampleRate / 2) * specData.length;
      const x = (freqBin / binsToShow) * w;
      spectrumCtx.strokeStyle = 'white';
      spectrumCtx.lineWidth = 2;
      spectrumCtx.beginPath();
      spectrumCtx.moveTo(x, 0);
      spectrumCtx.lineTo(x, h);
      spectrumCtx.stroke();
    }

    // Update readouts
    els.freqValue.textContent = frequency > 0 ? Math.round(frequency) : '0';
    els.throttleValue.textContent = Math.round(motor.currentThrottle);

    vizAnimFrame = requestAnimationFrame(drawFrame);
  }
  vizAnimFrame = requestAnimationFrame(drawFrame);
}

function stopVisualization() {
  if (vizAnimFrame) {
    cancelAnimationFrame(vizAnimFrame);
    vizAnimFrame = null;
  }
  // Clear canvas
  const w = spectrumCanvas.clientWidth;
  const h = spectrumCanvas.clientHeight;
  spectrumCtx.setTransform(window.devicePixelRatio, 0, 0, window.devicePixelRatio, 0, 0);
  spectrumCtx.fillStyle = '#0a0a1a';
  spectrumCtx.fillRect(0, 0, w, h);
  els.freqValue.textContent = '0';
  els.throttleValue.textContent = '0';
}

// --- Init ---
updateUI();
