# AVR Debugger

A web-based debugger and simulator for 8-bit AVR microcontrollers, powered by [avr8js](https://github.com/wokwi/avr8js). Targets the ATmega328P (Arduino Uno).

![Dark themed IDE-style debugger with disassembly, registers, memory view, and serial output](https://img.shields.io/badge/status-working-brightgreen)

## Features

- **Disassembly view** — full AVR instruction set decoding, current PC indicator, click-to-toggle breakpoints
- **Register panel** — r0–r31 with pointer pair labels (X/Y/Z), changed values highlighted
- **SREG display** — individual flag bits (I T H S V N Z C) with set/changed state
- **Memory viewer** — hex + ASCII dump, switchable between SRAM and Flash, recently written bytes highlighted
- **Debug controls** — Run, Pause, Step, Step Over, Reset with adjustable speed
- **Inline assembler** — write AVR assembly directly in the editor and assemble it
- **HEX file loader** — load Intel HEX files from disk or pick from built-in examples
- **Serial output** — captures USART transmissions
- **Keyboard shortcuts** — F5 (Run/Pause), F9 (Reset), F10 (Step), F11 (Step Over)

## Quick Start

```bash
npm install
npm run dev
```

Open http://localhost:3000. Pick an example from the dropdown or write assembly in the editor and click **Assemble**, then use **Step** or **Run** to debug.

## Example Sketches

Four pre-built Arduino sketches are included (built with PlatformIO, loadable from the Examples dropdown):

| Example | Description |
|---|---|
| **Blink** | Classic LED toggle on pin 13 |
| **Serial Hello** | Prints "Hello #N" over USART |
| **Counter** | Counts 0–255 on PORTB with direct port I/O |
| **Fibonacci** | Computes F(0)..F(19) and prints over serial |

To rebuild the examples:

```bash
cd examples
pio run
```

HEX files are output to `public/hex/`.

## Building Your Own Sketches

Any ATmega328P-targeted Intel HEX file will work. With PlatformIO:

```bash
pio init -b uno
# write your sketch in src/
pio run
# load .pio/build/uno/firmware.hex into the debugger
```

Or use `avr-gcc` directly:

```bash
avr-gcc -mmcu=atmega328p -O2 -o firmware.elf main.c
avr-objcopy -O ihex firmware.elf firmware.hex
```

## Project Structure

```
├── index.html           # Main page layout
├── src/
│   ├── main.ts          # UI wiring and rendering
│   ├── debugger.ts      # Core engine (CPU, breakpoints, run/step/pause)
│   ├── disassembler.ts  # AVR opcode → mnemonic decoder
│   └── style.css        # Dark theme
├── public/hex/          # Pre-built example HEX files
├── examples/            # PlatformIO project with example sketches
└── avr8js/              # avr8js library (local dependency)
```

## Tech Stack

- [avr8js](https://github.com/wokwi/avr8js) — AVR simulation engine
- [Vite](https://vitejs.dev/) — build tool
- TypeScript — all source code
- Vanilla DOM — no framework dependencies

## License

MIT
