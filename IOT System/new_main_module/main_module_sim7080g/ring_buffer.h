#pragma once
#include <Arduino.h>
#include "ciren_config.h"

typedef struct
{
  uint8_t ctrl_id;
  uint8_t port_num;
  uint8_t sensor_type;
  float value;
  uint32_t timestamp_ms;
  uint8_t ftype;
} __attribute__((packed)) SensorPacket;

typedef struct
{
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
} __attribute__((packed)) GpsPacket;

static portMUX_TYPE rb_mux = portMUX_INITIALIZER_UNLOCKED;
static portMUX_TYPE rb_gps_mux = portMUX_INITIALIZER_UNLOCKED;

typedef struct
{
  SensorPacket slots[RB_SIZE];
  volatile uint8_t head;
  volatile uint8_t tail;
} RingBuffer;

typedef struct
{
  GpsPacket slots[RB_SIZE];
  volatile uint8_t head;
  volatile uint8_t tail;
} RingBufferGps;

RingBuffer rb;
RingBufferGps rb_gps;

void rb_init()
{
  rb.head = 0;
  rb.tail = 0;
}
void rb_gps_init()
{
  rb_gps.head = 0;
  rb_gps.tail = 0;
}

void rb_write(const SensorPacket *pkt)
{
  portENTER_CRITICAL(&rb_mux);
  rb.slots[rb.head] = *pkt;
  rb.head = (rb.head + 1) % RB_SIZE;
  if (rb.head == rb.tail)
    rb.tail = (rb.tail + 1) % RB_SIZE;
  portEXIT_CRITICAL(&rb_mux);
}

void rb_gps_write(const GpsPacket *pkt)
{
  portENTER_CRITICAL(&rb_gps_mux);
  rb_gps.slots[rb_gps.head] = *pkt;
  rb_gps.head = (rb_gps.head + 1) % RB_SIZE;
  if (rb_gps.head == rb_gps.tail)
    rb_gps.tail = (rb_gps.tail + 1) % RB_SIZE;
  portEXIT_CRITICAL(&rb_gps_mux);
}

uint8_t rb_drain(SensorPacket *out, uint8_t max_count)
{
  uint8_t count = 0;
  portENTER_CRITICAL(&rb_mux);
  while (rb.tail != rb.head && count < max_count)
  {
    out[count++] = rb.slots[rb.tail];
    rb.tail = (rb.tail + 1) % RB_SIZE;
  }
  portEXIT_CRITICAL(&rb_mux);
  return count;
}

uint8_t rb_gps_drain(GpsPacket *out, uint8_t max_count)
{
  uint8_t count = 0;
  portENTER_CRITICAL(&rb_gps_mux);
  while (rb_gps.tail != rb_gps.head && count < max_count)
  {
    out[count++] = rb_gps.slots[rb_gps.tail];
    rb_gps.tail = (rb_gps.tail + 1) % RB_SIZE;
  }
  portEXIT_CRITICAL(&rb_gps_mux);
  return count;
}

uint8_t rb_count() { return (uint8_t)((rb.head - rb.tail + RB_SIZE) % RB_SIZE); }
uint8_t rb_gps_count() { return (uint8_t)((rb_gps.head - rb_gps.tail + RB_SIZE) % RB_SIZE); }

float rb_usage() { return (float)rb_count() / (float)RB_SIZE; }
float rb_gps_usage() { return (float)rb_gps_count() / (float)RB_SIZE; }