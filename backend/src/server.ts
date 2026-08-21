import { SerialPort } from 'serialport';
import fs from 'fs';
import path from 'path';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { parseWcppPacket } from './wcpp_parser';
import { buildWcppPacket } from './wcpp_builder';
import { calculateCRC8, decodeEntryType } from './wcpp_utils';
import { TelemetryLogger } from './logger';

const WS_PORT = Number(process.env.WS_PORT ?? 8080);
const SERIAL_BAUD = 115200;
const RECEIVER_DIAGNOSTIC_COMPONENT_ID = 0x7F;
const RESET_REASON_LABELS = [
  'UNKNOWN', 'POWER ON', 'EXTERNAL RESET', 'SOFTWARE RESET', 'PANIC',
  'INTERRUPT WDT', 'TASK WDT', 'OTHER WDT', 'DEEP SLEEP', 'BROWNOUT',
  'SDIO', 'USB', 'JTAG', 'EFUSE', 'POWER GLITCH', 'CPU LOCKUP',
];

function parseReceiverResetReason(packet: Buffer): number | null {
  if (packet.length !== 7 ||
      packet[2] !== RECEIVER_DIAGNOSTIC_COMPONENT_ID ||
      (packet[1] & 0x80) === 0 ||
      (packet[4] & 0x1F) !== 18 ||
      (packet[5] & 0x1F) !== 18) {
    return null;
  }

  const dataType = ((packet[5] >> 5) << 3) | (packet[4] >> 5);
  return (dataType & 0x20) !== 0 ? dataType & 0x1F : null;
}


type ReceiverGnss = { latitude: number; longitude: number; satellites: number; valid: boolean; fix: boolean; receivedAt: number };
function parseReceiverGnss(packet: Buffer): ReceiverGnss | null {
  if (packet.length < 5 || packet[2] !== 0x7E || (packet[1] & 0x80) === 0 || packet[0] !== packet.length || calculateCRC8(packet, packet.length - 1) !== packet.at(-1)) return null;
  let offset = 4; const values: Record<string, number> = {};
  while (offset < packet.length - 1) {
    if (offset + 2 > packet.length - 1) return null;
    const { name, dataType } = decodeEntryType(packet[offset++], packet[offset++]);
    let value: number;
    if (dataType === 0b000111) { if (offset + 8 > packet.length - 1) return null; value = packet.readDoubleLE(offset); offset += 8; }
    else if ((dataType & 0b100000) !== 0) value = dataType & 0x1F;
    else if ((dataType & 0b110000) === 0b010000) { const bytes = (dataType & 7) + 1; if (offset + bytes > packet.length - 1) return null; value = 0; for (let i = 0; i < bytes; i++) value += packet[offset++] * 2 ** (8 * i); }
    else return null;
    values[name] = value;
  }
  return { latitude: values.RL ?? 0, longitude: values.RO ?? 0, satellites: values.RA ?? 0, valid: Boolean(values.RV), fix: Boolean(values.RF), receivedAt: Date.now() };
}
// Initialize WebSocket Server for Frontend communication
const logsDir = path.resolve(process.cwd(), 'logs');
function availableLogs() {
  if (!fs.existsSync(logsDir)) return [];
  return fs.readdirSync(logsDir).filter((name) => /^(telemetry|events)_\d+\.csv$/.test(name)).map((name) => {
    const stat = fs.statSync(path.join(logsDir, name));
    return { name, size: stat.size, modified: stat.mtimeMs, type: name.startsWith('telemetry_') ? 'telemetry' : 'events' };
  }).sort((a, b) => b.modified - a.modified);
}
const httpServer = createServer((request, response) => {
  const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);
  response.setHeader('Access-Control-Allow-Origin', '*');
  if (url.pathname === '/api/logs') { response.setHeader('Content-Type', 'application/json; charset=utf-8'); response.end(JSON.stringify(availableLogs())); return; }
  let name: string | undefined;
  if (url.pathname === '/api/logs/latest') name = availableLogs().find((item) => item.type === (url.searchParams.get('type') ?? 'telemetry'))?.name;
  else if (url.pathname.startsWith('/api/logs/')) name = decodeURIComponent(url.pathname.slice('/api/logs/'.length));
  if (name && /^(telemetry|events)_\d+\.csv$/.test(name) && path.basename(name) === name) {
    const file = path.join(logsDir, name); if (fs.existsSync(file)) { response.setHeader('Content-Type', 'text/csv; charset=utf-8'); response.setHeader('Content-Disposition', `attachment; filename="${name}"`); fs.createReadStream(file).pipe(response); return; }
  }
  response.statusCode = 404; response.end('Not found');
});
const wss = new WebSocketServer({ server: httpServer });
httpServer.listen(WS_PORT);

