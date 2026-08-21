/*
 * LoRaE220-920 - GPS TRANSMITTER (forklift tracker, node 1)
 *
 * Reads GT-U7 GPS (NMEA over UART), packs into the GpsPacket wire format
 * that main_module_sim7080g/ring_buffer.h expects, and sends it over LoRa.
 *
 * PREREQUISITE: this board's LoRa module must already be configured via
 * LoRa_Configurator.ino (ROLE_TX) with the DIP switch flipped back to
 * MODE 0 (M0:OFF, M1:OFF) afterward. This sketch does NOT call
 * InitLoRaSetting() and will NOT work if the module was never configured.
 *
 * DIP switch must stay at MODE 0 for this sketch to function.
 */

#include <M5Unified.h>
#include "M5_LoRa_E220_JP.h"
#include <Arduino.h>

// ─── LoRa module UART ──────────────────────────────────────────────
#define UART_TX_GPIO (17)
#define UART_RX_GPIO (16)

#define GPS_RX_GPIO (21)
#define GPS_TX_GPIO (22)
#define GPS_BAUD      9600 // standard GT-U7 default — change if yours was reconfigured
#if GPS_RX_GPIO < 0 || GPS_TX_GPIO < 0
#error "Set GPS_RX_GPIO / GPS_TX_GPIO to your GT-U7's actual wiring before compiling."
#endif

#define NODE_ID 1   // this forklift's node_id

LoRa_E220_JP lora;
struct LoRaConfigItem_t config;

HardwareSerial GpsSerial(1);   // ESP32 UART1, dedicated to the GT-U7

// ─── GpsPacket wire format — MUST match main_module_sim7080g/ring_buffer.h ──
// Any field change here must be mirrored there, and vice versa.
#define GPS_PACKET_MAGIC 0xA5

typedef struct
{
  uint8_t  magic;
  uint32_t node_id;
  uint32_t seq;
  float latitude;
  float longitude;
  float altitude_m;
  float speed_kmph;
  float heading_deg;
  float hdop;
  uint8_t satellites;
  uint8_t flags;
  uint8_t crc8;   // CRC8 over bytes [magic..flags] — must stay the last field
} __attribute__((packed)) GpsPacket;

// Same CRC8 as ciren_frame.h on the gateway side (poly 0x07, init 0x00) —
// duplicated here rather than #included, since this sketch has no
// dependency on the main_module_sim7080g project's other headers.
static uint8_t ciren_crc8(const uint8_t* data, uint8_t len) {
  uint8_t crc = 0x00;
  for (uint8_t i = 0; i < len; i++) {
    crc ^= data[i];
    for (uint8_t b = 0; b < 8; b++)
      crc = (crc & 0x80) ? (crc << 1) ^ 0x07 : (crc << 1);
  }
  return crc;
}

// ─── Minimal NMEA parsing (GGA + RMC) — no external GPS library needed ──
struct GpsFix {
  bool    valid       = false;
  double  lat         = 0;
  double  lon         = 0;
  float   altitude_m  = 0;
  float   hdop        = 0;
  uint8_t satellites  = 0;
  float   speed_kmph  = 0;
  float   heading_deg = 0;
};
static GpsFix gpsFix;

static char    nmeaLine[128];
static uint8_t nmeaPos = 0;

// NMEA ddmm.mmmm (+ hemisphere) -> decimal degrees
static double nmeaToDecimalDegrees(const char* field, char hemisphere) {
  if (!field || field[0] == '\0') return 0.0;
  double raw = atof(field);
  int    deg = (int)(raw / 100);
  double min = raw - (deg * 100);
  double dec = deg + (min / 60.0);
  if (hemisphere == 'S' || hemisphere == 'W') dec = -dec;
  return dec;
}

// Split a comma-delimited NMEA sentence in place; '*' also ends the last field.
static int splitFields(char* line, char* fields[], int maxFields) {
  int count = 0;
  char* p = line;
  fields[count++] = p;
  while (*p && count < maxFields) {
    if (*p == ',' || *p == '*') {
      *p = '\0';
      fields[count++] = p + 1;
    }
    p++;
  }
  return count;
}

// $GxGGA,time,lat,N/S,lon,E/W,fixQuality,numSat,hdop,altitude,M,...
static void parseGGA(char* line) {
  char* f[16];
  int n = splitFields(line, f, 16);
  if (n < 10) return;
  int fixQuality = atoi(f[6]);
  gpsFix.valid = (fixQuality > 0);
  if (!gpsFix.valid) return;
  gpsFix.lat        = nmeaToDecimalDegrees(f[2], f[3][0]);
  gpsFix.lon        = nmeaToDecimalDegrees(f[4], f[5][0]);
  gpsFix.satellites = (uint8_t)atoi(f[7]);
  gpsFix.hdop       = atof(f[8]);
  gpsFix.altitude_m = atof(f[9]);
}

