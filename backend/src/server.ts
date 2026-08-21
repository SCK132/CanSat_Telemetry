import { SerialPort } from 'serialport';
import { WebSocketServer, WebSocket } from 'ws';
import { parseWcppPacket } from './wcpp_parser';
import { buildWcppPacket } from './wcpp_builder';
import { calculateCRC8 } from './wcpp_utils';
import { TelemetryLogger } from './logger';

const WS_PORT = 8080;
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

// Initialize WebSocket Server for Frontend communication
const wss = new WebSocketServer({ port: WS_PORT });

// Initialize Async Logger
const logger = new TelemetryLogger(`telemetry_${Date.now()}.csv`);

// Maintain list of connected clients
const clients: Set<WebSocket> = new Set();

// Active serial port instance
let activePort: SerialPort | null = null;
const configuredPortPath = process.env.SERIAL_PORT;
let portPath = configuredPortPath;
let receiverResetReason: number | undefined;

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
    console.log(`Serial Port ${portPath} opened successfully!`);
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
        }
        continue;
      }

      const telemetry = parseWcppPacket(packet);
      if (!telemetry) continue;

      telemetry.receiverResetReason = receiverResetReason;
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
    console.error('Serial port error:', err.message);
  });

  port.on('close', () => {
    console.warn('Serial port closed. Reconnecting in 5 seconds...');
    portPath = configuredPortPath; // 明示指定があれば同じポートへ再接続
    activePort = null;
    setTimeout(initSerial, 5000);
  });

  activePort = port;
}

// Start Serial Port Connection
initSerial();

wss.on('connection', (ws) => {
  console.log('Frontend connected via WebSocket');
  clients.add(ws);

  ws.on('message', (message) => {
    try {
      console.log('Received command from frontend:', message.toString());
      const commandJson = JSON.parse(message.toString());

      // Build WCPP binary from JSON command
      const buffer = buildWcppPacket(commandJson);

      if (activePort && activePort.isOpen) {
        activePort.write(buffer, (err) => {
          if (err) {
            console.error('Error writing command to Serial:', err.message);
          } else {
            console.log('Uplink command sent via Serial.');
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
    console.log('Frontend disconnected');
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
  process.exit(0);
});