// Initialize Async Logger
const logger = new TelemetryLogger(`telemetry_${Date.now()}.csv`);
logger.event('SYSTEM', 'Ground station initialized');

// Maintain list of connected clients
const clients: Set<WebSocket> = new Set();

// Active serial port instance
let activePort: SerialPort | null = null;
const configuredPortPath = process.env.SERIAL_PORT;
let portPath = configuredPortPath;
let receiverResetReason: number | undefined;
let previousMissionState: number | undefined;
let telemetrySeen = false;
let receiverGnss: ReceiverGnss | undefined;
let previousReceiverFix = false;

async function initSerial() {
  if (!portPath) {
    console.log('No SERIAL_PORT env variable set. Attempting auto-detection...');
    try {
      const ports = await SerialPort.list();
      // Find a port that looks like a USB serial device
      const usbPort = ports.find(p =>
        p.path.includes('usb') ||
        p.path.includes('USB') ||
        p.path.includes('COM') ||
        (p.manufacturer && p.manufacturer.toLowerCase().includes('silicon')) ||
        (p.manufacturer && p.manufacturer.toLowerCase().includes('arduino')) ||
        (p.manufacturer && p.manufacturer.toLowerCase().includes('ch340')) ||
        (p.manufacturer && p.manufacturer.toLowerCase().includes('ftdi'))
      );
      if (usbPort) {
        portPath = usbPort.path;
        console.log(`Auto-detected USB Serial Port: ${portPath} (${(usbPort as any).friendlyName || usbPort.manufacturer})`);
      } else if (ports.length > 0) {
        portPath = ports[0].path;
        console.log(`No clear USB signature found. Defaulting to first available port: ${portPath}`);
      } else {
        console.error('No serial ports found! Please connect ESP32 or set SERIAL_PORT env.');
      }
    } catch (err) {
      console.error('Error listing serial ports:', err);
    }
  }

  if (!portPath) {
    console.log('Retrying serial port detection in 5 seconds...');
    setTimeout(initSerial, 5000);
    return;
  }

  console.log(`Opening Serial Port: ${portPath} at ${SERIAL_BAUD} baud...`);
  const port = new SerialPort({
    path: portPath,
    baudRate: SERIAL_BAUD,
    autoOpen: false
  });

  port.open((err) => {
    if (err) {
      console.error(`Failed to open serial port ${portPath}:`, err.message);
      console.log('Retrying serial port connection in 5 seconds...');
      portPath = configuredPortPath; // 明示指定があれば同じポートへ再接続
      setTimeout(initSerial, 5000);
      return;
    }
    console.log(`Serial Port ${portPath} opened successfully!`); logger.event(`NETWORK`, `Serial port opened`, { port: portPath, baud: SERIAL_BAUD });
  });

  let rxBuffer = Buffer.alloc(0);
  let discardedSerialBytes = 0;
  let receiverDiagnosticLogged = false;

  port.on('data', (data: Buffer) => {
    rxBuffer = Buffer.concat([rxBuffer, data]);

    while (rxBuffer.length > 0) {
      const packetSize = rxBuffer[0];

      // ESP-NOWのWCPP上限は250 byte。異常値は1 byteだけ捨てて境界を探し直す。
      if (packetSize < 5 || packetSize > 250) {
        rxBuffer = rxBuffer.subarray(1);
        discardedSerialBytes++;
        continue;
      }

      // 下りはtelemetryのみ。コマンドのエコーや文字列ログを先頭候補にしない。
      if (rxBuffer.length >= 2 && (rxBuffer[1] & 0x80) === 0) {
        rxBuffer = rxBuffer.subarray(1);
        discardedSerialBytes++;
        continue;
      }

      if (rxBuffer.length < packetSize) {
        break;
      }

      const packet = rxBuffer.subarray(0, packetSize);
      const expectedCrc = calculateCRC8(packet, packetSize - 1);
      if (packet[packetSize - 1] !== expectedCrc) {
        // 壊れたsize値を信用して全長を捨てると永久にずれるため、1 byteずつ再同期する。
        rxBuffer = rxBuffer.subarray(1);
        discardedSerialBytes++;
        continue;
      }

      rxBuffer = rxBuffer.subarray(packetSize);
      if (discardedSerialBytes > 0) {
        console.warn(`Serial stream resynchronized after discarding ${discardedSerialBytes} byte(s).`);
        discardedSerialBytes = 0;
      }

      const diagnosticReason = parseReceiverResetReason(packet);
      if (diagnosticReason !== null) {
        receiverResetReason = diagnosticReason;
        if (!receiverDiagnosticLogged) {
          const label = RESET_REASON_LABELS[diagnosticReason] ?? 'CODE ' + diagnosticReason;
          console.warn(`[Ground receiver] reset reason: ${label} (${diagnosticReason})`);
          receiverDiagnosticLogged = true;
          logger.event('SYSTEM', 'Ground receiver reset reason', { code: diagnosticReason, label });
        }
        continue;
      }

      const receiverPosition = parseReceiverGnss(packet);
      if (receiverPosition) {
        receiverGnss = receiverPosition;
        if (receiverPosition.fix !== previousReceiverFix) logger.event('GNSS', receiverPosition.fix ? 'Ground receiver GNSS fix acquired' : 'Ground receiver GNSS fix lost', { satellites: receiverPosition.satellites });
        previousReceiverFix = receiverPosition.fix;
        continue;
      }
      const telemetry = parseWcppPacket(packet);
      if (!telemetry) continue;

      telemetry.receiverResetReason = receiverResetReason;
      telemetry.receiverLatitude = receiverGnss?.latitude;
      telemetry.receiverLongitude = receiverGnss?.longitude;
      telemetry.receiverSatellites = receiverGnss?.satellites;
      telemetry.receiverGnssValid = receiverGnss?.valid;
      telemetry.receiverGnssFix = receiverGnss?.fix;
      telemetry.receiverGnssAge = receiverGnss ? (Date.now() - receiverGnss.receivedAt) / 1000 : undefined;
      if (!telemetrySeen) { telemetrySeen = true; logger.event('NETWORK', 'Telemetry link established'); }
      if (previousMissionState !== undefined && previousMissionState !== telemetry.state) logger.event('STATE', 'Mission state changed', { from: previousMissionState, to: telemetry.state });
      previousMissionState = telemetry.state;
      telemetry.serverTime = Date.now();
      logger.log(telemetry);

      const payload = JSON.stringify(telemetry);
      for (const client of clients) {
        if (client.readyState === WebSocket.OPEN) {
          client.send(payload);
        }
      }
    }
  });

  port.on('error', (err) => {
    console.error('Serial port error:', err.message); logger.event('ERROR', 'Serial port error', err.message);
  });

  port.on('close', () => {
    console.warn('Serial port closed. Reconnecting in 5 seconds...'); logger.event('NETWORK', 'Serial port closed');
    portPath = configuredPortPath; // 明示指定があれば同じポートへ再接続
    activePort = null;
    setTimeout(initSerial, 5000);
  });

  activePort = port;
}

