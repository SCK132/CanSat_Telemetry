#include <WiFi.h>
#include <WiFiUdp.h>
#include "packet.h" // Requires linking to WCPP-master/cpp/packet.h

const char* ssid = "YOUR_WIFI_SSID";
const char* password = "YOUR_WIFI_PASSWORD";

// Ground Station IP and Port
const char* gs_ip = "192.168.1.100";
const int gs_port = 5000;
const int local_port = 5000;

WiFiUDP udp;
unsigned long lastTelemetryTime = 0;
unsigned long lastCommandTime = 0;
float fakeAltitude = 1000.0;
int state = 0; // 0 = Standby

void setup() {
  Serial.begin(115200);
  WiFi.begin(ssid, password);
  
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }
  Serial.println("\nWiFi connected!");
  
  udp.begin(local_port);
}

void loop() {
  unsigned long now = millis();

  // 1. Send Telemetry every 1 second
  if (now - lastTelemetryTime > 1000) {
    lastTelemetryTime = now;

    // Create a local telemetry packet: Packet ID=2, Component=MAIN(0)
    WCPP::Packet pkt = WCPP::Packet::local_telemetry(2, 0);

    // BNO055 & GNSS Mock Data
    pkt.add_float64("TI", now / 1000.0);
    pkt.add_float32("AL", fakeAltitude);
    pkt.add_float32("PR", 900.0);
    pkt.add_float32("TE", 25.5);
    pkt.add_uint8("ST", state);

    pkt.add_float64("LA", 35.681236);
    pkt.add_float64("LO", 139.767125);
    pkt.add_uint8("SA", 8);

    pkt.add_float32("OX", sin(now / 1000.0) * 10);
    pkt.add_float32("OY", cos(now / 1000.0) * 5);
    pkt.add_float32("OZ", 0.0);

    // Get binary buffer
    const uint8_t* buffer = pkt.get_buf();
    size_t size = pkt.get_size();

    // Send UDP
    udp.beginPacket(gs_ip, gs_port);
    udp.write(buffer, size);
    udp.endPacket();

    Serial.println("Sent WCPP Telemetry.");
    fakeAltitude -= 5.0; // Mock descent
  }

  // 1.5 Watchdog Timer for Drive Control
  if (state == 3 && now - lastCommandTime > 2000) {
    Serial.println("Watchdog: Command timeout! Automatically stopping rover.");
    state = 0; // Revert to standby / stop
  }

  // 2. Receive Uplink Commands
  int packetSize = udp.parsePacket();
  if (packetSize) {
    uint8_t rxBuffer[256];
    int len = udp.read(rxBuffer, 256);
    if (len > 0) {
      Serial.println("Received Command from Ground Station!");
      
      // Basic manual verification of Command (Entry 'AC')
      // For this mock, we assume the action value is roughly around byte 5
      uint8_t actionVal = rxBuffer[5] & 0x1F;
      
      lastCommandTime = millis();
      state = 3; // Set to landed/driving mode

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
