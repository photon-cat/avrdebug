import {
  avrInstruction,
  AVRIOPort,
  AVRTimer,
  AVRUSART,
  CPU,
  portBConfig,
  portCConfig,
  portDConfig,
  timer0Config,
  timer1Config,
  timer2Config,
  usart0Config,
} from 'avr8js';
import { disassembleProgram, type DisassembledInstruction } from './disassembler';

export type DebuggerState = 'stopped' | 'running' | 'paused';

export interface DebuggerEvent {
  type: 'state-change' | 'step' | 'breakpoint-hit' | 'serial-output' | 'program-loaded';
}

export type DebuggerListener = (event: DebuggerEvent) => void;

// ATmega328p
const FLASH = 0x8000;

export function loadHex(source: string, target: Uint8Array) {
  for (const line of source.split('\n')) {
    if (line[0] === ':' && line.substr(7, 2) === '00') {
      const bytes = parseInt(line.substr(1, 2), 16);
      const addr = parseInt(line.substr(3, 4), 16);
      for (let i = 0; i < bytes; i++) {
        target[addr + i] = parseInt(line.substr(9 + i * 2, 2), 16);
      }
    }
  }
}

export class AVRDebugger {
  readonly program = new Uint16Array(FLASH);
  readonly cpu: CPU;
  readonly timer0: AVRTimer;
  readonly timer1: AVRTimer;
  readonly timer2: AVRTimer;
  readonly portB: AVRIOPort;
  readonly portC: AVRIOPort;
  readonly portD: AVRIOPort;
  readonly usart: AVRUSART;
  readonly speed = 16e6;

  breakpoints = new Set<number>();  // word addresses
  state: DebuggerState = 'stopped';
  disassembly: DisassembledInstruction[] = [];
  serialOutput = '';
  programSize = 0;

  // Memory write tracking (for highlighting)
  recentWrites = new Set<number>();

  // Previous register values (for highlighting changes)
  prevRegisters = new Uint8Array(32);
  prevSREG = 0;
  prevSP = 0;
  prevPC = 0;

  private listeners: DebuggerListener[] = [];
  private animFrameId: number | null = null;
  private instructionsPerFrame = 10000;

  constructor() {
    this.cpu = new CPU(this.program);
    this.timer0 = new AVRTimer(this.cpu, timer0Config);
    this.timer1 = new AVRTimer(this.cpu, timer1Config);
    this.timer2 = new AVRTimer(this.cpu, timer2Config);
    this.portB = new AVRIOPort(this.cpu, portBConfig);
    this.portC = new AVRIOPort(this.cpu, portCConfig);
    this.portD = new AVRIOPort(this.cpu, portDConfig);
    this.usart = new AVRUSART(this.cpu, usart0Config, this.speed);

    this.usart.onByteTransmit = (byte: number) => {
      this.serialOutput += String.fromCharCode(byte);
      this.emit({ type: 'serial-output' });
    };

    this.savePrevState();
  }

  addListener(fn: DebuggerListener) {
    this.listeners.push(fn);
  }

  private emit(event: DebuggerEvent) {
    for (const fn of this.listeners) fn(event);
  }

  private savePrevState() {
    for (let i = 0; i < 32; i++) this.prevRegisters[i] = this.cpu.data[i];
    this.prevSREG = this.cpu.SREG;
    this.prevSP = this.cpu.SP;
    this.prevPC = this.cpu.pc;
  }

  loadFromHex(hexString: string) {
    this.program.fill(0);
    loadHex(hexString, new Uint8Array(this.program.buffer));
    this.onProgramLoaded();
  }

  loadFromBytes(bytes: Uint8Array) {
    this.program.fill(0);
    const target = new Uint8Array(this.program.buffer);
    target.set(bytes.subarray(0, Math.min(bytes.length, target.length)));
    this.onProgramLoaded();
  }