// $GxRMC,time,status(A/V),lat,N/S,lon,E/W,speedKnots,course,date,...
static void parseRMC(char* line) {
  char* f[16];
  int n = splitFields(line, f, 16);
  if (n < 9) return;
  if (f[2][0] != 'A') return;   // 'V' = void/no fix — leave last-known speed/heading
  gpsFix.speed_kmph  = atof(f[7]) * 1.852f;   // knots -> km/h
  gpsFix.heading_deg = atof(f[8]);
}

// Drain whatever's currently buffered on the GPS UART — call every loop()
// so the RX buffer never backs up and we always see the freshest fix.
static void gpsPollNMEA() {
  while (GpsSerial.available()) {
    char c = (char)GpsSerial.read();
    if (c == '\n') {
      nmeaLine[nmeaPos] = '\0';
      if (nmeaPos > 6 && nmeaLine[0] == '$') {
        if (strncmp(nmeaLine + 3, "GGA", 3) == 0)      parseGGA(nmeaLine);
        else if (strncmp(nmeaLine + 3, "RMC", 3) == 0) parseRMC(nmeaLine);
      }
      nmeaPos = 0;
    } else if (c != '\r') {
      if (nmeaPos < sizeof(nmeaLine) - 1) nmeaLine[nmeaPos++] = c;
      else nmeaPos = 0;   // overflow guard — discard the malformed line
    }
  }
}

static uint32_t seqCounter  = 0;
static uint32_t lastSendMs  = 0;
static const uint32_t SEND_INTERVAL_MS = 3000;

void setup() {
  M5.begin();
  Serial.begin(115200);
  delay(500);

  GpsSerial.begin(GPS_BAUD, SERIAL_8N1, GPS_RX_GPIO, GPS_TX_GPIO);

  lora.Init(&Serial2, CONFIG_MODE_BAUD, SERIAL_8N1, UART_RX_GPIO, UART_TX_GPIO);
  lora.SetDefaultConfigValue(config);

  config.own_address              = 0x0001;
  config.baud_rate                = BAUD_9600;
  config.air_data_rate            = BW125K_SF9;
  config.subpacket_size           = SUBPACKET_200_BYTE;
  config.rssi_ambient_noise_flag  = RSSI_AMBIENT_NOISE_ENABLE;
  config.transmitting_power       = TX_POWER_13dBm;
  config.own_channel               = 0x00;
  config.rssi_byte_flag            = RSSI_BYTE_ENABLE;
  config.transmission_method_type = UART_P2P_MODE;
  config.lbt_flag                  = LBT_DISABLE;
  config.wor_cycle                 = WOR_2000MS;
  config.encryption_key           = 0x1234;
  config.target_address           = 0x0002;
  config.target_channel           = 0x00;

  // IMPORTANT: still call this every boot - it also creates the library's
  // internal FreeRTOS queue/task state that SendFrame() depends on.
  // Skipping it entirely causes a queue-NULL crash. But we do NOT block
  // forever if it fails: if DIP is at Normal Mode (0,0), the AT-command
  // write to the module will fail (expected), yet the module already has
  // correct settings saved from the one-time configurator flash, so we
  // just log the result and continue instead of looping forever.
  int result = lora.InitLoRaSetting(config);
  if (result == 0) {
    Serial.println("Config write OK (DIP was at Config Mode).");
  } else {
    Serial.println("Config write skipped/failed (DIP likely at Normal Mode) - continuing with saved module settings.");
  }

  Serial.println("GPS TX ready. Sending every 3s.");
}

void loop() {
  gpsPollNMEA();

  if (millis() - lastSendMs < SEND_INTERVAL_MS) return;
  lastSendMs = millis();

  if (!gpsFix.valid) {
    Serial.println("Waiting for GPS fix...");
    return;
  }

  GpsPacket pkt;
  pkt.magic       = GPS_PACKET_MAGIC;
  pkt.node_id     = NODE_ID;
  pkt.seq         = seqCounter++;
  pkt.latitude    = (float)gpsFix.lat;
  pkt.longitude   = (float)gpsFix.lon;
  pkt.altitude_m  = gpsFix.altitude_m;
  pkt.speed_kmph  = gpsFix.speed_kmph;
  pkt.heading_deg = gpsFix.heading_deg;
  pkt.hdop        = gpsFix.hdop;
  pkt.satellites  = gpsFix.satellites;
  pkt.flags       = 0x01;   // bit0 = fix valid
  pkt.crc8        = ciren_crc8((const uint8_t*)&pkt, sizeof(GpsPacket) - 1);

  if (lora.SendFrame(config, (uint8_t*)&pkt, sizeof(pkt)) == 0) {
    Serial.printf("Sent: node=%lu seq=%lu lat=%.6f lon=%.6f sat=%d\n",
                  (unsigned long)pkt.node_id, (unsigned long)pkt.seq,
                  pkt.latitude, pkt.longitude, pkt.satellites);
  } else {
    Serial.println("Send failed.");
  }
}
