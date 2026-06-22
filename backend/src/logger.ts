import fs from 'fs';
import path from 'path';
import { TelemetryData } from '@cansat/shared';
import { InfluxDB, Point, WriteApi } from '@influxdata/influxdb-client';

export class TelemetryLogger {
  private filePath: string;
  private stream: fs.WriteStream;
  private isHeaderWritten = false;
  
  private writeApi: WriteApi | null = null;

  constructor(filename: string) {
    const logsDir = path.join(process.cwd(), 'logs');
    if (!fs.existsSync(logsDir)) {
      fs.mkdirSync(logsDir, { recursive: true });
    }

    this.filePath = path.join(logsDir, filename);
    this.stream = fs.createWriteStream(this.filePath, { flags: 'a' });
    
    // Initialize InfluxDB if Environment Variables exist
    const url = process.env.INFLUX_URL;
    const token = process.env.INFLUX_TOKEN;
    const org = process.env.INFLUX_ORG;
    const bucket = process.env.INFLUX_BUCKET;

    if (url && token && org && bucket) {
      const influxDB = new InfluxDB({ url, token });
      this.writeApi = influxDB.getWriteApi(org, bucket, 'ns'); // ns precision
      console.log(`[Logger] InfluxDB WriteApi initialized for ${url} (Bucket: ${bucket})`);
    } else {
      console.log(`[Logger] InfluxDB disabled (Missing ENV variables). Logging to CSV only.`);
    }
  }

  public log(data: TelemetryData) {
    if (!this.isHeaderWritten) {
      const headers = Object.keys(data).join(',');
      this.stream.write(`${headers}\n`);
      this.isHeaderWritten = true;
    }

    const values = Object.values(data).join(',');
    this.stream.write(`${values}\n`);
    
    // Write to InfluxDB
    if (this.writeApi) {
      const point = new Point('telemetry')
        .timestamp(data.serverTime ? new Date(data.serverTime) : new Date())
        .floatField('altitude', data.altitude)
        .floatField('pressure', data.pressure)
        .floatField('temperature', data.temperature)
        .intField('state', data.state)
        .floatField('latitude', data.latitude)
        .floatField('longitude', data.longitude)
        .intField('satellites', data.satellites)
        .floatField('pitch', data.orientationX)
        .floatField('roll', data.orientationY)
        .floatField('yaw', data.orientationZ)
        .intField('ackSeq', data.ackSeq || 0);
        
      this.writeApi.writePoint(point);
    }
  }

  public close() {
    this.stream.end();
    if (this.writeApi) {
      this.writeApi.close().then(() => {
        console.log('InfluxDB writeApi closed.');
      }).catch(e => {
        console.error('Error closing InfluxDB writeApi', e);
      });
    }
  }
}