  private onProgramLoaded() {
    // Find program size
    this.programSize = this.program.length;
    for (let i = this.program.length - 1; i >= 0; i--) {
      if (this.program[i] !== 0) {
        this.programSize = i + 1;
        break;
      }
    }

    this.cpu.reset();
    this.state = 'paused';
    this.serialOutput = '';
    this.recentWrites.clear();
    this.breakpoints.clear();
    this.disassembly = disassembleProgram(this.program, this.programSize + 1);
    this.savePrevState();
    this.emit({ type: 'program-loaded' });
    this.emit({ type: 'state-change' });
  }

  step() {
    if (this.state === 'stopped') return;
    this.savePrevState();
    this.recentWrites.clear();

    // Hook writeData to track writes
    const origWrite = this.cpu.writeData.bind(this.cpu);
    this.cpu.writeData = (addr: number, value: number, mask?: number) => {
      this.recentWrites.add(addr);
      origWrite(addr, value, mask);
    };

    avrInstruction(this.cpu);
    this.cpu.tick();

    // Restore
    this.cpu.writeData = origWrite;

    this.state = 'paused';
    this.emit({ type: 'step' });
    this.emit({ type: 'state-change' });
  }

  stepOver() {
    if (this.state === 'stopped') return;
    const opcode = this.cpu.progMem[this.cpu.pc];
    // CALL or RCALL
    const isCall = (opcode & 0xfe0e) === 0x940e || (opcode & 0xf000) === 0xd000;
    if (isCall) {
      // Run until we return to the next instruction
      const returnAddr = this.cpu.pc + ((opcode & 0xfe0e) === 0x940e ? 2 : 1);
      this.savePrevState();
      this.recentWrites.clear();
      let maxIter = 1000000;
      while (maxIter-- > 0) {
        avrInstruction(this.cpu);
        this.cpu.tick();
        if (this.cpu.pc === returnAddr || this.breakpoints.has(this.cpu.pc)) break;
      }
      this.state = 'paused';
      this.emit({ type: 'step' });
      this.emit({ type: 'state-change' });
    } else {
      this.step();
    }
  }

  run() {
    if (this.state === 'stopped') return;
    this.state = 'running';
    this.emit({ type: 'state-change' });
    this.animFrameId = requestAnimationFrame(() => this.runLoop());
  }

  private runLoop() {
    if (this.state !== 'running') return;

    this.savePrevState();
    this.recentWrites.clear();

    for (let i = 0; i < this.instructionsPerFrame; i++) {
      avrInstruction(this.cpu);
      this.cpu.tick();

      if (this.breakpoints.has(this.cpu.pc)) {
        this.state = 'paused';
        this.emit({ type: 'breakpoint-hit' });
        this.emit({ type: 'state-change' });
        return;
      }
    }

    this.emit({ type: 'step' });
    this.animFrameId = requestAnimationFrame(() => this.runLoop());
  }

  pause() {
    if (this.state !== 'running') return;
    if (this.animFrameId !== null) {
      cancelAnimationFrame(this.animFrameId);
      this.animFrameId = null;
    }
    this.state = 'paused';
    this.emit({ type: 'state-change' });
  }

  reset() {
    this.pause();
    this.cpu.reset();
    this.serialOutput = '';
    this.recentWrites.clear();
    this.state = this.programSize > 0 ? 'paused' : 'stopped';
    this.savePrevState();
    this.emit({ type: 'state-change' });
  }

  toggleBreakpoint(addr: number) {
    if (this.breakpoints.has(addr)) {
      this.breakpoints.delete(addr);
    } else {
      this.breakpoints.add(addr);
    }
  }

  setSpeed(instructionsPerFrame: number) {
    this.instructionsPerFrame = instructionsPerFrame;
  }

  // Get the disassembly index for a given PC
  getDisasmIndexForPC(pc: number): number {
    return this.disassembly.findIndex(inst => inst.address === pc);
  }
}
