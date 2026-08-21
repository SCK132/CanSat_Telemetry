export interface TelemetryData {
  time: number;       // Timestamp (from CanSat)
  serverTime?: number;// Absolute Unix timestamp (from Ground Station)
  ackSeq?: number;    // Sequence number of the last acknowledged command
  altitude: number;   // Meters
  pressure: number;   // hPa
  temperature: number;// Celsius
  state: number;         // Mission state 0-7
  subState: number;      // Running sub-state 5a-5c
  operationMode: number; // Unselected / development / mission
  resetReason: number;          // CanSat ESP32 reset reason
  batteryVoltage?: number;      // LiPo voltage measured by CanSat
  failsafeReason?: number;       // Reason for state 7
  receiverResetReason?: number; // Ground receiver ESP32 reset reason
  goalConfigured?: boolean;
  goalLatitude?: number;
  goalLongitude?: number;
  goalDistance?: number;
  motorState?: number;
  separationStatus?: number;

  // GNSS
  latitude: number;
  longitude: number;
  satellites: number;


  // QMI8658 acceleration [m/s^2] and angular rate [dps]
  accelX: number;
  accelY: number;
  accelZ: number;
  gyroX: number;
  gyroY: number;
  gyroZ: number;

  // MMC5603 magnetic field [uT] and heading [deg]
  magX: number;
  magY: number;
  magZ: number;
  heading: number;

  // Sensor validity
  imuValid: boolean;
  magValid: boolean;
  baroValid: boolean;
  gnssValid: boolean;
  gnssFix: boolean;
  // Legacy orientation fields (kept for the existing 3D UI)
  quatW: number;
  quatX: number;
  quatY: number;
  quatZ: number;

  // IMU - Euler angles (for graphing)
  orientationX: number;
  orientationY: number;
  orientationZ: number;
}
