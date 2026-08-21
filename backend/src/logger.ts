import fs from 'fs';
import path from 'path';
import { TelemetryData } from '@cansat/shared';
import { InfluxDB, Point, WriteApi } from '@influxdata/influxdb-client';

const TELEMETRY_COLUMNS: (keyof TelemetryData)[] = [
  'serverTime','time','state','subState','operationMode','resetReason','receiverResetReason','receiverLatitude','receiverLongitude','receiverSatellites','receiverGnssValid','receiverGnssFix','receiverGnssAge','batteryVoltage','failsafeReason',
  'latitude','longitude','satellites','gnssValid','gnssFix','goalConfigured','goalLatitude','goalLongitude','goalDistance','motorState','separationStatus',
  'altitude','pressure','temperature','accelX','accelY','accelZ','gyroX','gyroY','gyroZ','magX','magY','magZ','heading',
  'imuValid','magValid','baroValid','quatW','quatX','quatY','quatZ','orientationX','orientationY','orientationZ','ackSeq',
];

function csv(value: unknown): string {
  if (value === undefined || value === null) return '';
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export class TelemetryLogger {
  private readonly filePath: string;
  private readonly eventPath: string;
  private readonly stream: fs.WriteStream;
  private readonly eventStream: fs.WriteStream;
  private writeApi: WriteApi | null = null;

  constructor(filename: string) {
    const logsDir = path.join(process.cwd(), 'logs');
    fs.mkdirSync(logsDir, { recursive: true });
    this.filePath = path.join(logsDir, filename);
    this.eventPath = path.join(logsDir, filename.replace(/^telemetry_/, 'events_'));
    const telemetryEmpty = !fs.existsSync(this.filePath) || fs.statSync(this.filePath).size === 0;
    const eventEmpty = !fs.existsSync(this.eventPath) || fs.statSync(this.eventPath).size === 0;
    this.stream = fs.createWriteStream(this.filePath, { flags: 'a' });
    this.eventStream = fs.createWriteStream(this.eventPath, { flags: 'a' });
    if (telemetryEmpty) this.stream.write(`${TELEMETRY_COLUMNS.join(',')}\n`);
    if (eventEmpty) this.eventStream.write('serverTime,category,message,details\n');

    const { INFLUX_URL: url, INFLUX_TOKEN: token, INFLUX_ORG: org, INFLUX_BUCKET: bucket } = process.env;
    if (url && token && org && bucket) {
      this.writeApi = new InfluxDB({ url, token }).getWriteApi(org, bucket, 'ns');
      console.log(`[Logger] InfluxDB enabled for ${url} (${bucket})`);
    } else console.log('[Logger] InfluxDB disabled (Missing ENV variables). Logging to CSV only.');
  }

  public log(data: TelemetryData) {
    this.stream.write(`${TELEMETRY_COLUMNS.map((column) => csv(data[column])).join(',')}\n`);
    if (this.writeApi) {
      const point = new Point('telemetry').timestamp(data.serverTime ? new Date(data.serverTime) : new Date());
      for (const column of TELEMETRY_COLUMNS) {
        const value = data[column];
        if (typeof value === 'number' && Number.isFinite(value)) point.floatField(column, value);
        else if (typeof value === 'boolean') point.booleanField(column, value);
      }
      this.writeApi.writePoint(point);
    }
  }

  public event(category: string, message: string, details: unknown = '') {
    const serialized = typeof details === 'string' ? details : JSON.stringify(details);
    this.eventStream.write(`${Date.now()},${csv(category)},${csv(message)},${csv(serialized)}\n`);
  }

  public close() {
    this.stream.end(); this.eventStream.end();
    if (this.writeApi) void this.writeApi.close().catch((error) => console.error('InfluxDB close failed', error));
  }
}
