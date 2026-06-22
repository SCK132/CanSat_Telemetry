export interface TelemetryData {
  time: number;       // Timestamp (from CanSat)
  serverTime?: number;// Absolute Unix timestamp (from Ground Station)
  ackSeq?: number;    // Sequence number of the last acknowledged command
  altitude: number;   // Meters
  pressure: number;   // hPa
  temperature: number;// Celsius
  state: number;      // Flight phase state machine
  
  // GNSS
  latitude: number;
  longitude: number;
  satellites: number;

  // IMU (BNO055)
  orientationX: number; // Pitch
  orientationY: number; // Roll
  orientationZ: number; // Yaw
}
