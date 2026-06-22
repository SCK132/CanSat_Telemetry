// WCPP CRC8 Implementation (CCITT)
// Polynomial: 0x07, Initial: 0x00, Final XOR: 0x00, Reflect: false

const crc8Table = new Uint8Array(256);
for (let i = 0; i < 256; i++) {
  let crc = i;
  for (let j = 0; j < 8; j++) {
    crc = (crc & 0x80) ? ((crc << 1) ^ 0x07) : (crc << 1);
  }
  crc8Table[i] = crc & 0xFF;
}

export function calculateCRC8(buffer: Buffer, length: number): number {
  let crc = 0x00;
  for (let i = 0; i < length; i++) {
    crc = crc8Table[crc ^ buffer[i]];
  }
  return crc;
}

/**
 * Extracts 2-character entry name and 6-bit data type from 2 bytes
 * Byte 0: (DataTypeLow3 << 5) | (Char1 & 0x1F)
 * Byte 1: (DataTypeUp3 << 5) | (Char2 & 0x1F)
 */
export function decodeEntryType(byte0: number, byte1: number) {
  const char1Val = byte0 & 0x1F;
  const char2Val = byte1 & 0x1F;
  
  const char1 = String.fromCharCode(char1Val + 64);
  const char2 = String.fromCharCode(char2Val + 64);
  const name = char1 + char2;

  const typeLow = (byte0 >> 5) & 0x07;
  const typeUp = (byte1 >> 5) & 0x07;
  const dataType = (typeUp << 3) | typeLow;

  return { name, dataType };
}

/**
 * Encodes 2-character entry name and 6-bit data type into 2 bytes
 */
export function encodeEntryType(name: string, dataType: number): [number, number] {
  const char1Val = (name.charCodeAt(0) - 64) & 0x1F;
  const char2Val = (name.charCodeAt(1) - 64) & 0x1F;
  
  const typeLow = dataType & 0x07;
  const typeUp = (dataType >> 3) & 0x07;
  
  const byte0 = (typeLow << 5) | char1Val;
  const byte1 = (typeUp << 5) | char2Val;
  
  return [byte0, byte1];
}
