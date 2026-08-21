#include <esp_now.h>
#include <WiFi.h>
#include <Wire.h>
#include <Adafruit_Sensor.h>
#include <Adafruit_BNO055.h>
#include <esp_wifi.h>
#include "packet.h" // Requires linking to WCPP/cpp/packet.h (copy packet.h, float16.h, float16.cpp, Packet.cpp, cppcrc.h to sketch directory)

#include <esp_arduino_version.h>
#if defined(ESP_ARDUINO_VERSION) && ESP_ARDUINO_VERSION >= ESP_ARDUINO_VERSION_VAL(3, 0, 0)
  #define ESP_NOW_RECV_CB_FIRST_ARG const esp_now_recv_info *recv_info
  #define ESP_NOW_SEND_CB_FIRST_ARG const wifi_tx_info_t *tx_info
#else
  #define ESP_NOW_RECV_CB_FIRST_ARG const uint8_t *mac_addr
  #define ESP_NOW_SEND_CB_FIRST_ARG const uint8_t *mac_addr
#endif

// I2C pins for BNO055
#define I2C_SDA 21
#define I2C_SCL 22
#define LED_PIN 2

Adafruit_BNO055 bno = Adafruit_BNO055(55, 0x28, &Wire);

// ESP-NOW Broadcast MAC Address (receives on any nearby ESP32 listening)
uint8_t broadcastAddress[] = {0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF};

unsigned long lastTelemetryTime = 0;
unsigned long lastCommandTime = 0;
float fakeAltitude = 1000.0;
int state = 0; // 0 = Standby

// Callback when data is sent
void OnDataSent(ESP_NOW_SEND_CB_FIRST_ARG, esp_now_send_status_t status) {
  // Serial.print("Send status: ");
  // Serial.println(status == ESP_NOW_SEND_SUCCESS ? "Success" : "Fail");
}

// Callback when command is received via ESP-NOW from Ground Station
void OnDataRecv(ESP_NOW_RECV_CB_FIRST_ARG, const uint8_t *incomingData, int len) {
  Serial.print("Received command from Ground Station. Length: ");
  Serial.println(len);

  if (len > 0) {
    // Decode WCPP packet
    wcpp::Packet pkt = wcpp::Packet::decode(incomingData);
    auto it = pkt.find("AC");
    if (it != pkt.end()) {
      uint8_t actionVal = (*it).getUInt();
      lastCommandTime = millis();
      state = 3; // Active / Landed driving state

      switch(actionVal) {
        case 2: Serial.println("Action: DRIVE_FORWARD (W)"); fakeAltitude -= 0.1; break;
        case 3: Serial.println("Action: DRIVE_BACKWARD (S)"); fakeAltitude += 0.1; break;
        case 4: Serial.println("Action: DRIVE_LEFT (A)"); break;
        case 5: Serial.println("Action: DRIVE_RIGHT (D)"); break;
        case 6: Serial.println("Action: DRIVE_STOP"); break;
        default: Serial.println("Unknown Action received.");
      }
    }
  }
}

void setup() {
  Serial.begin(115200);

  // Initialize I2C and BNO055 (Uses default OPERATION_MODE_NDOF: 9-axis fusion)
  Wire.begin(I2C_SDA, I2C_SCL);
  if (!bno.begin()) {
    Serial.println("Warning: BNO055 not detected. Check I2C wiring (SDA=21, SCL=22) or address (0x28).");
  } else {
    Serial.println("BNO055 sensor initialized successfully!");
    bno.setExtCrystalUse(true);
  }

  // Initialize Wi-Fi in Station Mode
  pinMode(LED_PIN, OUTPUT);
  digitalWrite(LED_PIN, LOW);

  // Initialize Wi-Fi in Station Mode
  WiFi.mode(WIFI_STA);

  // Lock Wi-Fi Channel to 1 for ESP-NOW consistency
  esp_wifi_set_promiscuous(true);
  esp_wifi_set_channel(1, WIFI_SECOND_CHAN_NONE);
  esp_wifi_set_promiscuous(false);

  // Initialize ESP-NOW
  if (esp_now_init() != ESP_OK) {
    Serial.println("Error initializing ESP-NOW");
    return;
  }

  // Register callback functions
  esp_now_register_send_cb(OnDataSent);
  esp_now_register_recv_cb(OnDataRecv);

  // Add Broadcast Peer
  esp_now_peer_info_t peerInfo = {};
  memcpy(peerInfo.peer_addr, broadcastAddress, 6);
  peerInfo.channel = 0;  
  peerInfo.encrypt = false;
  
  if (esp_now_add_peer(&peerInfo) != ESP_OK){
    Serial.println("Failed to add broadcast peer");
    return;
  }
  
  Serial.println("Transmitter Ready.");
}

