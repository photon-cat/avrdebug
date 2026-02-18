// 8-bit counter with direct port manipulation
// Counts up on PORTB, visible in register/memory view
#include <Arduino.h>

void setup() {
  DDRB = 0xFF;   // All PORTB pins as output
  PORTB = 0x00;
}

void loop() {
  for (uint8_t i = 0; i < 255; i++) {
    PORTB = i;
    _delay_ms(100);
  }
}
