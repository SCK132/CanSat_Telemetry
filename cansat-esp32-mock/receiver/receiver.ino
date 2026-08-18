#include <esp_now.h>
#include <WiFi.h>
#include <esp_wifi.h>
#include <esp_arduino_version.h>

constexpr uint8_t WIFI_CHANNEL = 1;
constexpr size_t MAX_ESPNOW_PAYLOAD = 250;
constexpr uint8_t LED_PIN = 2;
constexpr unsigned long SERIAL_TIMEOUT_MS = 100;
uint8_t broadcastAddress[] = {0xFF,0xFF,0xFF,0xFF,0xFF,0xFF};

struct RadioFrame { uint8_t length; uint8_t data[MAX_ESPNOW_PAYLOAD]; };
QueueHandle_t rxQueue = nullptr;
uint8_t serialRxBuf[MAX_ESPNOW_PAYLOAD];
uint8_t serialRxLen = 0;
unsigned long lastSerialRxTime = 0;
unsigned long lastLedOnTime = 0;
bool ledOn = false;

uint8_t crc8(const uint8_t *data, size_t length) {
  uint8_t crc = 0;
  for (size_t i=0;i<length;++i) {
    crc ^= data[i];
    for (uint8_t bit=0;bit<8;++bit) crc = (crc & 0x80) ? (uint8_t)((crc<<1)^0x07) : (uint8_t)(crc<<1);
  }
  return crc;
}

bool validWcpp(const uint8_t *data, size_t length) {
  return data && length >= 5 && length <= MAX_ESPNOW_PAYLOAD &&
         data[0] == length && crc8(data, length-1) == data[length-1];
}

#if defined(ESP_ARDUINO_VERSION) && ESP_ARDUINO_VERSION >= ESP_ARDUINO_VERSION_VAL(3,0,0)
void onDataRecv(const esp_now_recv_info_t *, const uint8_t *data, int len)
#else
void onDataRecv(const uint8_t *, const uint8_t *data, int len)
#endif
{
  if (!rxQueue || !validWcpp(data, (size_t)len)) return;
  RadioFrame frame = {};
  frame.length = (uint8_t)len;
  memcpy(frame.data, data, len);
  xQueueSend(rxQueue, &frame, 0);
}

void setup() {
  Serial.begin(115200);
  pinMode(LED_PIN, OUTPUT);
  digitalWrite(LED_PIN, LOW);
  rxQueue = xQueueCreate(4, sizeof(RadioFrame));
  WiFi.mode(WIFI_STA);
  esp_wifi_set_promiscuous(true);
  const esp_err_t channelResult = esp_wifi_set_channel(WIFI_CHANNEL, WIFI_SECOND_CHAN_NONE);
  esp_wifi_set_promiscuous(false);
  if (!rxQueue || channelResult != ESP_OK || esp_now_init() != ESP_OK) { digitalWrite(LED_PIN,HIGH); return; }
  esp_now_register_recv_cb(onDataRecv);
  esp_now_peer_info_t peer = {};
  memcpy(peer.peer_addr,broadcastAddress,6);
  peer.channel = WIFI_CHANNEL;
  peer.encrypt = false;
  if (esp_now_add_peer(&peer) != ESP_OK && !esp_now_is_peer_exist(broadcastAddress)) digitalWrite(LED_PIN,HIGH);
}

void loop() {
  const unsigned long now = millis();
  RadioFrame frame;
  while (rxQueue && xQueueReceive(rxQueue, &frame, 0) == pdTRUE) {
    Serial.write(frame.data, frame.length);
    digitalWrite(LED_PIN,HIGH);
    lastLedOnTime = now;
    ledOn = true;
  }
  if (ledOn && now-lastLedOnTime > 50) { digitalWrite(LED_PIN,LOW); ledOn=false; }
  if (serialRxLen && now-lastSerialRxTime > SERIAL_TIMEOUT_MS) serialRxLen=0;
  while (Serial.available()) {
    lastSerialRxTime=now;
    const uint8_t byteValue=(uint8_t)Serial.read();
    if (serialRxLen >= sizeof(serialRxBuf)) serialRxLen=0;
    serialRxBuf[serialRxLen++]=byteValue;
    const uint8_t expected=serialRxBuf[0];
    if (expected<5 || expected>MAX_ESPNOW_PAYLOAD) { serialRxLen=0; continue; }
    if (serialRxLen==expected) {
      if (validWcpp(serialRxBuf, expected)) esp_now_send(broadcastAddress,serialRxBuf,expected);
      serialRxLen=0;
    }
  }
}