// Start Serial Port Connection
initSerial();

wss.on('connection', (ws) => {
  console.log('Frontend connected via WebSocket'); logger.event('NETWORK', 'Frontend connected');
  clients.add(ws);

  ws.on('message', (message) => {
    try {
      console.log('Received command from frontend:', message.toString()); logger.event('COMMAND', 'Command received from frontend', message.toString());
      const commandJson = JSON.parse(message.toString());

      // Build WCPP binary from JSON command
      const buffer = buildWcppPacket(commandJson);

      if (activePort && activePort.isOpen) {
        activePort.write(buffer, (err) => {
          if (err) {
            console.error('Error writing command to Serial:', err.message); logger.event('ERROR', 'Command serial write failed', err.message);
          } else {
            console.log('Uplink command sent via Serial.'); logger.event('COMMAND', 'Uplink sent via serial', commandJson);
          }
        });
      } else {
        console.warn('Cannot send command: Serial port is not open.');
      }
    } catch (e) {
      console.error('Error handling uplink command', e);
    }
  });

  ws.on('close', () => {
    console.log('Frontend disconnected'); logger.event('NETWORK', 'Frontend disconnected');
    clients.delete(ws);
  });
});

console.log(`WebSocket Server listening on ws://localhost:${WS_PORT}`);

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('Shutting down...');
  logger.close();
  if (activePort && activePort.isOpen) {
    activePort.close();
  }
  wss.close();
  httpServer.close();
  process.exit(0);
});
