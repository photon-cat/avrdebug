// Fibonacci sequence over serial
// Good for watching register/memory changes while stepping
#include <Arduino.h>

uint16_t fibonacci(uint8_t n) {
  if (n <= 1) return n;
  uint16_t a = 0, b = 1;
  for (uint8_t i = 2; i <= n; i++) {
    uint16_t temp = a + b;
    a = b;
    b = temp;
  }
  return b;
}

void setup() {
  Serial.begin(9600);
  Serial.println("Fibonacci Sequence:");

  for (uint8_t i = 0; i < 20; i++) {
    Serial.print("F(");
    Serial.print(i);
    Serial.print(") = ");
    Serial.println(fibonacci(i));
  }
}

void loop() {
  // Nothing - all work done in setup
}
