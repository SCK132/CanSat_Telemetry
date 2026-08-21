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
      else if (name === 'SS') telemetry.subState = value;
      else if (name === 'MO') telemetry.operationMode = value;
      else if (name === 'RS') telemetry.resetReason = value;
      else if (name === 'BT') telemetry.batteryVoltage = value;
      else if (name === 'FR') telemetry.failsafeReason = value;
      else if (name === 'LA') telemetry.latitude = value;
      else if (name === 'LO') telemetry.longitude = value;
      else if (name === 'SA') telemetry.satellites = value;
      else if (name === 'QW') telemetry.quatW = value;
      else if (name === 'QX') telemetry.quatX = value;
      else if (name === 'QY') telemetry.quatY = value;
      else if (name === 'QZ') telemetry.quatZ = value;
      else if (name === 'OX') telemetry.orientationX = value;
      else if (name === 'OY') telemetry.orientationY = value;
      else if (name === 'OZ') telemetry.orientationZ = value;
      else if (name === 'AK') telemetry.ackSeq = value;
      else if (name === 'AX') telemetry.accelX = value;
      else if (name === 'AY') telemetry.accelY = value;
      else if (name === 'AZ') telemetry.accelZ = value;
      else if (name === 'GX') telemetry.gyroX = value;
      else if (name === 'GY') telemetry.gyroY = value;
      else if (name === 'GZ') telemetry.gyroZ = value;
      else if (name === 'MX') telemetry.magX = value;
      else if (name === 'MY') telemetry.magY = value;
      else if (name === 'MZ') telemetry.magZ = value;
      else if (name === 'HD') telemetry.heading = value;
      else if (name === 'IV') telemetry.imuValid = Boolean(value);
      else if (name === 'MV') telemetry.magValid = Boolean(value);
      else if (name === 'BV') telemetry.baroValid = Boolean(value);
      else if (name === 'NV') telemetry.gnssValid = Boolean(value);
      else if (name === 'FX') telemetry.gnssFix = Boolean(value);
    }

    // Default missing fields for safety
    return {
      time: telemetry.time ?? 0,
      altitude: telemetry.altitude ?? 0,
      pressure: telemetry.pressure ?? 0,
      temperature: telemetry.temperature ?? 0,
      state: telemetry.state ?? 0,
      subState: telemetry.subState ?? 0,
      operationMode: telemetry.operationMode ?? 0,
      resetReason: telemetry.resetReason ?? 0,
      batteryVoltage: telemetry.batteryVoltage,
      failsafeReason: telemetry.failsafeReason,
      latitude: telemetry.latitude ?? 0,
      longitude: telemetry.longitude ?? 0,
      satellites: telemetry.satellites ?? 0,
      quatW: telemetry.quatW ?? 1,
      quatX: telemetry.quatX ?? 0,
      quatY: telemetry.quatY ?? 0,
      quatZ: telemetry.quatZ ?? 0,
      orientationX: telemetry.orientationX ?? 0,
      orientationY: telemetry.orientationY ?? 0,
      orientationZ: telemetry.orientationZ ?? 0,
      ackSeq: telemetry.ackSeq,
      accelX: telemetry.accelX ?? 0,
      accelY: telemetry.accelY ?? 0,
      accelZ: telemetry.accelZ ?? 0,
      gyroX: telemetry.gyroX ?? 0,
      gyroY: telemetry.gyroY ?? 0,
      gyroZ: telemetry.gyroZ ?? 0,
      magX: telemetry.magX ?? 0,
      magY: telemetry.magY ?? 0,
      magZ: telemetry.magZ ?? 0,
      heading: telemetry.heading ?? 0,
      imuValid: telemetry.imuValid ?? false,
      magValid: telemetry.magValid ?? false,
      baroValid: telemetry.baroValid ?? false,
      gnssValid: telemetry.gnssValid ?? false,
      gnssFix: telemetry.gnssFix ?? false
    };
  } catch (error) {
    console.error('Failed to parse WCPP packet:', error);
    return null;
  }
}
