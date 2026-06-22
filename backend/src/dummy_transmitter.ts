import dgram from 'dgram';
import { encodeEntryType, calculateCRC8 } from './wcpp_utils';
import { WCPP_CODES } from '@cansat/shared';

const client = dgram.createSocket('udp4');
const SERVER_PORT = 5000;
const SERVER_HOST = '127.0.0.1';

let time = 0;
let altitude = 1000; // Starting altitude 1000m
let pressure = 900;
let temperature = 25;
let state = WCPP_CODES.FLIGHT_STATE.STANDBY;
let ackSeq = 0;

// GNSS Mock
let latitude = 35.681236; // Tokyo
let longitude = 139.767125;
let satellites = 8;

// IMU Mock
let pitch = 0;
let roll = 0;
let yaw = 0;

function sendMockTelemetry() {
  const buf = Buffer.alloc(256);
  
  // Header (Local packet)
  buf[1] = 0x82; // Packet ID 2, top bit 1 (Telemetry)
  buf[2] = WCPP_CODES.UNIT.LOCAL; 
  buf[3] = WCPP_CODES.UNIT.CANSAT;

  let offset = 4;

  const addFloat32Entry = (name: string, value: number) => {
    const [b0, b1] = encodeEntryType(name, 0b000110); // float32
    buf[offset++] = b0;
    buf[offset++] = b1;
    buf.writeFloatLE(value, offset);
    offset += 4;
  };

  const addFloat64Entry = (name: string, value: number) => {
    const [b0, b1] = encodeEntryType(name, 0b000111); // float64
    buf[offset++] = b0;
    buf[offset++] = b1;
    buf.writeDoubleLE(value, offset);
    offset += 8;
  };

  const addSmallIntEntry = (name: string, value: number) => {
    const dataType = 0b100000 | (value & 0x1F);
    const [b0, b1] = encodeEntryType(name, dataType);
    buf[offset++] = b0;
    buf[offset++] = b1;
  };

  addFloat64Entry('TI', time);
  addFloat32Entry('AL', altitude);
  addFloat32Entry('PR', pressure);
  addFloat32Entry('TE', temperature);
  addSmallIntEntry('ST', state);
  addSmallIntEntry('AK', ackSeq);
  
  addFloat64Entry('LA', latitude);
  addFloat64Entry('LO', longitude);
  addSmallIntEntry('SA', satellites);
  
  addFloat32Entry('OX', pitch);
  addFloat32Entry('OY', roll);
  addFloat32Entry('OZ', yaw);

  // Finalize
  buf[0] = offset + 1;
  buf[offset] = calculateCRC8(buf, offset);
  const finalBuf = buf.subarray(0, offset + 1);

  client.send(finalBuf, SERVER_PORT, SERVER_HOST, (err) => {
    if (err) console.error('Mock send error:', err);
    else console.log(`Sent telemetry: Alt=${altitude.toFixed(1)}m, State=${state}, Pitch=${pitch.toFixed(1)}`);
  });

  // Update mock values
  time += 1;
  
  // Wiggle IMU
  pitch = Math.sin(time * 0.5) * 10;
  roll = Math.cos(time * 0.5) * 5;
  yaw = (yaw + 2) % 360;

  if (state === WCPP_CODES.FLIGHT_STATE.STANDBY && time > 5) {
    state = WCPP_CODES.FLIGHT_STATE.DESCENDING;
  }

  if (state === WCPP_CODES.FLIGHT_STATE.DESCENDING) {
    altitude -= 20;
    pressure += 2;
    // Fast spin
    roll += 20;
  }

  if (state === WCPP_CODES.FLIGHT_STATE.PARACHUTE_DEPLOYED) {
    altitude -= 5; // Slower descent
    pressure += 0.5;
    // Slower spin
    roll += 5;
  }

  if (altitude <= 0) {
    altitude = 0;
    state = WCPP_CODES.FLIGHT_STATE.LANDED;
    pitch = 0;
    roll = 0;
  }
}

console.log('Starting dummy transmitter...');
setInterval(sendMockTelemetry, 1000);

// Listen for incoming commands (uplink)
client.on('message', (msg) => {
  console.log(`\n[UPLINK] Received command from ground station! Length: ${msg.length} bytes`);
  console.log('[UPLINK] Raw Hex:', msg.toString('hex'));
  
  // Handle Directional Actions
  if (msg.length >= 6) {
    // Basic mock parser (Header 4 bytes + Entry Header 2 bytes)
    // Extract the action value (very simplified for mock!)
    const actionVal = msg[5] & 0x1F;
    
    // In a real scenario, the command packet would contain a seq_number.
    // For this mock, we just increment our ackSeq to show we received a command.
    ackSeq++;
    
    state = WCPP_CODES.FLIGHT_STATE.LANDED;
    
    switch (actionVal) {
      case WCPP_CODES.ACTION.DRIVE_FORWARD:
        console.log('=> Received DRIVE_FORWARD! Moving North...');
        latitude += 0.0001;
        break;
      case WCPP_CODES.ACTION.DRIVE_BACKWARD:
        console.log('=> Received DRIVE_BACKWARD! Moving South...');
        latitude -= 0.0001;
        break;
      case WCPP_CODES.ACTION.DRIVE_LEFT:
        console.log('=> Received DRIVE_LEFT! Moving West...');
        longitude -= 0.0001;
        break;
      case WCPP_CODES.ACTION.DRIVE_RIGHT:
        console.log('=> Received DRIVE_RIGHT! Moving East...');
        longitude += 0.0001;
        break;
      case WCPP_CODES.ACTION.DRIVE_STOP:
        console.log('=> Received DRIVE_STOP! Halting rover.');
        break;
      default:
        console.log(`=> Received unknown action: ${actionVal}`);
    }
  }
});
