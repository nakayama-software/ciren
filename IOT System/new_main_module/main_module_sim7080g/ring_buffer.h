#pragma once
#include <Arduino.h>
#include "ciren_config.h"

typedef struct {
  uint8_t  ctrl_id;
  uint8_t  port_num;
  uint8_t  sensor_type;
  float    value;
  uint32_t timestamp_ms;
  uint8_t  ftype;
} __attribute__((packed)) SensorPacket;

static portMUX_TYPE rb_mux = portMUX_INITIALIZER_UNLOCKED;

typedef struct {
  SensorPacket     slots[RB_SIZE];
  volatile uint8_t head;
  volatile uint8_t tail;
} RingBuffer;

RingBuffer rb;

void rb_init() { rb.head = 0; rb.tail = 0; }

void rb_write(const SensorPacket* pkt) {
  portENTER_CRITICAL(&rb_mux);
  rb.slots[rb.head] = *pkt;
  rb.head = (rb.head + 1) % RB_SIZE;
  if (rb.head == rb.tail)
    rb.tail = (rb.tail + 1) % RB_SIZE;
  portEXIT_CRITICAL(&rb_mux);
}

uint8_t rb_drain(SensorPacket* out, uint8_t max_count) {
  uint8_t count = 0;
  portENTER_CRITICAL(&rb_mux);
  while (rb.tail != rb.head && count < max_count) {
    out[count++] = rb.slots[rb.tail];
    rb.tail = (rb.tail + 1) % RB_SIZE;
  }
  portEXIT_CRITICAL(&rb_mux);
  return count;
}

uint8_t rb_count() { return (uint8_t)((rb.head - rb.tail + RB_SIZE) % RB_SIZE); }
float   rb_usage() { return (float)rb_count() / (float)RB_SIZE; }