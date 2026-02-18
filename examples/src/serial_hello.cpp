// Serial hello world - prints messages over USART
#include <Arduino.h>

int count = 0;

void setup() {
  Serial.begin(9600);
  Serial.println("AVR Debugger Test");
  Serial.println("=================");
}

void loop() {
  Serial.print("Hello #");
  Serial.println(count++);
  delay(1000);
}
