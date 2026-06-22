import { TelemetryData } from '@cansat/shared';
import { calculateCRC8, decodeEntryType } from './wcpp_utils';

export function parseWcppPacket(buffer: Buffer): TelemetryData | null {
  try {
    if (buffer.length < 5) return null; // Min length for local header + crc

    const packetSize = buffer[0];
    if (packetSize !== buffer.length) {
      console.warn(`Size mismatch: expected ${packetSize}, got ${buffer.length}`);
      return null;
    }

    const crcValue = buffer[buffer.length - 1];
    const calculatedCrc = calculateCRC8(buffer, buffer.length - 1);
    
    if (crcValue !== calculatedCrc) {
      console.warn(`CRC Error! Expected 0x${calculatedCrc.toString(16)}, got 0x${crcValue.toString(16)}`);
      return null;
    }

    // Parse header (assume Local Packet: 4 bytes header)
    // 0: size, 1: packetId (bit 7 is telem/cmd), 2: compId, 3: origin
    const headerSize = 4;
    
    let offset = headerSize;
    const telemetry: Partial<TelemetryData> = {};

    while (offset < buffer.length - 1) {
      if (offset + 1 >= buffer.length - 1) break;
      
      const byte0 = buffer[offset++];
      const byte1 = buffer[offset++];
      const { name, dataType } = decodeEntryType(byte0, byte1);

      let value: any = null;

      // Float types
      if (dataType === 0b000100) { value = 0.0; }
      else if (dataType === 0b000110) { // float32
        value = buffer.readFloatLE(offset);
        offset += 4;
      }
      else if (dataType === 0b000111) { // float64
        value = buffer.readDoubleLE(offset);
        offset += 8;
      }
      // Fixed small uint (1xxxxx)
      else if ((dataType & 0b100000) === 0b100000) {
        value = dataType & 0x1F;
      }
      // Variable Int (01sxxx)
      else if ((dataType & 0b110000) === 0b010000) {
        const sign = (dataType >> 3) & 1;
        const numBytes = (dataType & 0x07) + 1;
        
        let rawInt = 0n;
        for (let i = 0; i < numBytes; i++) {
          rawInt |= BigInt(buffer[offset++]) << BigInt(8 * i);
        }
        
        value = Number(rawInt);
        if (sign === 1) {
          // Negative handle (simplified for boilerplate)
          value = -value; 
        }
      }

      // Map to TelemetryData
      if (name === 'TI') telemetry.time = value;
      else if (name === 'AL') telemetry.altitude = value;
      else if (name === 'PR') telemetry.pressure = value;
      else if (name === 'TE') telemetry.temperature = value;
      else if (name === 'ST') telemetry.state = value;
      else if (name === 'LA') telemetry.latitude = value;
      else if (name === 'LO') telemetry.longitude = value;
      else if (name === 'SA') telemetry.satellites = value;
      else if (name === 'OX') telemetry.orientationX = value;
      else if (name === 'OY') telemetry.orientationY = value;
      else if (name === 'OZ') telemetry.orientationZ = value;
      else if (name === 'AK') telemetry.ackSeq = value;
    }

    // Default missing fields for safety
    return {
      time: telemetry.time ?? 0,
      altitude: telemetry.altitude ?? 0,
      pressure: telemetry.pressure ?? 0,
      temperature: telemetry.temperature ?? 0,
      state: telemetry.state ?? 0,
      latitude: telemetry.latitude ?? 0,
      longitude: telemetry.longitude ?? 0,
      satellites: telemetry.satellites ?? 0,
      orientationX: telemetry.orientationX ?? 0,
      orientationY: telemetry.orientationY ?? 0,
      orientationZ: telemetry.orientationZ ?? 0,
      ackSeq: telemetry.ackSeq ?? 0
    };
  } catch (error) {
    console.error('Failed to parse WCPP packet:', error);
    return null;
  }
}