void loop() {
  unsigned long now = millis();

  // 1. Send Telemetry every 100ms (10Hz) for real-time responsiveness
  if (now - lastTelemetryTime > 100) {
    lastTelemetryTime = now;

    // Read BNO055 Euler angles for charts
    sensors_event_t event;
    bno.getEvent(&event);
    float yaw = event.orientation.x;   // OZ
    float roll = event.orientation.y;  // OY
    float pitch = event.orientation.z; // OX

    // Read BNO055 orientation data as Quaternion (avoids gimbal lock in 3D)
    imu::Quaternion quat = bno.getQuat();
    float qw = quat.w();
    float qx = quat.x();
    float qy = quat.y();
    float qz = quat.z();

    // BNO055 returns exactly (1,0,0,0) or (0,0,0,0) when it fails to read or loses I2C momentarily.
    // We cache the last valid orientation to prevent the 3D model from randomly snapping to upright.
    static float last_qw = 1.0f;
    static float last_qx = 0.0f;
    static float last_qy = 0.0f;
    static float last_qz = 0.0f;
    static float last_pitch = 0.0f;
    static float last_roll = 0.0f;
    static float last_yaw = 0.0f;

    float norm_sq = qw*qw + qx*qx + qy*qy + qz*qz;
    if (norm_sq < 0.1f || (qw == 1.0f && qx == 0.0f && qy == 0.0f && qz == 0.0f)) {
      qw = last_qw; qx = last_qx; qy = last_qy; qz = last_qz;
      pitch = last_pitch; roll = last_roll; yaw = last_yaw;
    } else {
      last_qw = qw; last_qx = qx; last_qy = qy; last_qz = qz;
      last_pitch = pitch; last_roll = roll; last_yaw = yaw;
    }

    // Allocate buffer for WCPP serialization
    uint8_t txBuffer[255];
    memset(txBuffer, 0, 255);

    // Create empty local telemetry WCPP packet
    wcpp::Packet pkt = wcpp::Packet::empty(txBuffer, sizeof(txBuffer));
    pkt.telemetry(2, 0); // Packet ID=2, Component=MAIN(0)

    // Append standard telemetry fields
    pkt.append("TI").setFloat64(now / 1000.0);
    pkt.append("AL").setFloat32(fakeAltitude);
    pkt.append("PR").setFloat32(900.0);
    pkt.append("TE").setFloat32(25.5);
    pkt.append("ST").setInt(state);

    // Mock GNSS
    pkt.append("LA").setFloat64(35.681236);
    pkt.append("LO").setFloat64(139.767125);
    pkt.append("SA").setInt(8); // Satellite count

    // Append IMU Quaternion values
    pkt.append("QW").setFloat32(qw);
    pkt.append("QX").setFloat32(qx);
    pkt.append("QY").setFloat32(qy);
    pkt.append("QZ").setFloat32(qz);
    
    // Append IMU Euler values for graphs
    pkt.append("OX").setFloat32(pitch);
    pkt.append("OY").setFloat32(roll);
    pkt.append("OZ").setFloat32(yaw);

    // Finalize packet layout and sizes
    uint8_t size = pkt.size();
    uint8_t totalSize = size + 1; // Size including size byte + CRC
    txBuffer[0] = totalSize;     // Update first byte with total size
    
    // Calculate CRC over updated packet (excluding CRC byte location itself)
    uint8_t crc = wcpp::Packet::checksum(txBuffer, size);
    txBuffer[size] = crc;        // Append CRC to the end

    // Send packet via ESP-NOW
    esp_err_t result = esp_now_send(broadcastAddress, txBuffer, totalSize);
    
    if (result == ESP_OK) {
      digitalWrite(LED_PIN, HIGH);
      delay(50);
      digitalWrite(LED_PIN, LOW);

      Serial.print("Sent Telemetry packet via ESP-NOW. Size: ");
      Serial.print(totalSize);
      Serial.print(" bytes. QW=");
      Serial.print(qw);
      Serial.print(", QX=");
      Serial.print(qx);
      Serial.print(", QY=");
      Serial.print(qy);
      Serial.print(", QZ=");
      Serial.println(qz);
    } else {
      Serial.println("Error sending ESP-NOW packet");
    }

    fakeAltitude -= 5.0; // Mock descent
  }

  // 2. Watchdog: Automatically stop rover if command times out (2 seconds)
  if (state == 3 && now - lastCommandTime > 2000) {
    Serial.println("Watchdog: Command timeout! Automatically stopping rover.");
    state = 0; // Revert to standby / stop
  }
}
