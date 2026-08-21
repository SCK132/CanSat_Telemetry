import dgram from 'dgram';
import { encodeEntryType, calculateCRC8 } from './wcpp_utils';
import { WCPP_CODES } from '@cansat/shared';

const client = dgram.createSocket('udp4');
const SERVER_PORT = 5000;
const SERVER_HOST = '127.0.0.1';

let time = 0;
let stateElapsed = 0;
let altitude = 20;
let pressure = 1011;
let temperature = 24;
let state: number = WCPP_CODES.MISSION_STATE.BOOT;
let subState: number = WCPP_CODES.MISSION_SUB_STATE.NONE;
let operationMode: number = WCPP_CODES.OPERATION_MODE.UNSELECTED;
let ackSeq = 0;
let latitude = 35.681236;
let longitude = 139.767125;
const satellites = 12;
let pitch = 0;
let roll = 0;
let yaw = 0;

function transitionTo(next: number) {
  state = next;
  stateElapsed = 0;
  subState = next === WCPP_CODES.MISSION_STATE.RUNNING
    ? WCPP_CODES.MISSION_SUB_STATE.GPS_NAVIGATION
    : WCPP_CODES.MISSION_SUB_STATE.NONE;
}

function sendMockTelemetry() {
  const buf = Buffer.alloc(256);
  buf[1] = 0x82;
  buf[2] = WCPP_CODES.UNIT.LOCAL;
  buf[3] = WCPP_CODES.UNIT.CANSAT;
  let offset = 4;

  const addFloat32Entry = (name: string, value: number) => {
    const [b0, b1] = encodeEntryType(name, 0b000110);
    buf[offset++] = b0;
    buf[offset++] = b1;
    buf.writeFloatLE(value, offset);
    offset += 4;
  };
  const addFloat64Entry = (name: string, value: number) => {
    const [b0, b1] = encodeEntryType(name, 0b000111);
    buf[offset++] = b0;
    buf[offset++] = b1;
    buf.writeDoubleLE(value, offset);
    offset += 8;
  };
  const addSmallIntEntry = (name: string, value: number) => {
    const [b0, b1] = encodeEntryType(name, 0b100000 | (value & 0x1f));
    buf[offset++] = b0;
    buf[offset++] = b1;
  };

  addFloat64Entry('TI', time);
  addFloat32Entry('AL', altitude);
  addFloat32Entry('PR', pressure);
  addFloat32Entry('TE', temperature);
  addSmallIntEntry('ST', state);
  addSmallIntEntry('SS', subState);
  addSmallIntEntry('MO', operationMode);
  addSmallIntEntry('AK', ackSeq);
  addFloat64Entry('LA', latitude);
  addFloat64Entry('LO', longitude);
  addSmallIntEntry('SA', satellites);
  addFloat32Entry('OX', pitch);
  addFloat32Entry('OY', roll);
  addFloat32Entry('OZ', yaw);

  buf[0] = offset + 1;
  buf[offset] = calculateCRC8(buf, offset);
  client.send(buf.subarray(0, offset + 1), SERVER_PORT, SERVER_HOST);

  time += 1;
  stateElapsed += 1;
  pitch = Math.sin(time * 0.5) * 10;
  roll = Math.cos(time * 0.5) * 5;
  yaw = (yaw + 2) % 360;

  if (state === WCPP_CODES.MISSION_STATE.LAUNCH) {
    altitude += 15;
    if (stateElapsed >= 4) transitionTo(WCPP_CODES.MISSION_STATE.DEPLOYED);
  } else if (state === WCPP_CODES.MISSION_STATE.DEPLOYED) {
    altitude = Math.max(20, altitude - 8);
    if (altitude <= 20 && stateElapsed >= 8) {
      transitionTo(WCPP_CODES.MISSION_STATE.LANDED);
    }
  } else if (state === WCPP_CODES.MISSION_STATE.LANDED && stateElapsed >= 3) {
    transitionTo(WCPP_CODES.MISSION_STATE.RUNNING);
  } else if (state === WCPP_CODES.MISSION_STATE.RUNNING) {
    latitude += 0.000001;
    longitude += 0.000001;
  }
}

console.log('Starting mission dummy transmitter...');
setInterval(sendMockTelemetry, 1000);

client.on('message', (msg) => {
  if (msg.length < 6) return;
  const action = msg[5] & 0x1f;
  ackSeq++;

  if (action === WCPP_CODES.ACTION.SELECT_DEVELOPMENT_MODE &&
      state === WCPP_CODES.MISSION_STATE.BOOT) {
    operationMode = WCPP_CODES.OPERATION_MODE.DEVELOPMENT;
    console.log('=> DEVELOPMENT mode selected');
  } else if (action === WCPP_CODES.ACTION.SELECT_MISSION_MODE &&
             state === WCPP_CODES.MISSION_STATE.BOOT) {
    operationMode = WCPP_CODES.OPERATION_MODE.MISSION;
    transitionTo(WCPP_CODES.MISSION_STATE.LAUNCH_STANDBY);
    console.log('=> MISSION mode selected');
  } else if (action === WCPP_CODES.ACTION.START_LAUNCH &&
             operationMode === WCPP_CODES.OPERATION_MODE.MISSION &&
             state === WCPP_CODES.MISSION_STATE.LAUNCH_STANDBY) {
    transitionTo(WCPP_CODES.MISSION_STATE.LAUNCH);
    console.log('=> LAUNCH accepted');
  } else {
    console.log(`=> Rejected action ${action} in state ${state}`);
  }
});