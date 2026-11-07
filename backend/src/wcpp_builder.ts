import { encodeEntryType, calculateCRC8 } from './wcpp_utils';

export function buildWcppPacket(command: any): Buffer {
  // We allocate a buffer that's large enough, then slice it down.
  const buf = Buffer.alloc(256);
  
  // Header: Local Packet (4 bytes)
  buf[1] = 0x01; // Packet ID (e.g. 1) & 0x7F (command is top bit 0)
  buf[2] = command.component & 0xFF; // Destination Component
  buf[3] = 0x00; // Local Unit
  
  let offset = 4;

  // Add Action Entry ('AC')
  if (command.action !== undefined) {
    // Determine action numeric value (assuming from ACTION enum)
    // E.g., DEPLOY_PARACHUTE is 1. We can encode it as a small uint (1xxxxx)
    const actionVal = command.action;
    
    if (actionVal >= 0 && actionVal <= 31) {
      const dataType = 0b100000 | (actionVal & 0x1F);
      const [b0, b1] = encodeEntryType('AC', dataType);
      buf[offset++] = b0;
      buf[offset++] = b1;
    } else {
      // Fallback: 1-byte integer (01sxxx where s=0, xxx=0 for 1 byte)
      const dataType = 0b010000;
      const [b0, b1] = encodeEntryType('AC', dataType);
      buf[offset++] = b0;
      buf[offset++] = b1;
      buf.writeUInt8(actionVal, offset++);
    }
  }

  if (command.action === 6) {
    const lat = Number(command.goalLatitude);
    const lon = Number(command.goalLongitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) throw new Error(`Invalid goal coordinate`);
    for (const [name, value] of [[`GL`, lat], [`GO`, lon]] as const) {
      const [b0, b1] = encodeEntryType(name, 0b000111); buf[offset++] = b0; buf[offset++] = b1; buf.writeDoubleLE(value, offset); offset += 8;
    }
  }

  if (command.action === 15) {
    for (const [key, duty] of [['DL', command.left], ['DR', command.right]] as const) {
      if (!Number.isInteger(duty) || duty < -15 || duty > 15) throw new Error('Invalid RC wheel duty');
      const [b0, b1] = encodeEntryType(key, 0x20 | (duty + 15));
      buf[offset++] = b0;
      buf[offset++] = b1;
    }
  }

  // Finalize size and CRC
  buf[0] = offset + 1; // Size includes size byte itself and CRC byte
  const crc = calculateCRC8(buf, offset);
  buf[offset++] = crc;

  return buf.subarray(0, offset);
}
