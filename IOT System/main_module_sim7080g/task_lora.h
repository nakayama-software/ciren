#pragma once
#include <M5Unified.h>
#include "M5_LoRa_E220_JP.h"
#include <Arduino.h>
#include "ciren_config.h"
#include "ring_buffer.h"
#include "system_state.h"

#define GATEWAY_ID "CIREN-GW-001"

LoRa_E220_JP lora;
static struct LoRaConfigItem_t config;
static struct RecvFrame_t data;

static uint32_t totalReceivedLoRa = 0;

// Diupdate tiap iterasi loop task_lora (SEBELUM RecieveFrame dipanggil) — dipakai
// task_watchdog untuk deteksi hang: kalau nilai ini tidak berubah lebih dari
// LORA_STALE_MS, task_lora dianggap macet dan di-restart otomatis.
volatile uint32_t g_lora_last_iter_ms = 0;
TaskHandle_t h_lora = NULL;

uint32_t counter = 0;

// `enabled` = false skips the actual radio bring-up (no UART config, no
// SendFrame/RecieveFrame ever attempted) — M5.begin() still runs unconditionally
// since it's needed for SPI bus ordering before the TFT/OLED driver claims it,
// completely independent of whether the LoRa radio itself is wanted.
void lora_init(bool enabled)
{
    M5.begin();   // library M5_LoRa_E220_JP bergantung pada ini — dikonfirmasi dari gateway sketch yang works
    if (!enabled) {
        Serial.println("[LoRa] lora_enabled=false — radio not initialized");
        return;
    }
    lora.Init(&Serial2, CONFIG_MODE_BAUD, SERIAL_8N1, UART_RX_LORA, UART_TX_LORA);
    lora.SetDefaultConfigValue(config);
}

// Dipakai supervisor (task_watchdog) saat recovery — TANPA M5.begin() lagi,
// karena M5.begin() terbukti bisa merusak state driver TFT kalau dipanggil
// ulang setelah boot (lihat histori: pernah menyebabkan null-pointer crash).
void lora_reinit(void)
{
    lora.Init(&Serial2, CONFIG_MODE_BAUD, SERIAL_8N1, UART_RX_LORA, UART_TX_LORA);
    lora.SetDefaultConfigValue(config);
}

void task_lora(void *param)
{
    config.own_address = 0x0001;
    config.baud_rate = BAUD_9600;
    config.air_data_rate = BW125K_SF9;
    config.subpacket_size = SUBPACKET_200_BYTE;
    config.rssi_ambient_noise_flag = RSSI_AMBIENT_NOISE_ENABLE;
    config.transmitting_power = TX_POWER_13dBm;
    config.own_channel = 0x00;
    config.rssi_byte_flag = RSSI_BYTE_ENABLE;
    config.transmission_method_type = UART_P2P_MODE;
    config.lbt_flag = LBT_DISABLE;
    config.wor_cycle = WOR_2000MS;
    config.encryption_key = 0x1234;
    config.target_address = 0x0002;
    config.target_channel = 0x00;

    int result = lora.InitLoRaSetting(config);
    if (result == 0)
    {
        Serial.println("Config write OK (DIP was at Config Mode).");
    }
    else
    {
        Serial.println("Config write skipped/failed (DIP likely at Normal Mode) - continuing with saved module settings.");
    }

    Serial.println("LoRa TX ready. Sending every 3s.");

    // TIDAK subscribe ke Task Watchdog di sini secara sengaja — RecieveFrame()
    // ternyata bisa hang total (kemungkinan noise/EMI dari modem SIM saat radio
    // seluler aktif). Kalau LoRa hang, hanya fitur GPS yang diam, bukan seluruh
    // device ikut reboot. Cari akar masalah EMI dulu sebelum subscribe lagi.

    static uint32_t _lora_last_hb = 0;

    for (;;)
    {
        char msg[64];

        g_lora_last_iter_ms = millis();   // tandai progres SEBELUM panggilan yang berpotensi hang

        uint32_t _rf_t0 = millis();
        int _rf_rc = lora.RecieveFrame(&data);
        uint32_t _rf_dt = millis() - _rf_t0;
        if (_rf_dt > 200)
        {
            Serial.printf("[LoRa] RecieveFrame took %lums (rc=%d) at t=%lu\n",
                          (unsigned long)_rf_dt, _rf_rc, millis());
        }

        if (millis() - _lora_last_hb > 2000)
        {
            _lora_last_hb = millis();
            Serial.printf("[LoRa] alive t=%lu rx=%lu\n", millis(), (unsigned long)totalReceivedLoRa);
        }

        if (_rf_rc == 0)
        {
            totalReceivedLoRa++;

            if (data.recv_data_len != sizeof(GpsPacket))
            {
                Serial.printf("[LoRa] SIZE MISMATCH — expected %d, got %d (dropped)\n",
                              (int)sizeof(GpsPacket), data.recv_data_len);
                Serial.print("[LoRa] raw bytes: ");
                for (int i = 0; i < data.recv_data_len; i++) Serial.printf("%02X ", data.recv_data[i]);
                Serial.println();
                continue;
            }
            else
            {
                GpsPacket *gpsPacket = (GpsPacket *)data.recv_data;

                // Length matching sizeof(GpsPacket) isn't proof the bytes ARE a
                // GpsPacket — noise/collisions can coincidentally hit the same
                // length. magic+crc8 catch that before we trust node_id/lat/lon.
                if (!gps_packet_valid(gpsPacket))
                {
                    Serial.printf("[LoRa] INVALID PACKET — magic/crc8 check failed (dropped)\n");
                    Serial.print("[LoRa] raw bytes: ");
                    for (int i = 0; i < data.recv_data_len; i++) Serial.printf("%02X ", data.recv_data[i]);
                    Serial.println();
                    continue;
                }

                Serial.printf("[LoRa RX] node=%u seq=%u lat=%.6f lon=%.6f sat=%d\n",
                              gpsPacket->node_id, gpsPacket->seq,
                              gpsPacket->latitude, gpsPacket->longitude,
                              gpsPacket->satellites);

                rb_gps_write(gpsPacket); // Write the received GPS data to the ring buffer

            }
        }


        vTaskDelay(pdMS_TO_TICKS(10));
        esp_task_wdt_reset();
    }
}