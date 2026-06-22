import dgram from 'dgram';
import { WebSocketServer, WebSocket } from 'ws';
import { parseWcppPacket } from './wcpp_parser';
import { buildWcppPacket } from './wcpp_builder';
import { TelemetryLogger } from './logger';

const UDP_PORT = 5000;
const WS_PORT = 8080;

// Initialize UDP Socket for CanSat communication
const udpServer = dgram.createSocket('udp4');

// Initialize WebSocket Server for Frontend communication
const wss = new WebSocketServer({ port: WS_PORT });

// Initialize Async Logger
const logger = new TelemetryLogger(`telemetry_${Date.now()}.csv`);

// Maintain list of connected clients
const clients: Set<WebSocket> = new Set();

wss.on('connection', (ws) => {
  console.log('Frontend connected via WebSocket');
  clients.add(ws);

  ws.on('message', (message) => {
    try {
      console.log('Received command from frontend:', message.toString());
      const commandJson = JSON.parse(message.toString());
      
      // Build WCPP binary from JSON command
      const buffer = buildWcppPacket(commandJson);
      
      // Assuming CanSat IP is known or using broadcast. For now, we mock sending.
      // udpServer.send(buffer, UDP_PORT, '192.168.4.1');
      console.log('Uplink command sent to CanSat.');
    } catch (e) {
      console.error('Error handling uplink command', e);
    }
  });

  ws.on('close', () => {
    console.log('Frontend disconnected');
    clients.delete(ws);
  });
});

udpServer.on('message', (msg, rinfo) => {
  // console.log(`Received UDP packet from ${rinfo.address}:${rinfo.port}`);
  
  // Parse WCPP binary into JSON
  const telemetry = parseWcppPacket(msg);
  
  if (telemetry) {
    // 1. Time Synchronization: Append absolute server time
    telemetry.serverTime = Date.now();

    // Log to CSV asynchronously
    logger.log(telemetry);
    
    // Broadcast to all connected frontends
    const payload = JSON.stringify(telemetry);
    for (const client of clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(payload);
      }
    }
  }
});

udpServer.on('listening', () => {
  const address = udpServer.address();
  console.log(`UDP Server listening on ${address.address}:${address.port}`);
});

udpServer.bind(UDP_PORT);
console.log(`WebSocket Server listening on ws://localhost:${WS_PORT}`);

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('Shutting down...');
  logger.close();
  udpServer.close();
  wss.close();
  process.exit(0);
});
