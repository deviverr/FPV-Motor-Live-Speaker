# FPV Motor Live Speaker

Turn your FPV drone motors into a live speaker. This web app captures system audio, detects the dominant frequency in real-time, and sends motor commands to a Betaflight flight controller via USB — making your motors hum, buzz, and sing along to whatever you're playing.

> **[Launch App](https://deviverr.github.io/FPV-Motor-Live-Speaker/)**

![Chrome](https://img.shields.io/badge/Chrome_89+-supported-brightgreen) ![Edge](https://img.shields.io/badge/Edge_89+-supported-brightgreen) ![Betaflight](https://img.shields.io/badge/Betaflight-MSP-blue)

---

## How It Works

```
System Audio → Browser captures audio via Screen Share
                        ↓
              Web Audio API → FFT Analysis
                        ↓
              Dominant Frequency Detection (50-1000 Hz)
                        ↓
              Frequency → Motor Throttle Mapping
                        ↓
              Web Serial USB → MSP Protocol → Flight Controller → ESCs → Motors
```

Motors produce audible tones based on their RPM. Higher throttle = higher pitch. The app maps the detected audio frequency to a throttle value and sends it to all motors at 50 Hz, making them follow the pitch of whatever you're listening to.

## Quick Start

1. **Remove all propellers** from your drone
2. Open the app in **Chrome** or **Edge** (Web Serial API required)
3. Plug in your Betaflight flight controller via **USB**
4. Click **Connect** and select the serial port
5. Click **Capture System Audio** and share a tab/screen playing audio
6. Toggle **Motor Output** on (start with low max throttle!)
7. Watch your motors follow the music

## Features

- **Real-time spectrum visualizer** with dominant frequency marker
- **System audio capture** via browser Screen Share (no drivers needed)
- **MSP protocol** communication with Betaflight flight controllers
- **Adjustable controls**: max throttle, frequency range, sensitivity, slew rate
- **DShot & Analog PWM** protocol support
- **Multiple safety layers** (see below)

## Safety

This app directly controls motor speed. **Always remove propellers before use.**

| Layer | Protection |
|-------|-----------|
| Startup modal | Must confirm props are removed before using the app |
| Max throttle cap | Hard-coded limit: DShot 400 / Analog 1300 (default much lower) |
| Emergency stop | Big red button — always visible, stops all motors instantly |
| Disconnect auto-stop | Motors stop automatically if USB is disconnected |
| Slew rate limiter | Prevents sudden motor speed jumps |
| Noise gate | Motors stay off when no audio is detected |
| FC timeout | Betaflight's built-in 4-second motor test timeout as a final safety net |

## Requirements

- **Browser**: Chrome 89+ or Edge 89+ (Web Serial API)
- **Flight Controller**: Betaflight firmware (tested with Betaflight 4.x)
- **Connection**: USB cable to flight controller
- **ESC Protocol**: DShot (recommended) or Analog PWM

## Controls

| Control | Description |
|---------|------------|
| Max Throttle | Upper limit for motor speed (keep low to start!) |
| Min/Max Frequency | Audio frequency range to map to throttle |
| Sensitivity | Noise floor threshold in dB |
| Slew Rate | How fast throttle can change per update cycle |
| Protocol | DShot or Analog PWM (must match your FC config) |
| Motor Count | Number of motors (3/4/6/8) |

## Tech Stack

Pure vanilla web — no frameworks, no build tools, no dependencies.

- **Web Serial API** — USB serial communication
- **Web Audio API** — FFT analysis with `AnalyserNode`
- **getDisplayMedia** — system audio capture
- **MSP v1 Protocol** — Betaflight flight controller commands
- **Canvas API** — spectrum visualization

## File Structure

```
index.html        → UI layout and panels
css/style.css     → Dark theme styling
js/msp.js         → MSP v1 protocol encoder/decoder
js/serial.js      → Web Serial API connection wrapper
js/audio.js       → Audio capture and FFT frequency detection
js/motor.js       → Frequency-to-throttle mapping and motor loop
js/app.js         → App state machine and UI orchestration
```

## License

MIT
