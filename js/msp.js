// MSP v1 Protocol Constants
export const MSP = {
  HEADER: [0x24, 0x4D],    // '$M'
  DIR_TO_FC: 0x3C,          // '<'
  DIR_FROM_FC: 0x3E,        // '>'
  DIR_ERROR: 0x21,           // '!'

  // Commands
  MSP_API_VERSION: 1,
  MSP_FC_VARIANT: 2,
  MSP_FC_VERSION: 3,
  MSP_MOTOR: 104,
  MSP_MOTOR_CONFIG: 131,
  MSP_SET_MOTOR: 214,
};

/**
 * Encode an MSP v1 command frame.
 * Frame: $M< + length + command + payload + checksum
 * Checksum = XOR of length, command, and all payload bytes.
 */
export function encodeMspFrame(command, payload = new Uint8Array(0)) {
  const length = payload.length;
  const frame = new Uint8Array(6 + length);
  frame[0] = 0x24; // $
  frame[1] = 0x4D; // M
  frame[2] = 0x3C; // <
  frame[3] = length;
  frame[4] = command;

  let checksum = length ^ command;
  for (let i = 0; i < length; i++) {
    frame[5 + i] = payload[i];
    checksum ^= payload[i];
  }
  frame[5 + length] = checksum & 0xFF;
  return frame;
}

/**
 * Build MSP_SET_MOTOR payload.
 * 8 motors x 2 bytes (uint16 little-endian) = 16 bytes.
 */
export function buildMotorPayload(motorValues, disarmedValue = 0) {
  const payload = new Uint8Array(16);
  const view = new DataView(payload.buffer);
  for (let i = 0; i < 8; i++) {
    const value = i < motorValues.length ? motorValues[i] : disarmedValue;
    view.setUint16(i * 2, value, true);
  }
  return payload;
}

/**
 * Decode MSP v1 response frames from a byte buffer.
 * Returns { command, payload, direction, bytesConsumed } or null if incomplete.
 */
export function decodeMspFrame(buffer) {
  if (buffer.length < 6) return null;

  // Find '$M' header
  let headerIndex = -1;
  for (let i = 0; i <= buffer.length - 6; i++) {
    if (buffer[i] === 0x24 && buffer[i + 1] === 0x4D) {
      headerIndex = i;
      break;
    }
  }
  if (headerIndex === -1) return null;

  const direction = buffer[headerIndex + 2];
  if (direction !== MSP.DIR_FROM_FC && direction !== MSP.DIR_ERROR) {
    // Skip this invalid header, try next byte
    return { command: 0, payload: new Uint8Array(0), direction: 0, bytesConsumed: headerIndex + 1, error: true };
  }

  const payloadLength = buffer[headerIndex + 3];
  const totalFrameLength = 6 + payloadLength;

  if (buffer.length < headerIndex + totalFrameLength) return null; // Incomplete

  const command = buffer[headerIndex + 4];
  const payload = buffer.slice(headerIndex + 5, headerIndex + 5 + payloadLength);

  // Verify checksum
  let checksum = payloadLength ^ command;
  for (let i = 0; i < payloadLength; i++) {
    checksum ^= payload[i];
  }
  const expectedChecksum = buffer[headerIndex + 5 + payloadLength];

  if ((checksum & 0xFF) !== expectedChecksum) {
    return { command: 0, payload: new Uint8Array(0), direction: 0, bytesConsumed: headerIndex + 1, error: true };
  }

  return {
    command,
    payload: new Uint8Array(payload),
    direction,
    bytesConsumed: headerIndex + totalFrameLength,
    error: direction === MSP.DIR_ERROR,
  };
}

/**
 * Parse MSP_MOTOR_CONFIG response payload.
 */
export function parseMotorConfig(payload) {
  if (payload.length < 6) return null;
  const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
  return {
    minThrottle: view.getUint16(0, true),
    maxThrottle: view.getUint16(2, true),
    minCommand: view.getUint16(4, true),
  };
}

/**
 * Parse MSP_API_VERSION response payload.
 */
export function parseApiVersion(payload) {
  if (payload.length < 3) return null;
  return {
    protocol: payload[0],
    major: payload[1],
    minor: payload[2],
  };
}

/**
 * Parse MSP_FC_VARIANT response payload.
 */
export function parseFcVariant(payload) {
  return String.fromCharCode(...payload);
}
