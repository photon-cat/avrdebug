import { assemble } from 'avr8js/src/utils/assembler';
import { AVRDebugger } from './debugger';
import './style.css';

const dbg = new AVRDebugger();

// DOM refs
const btnLoad = document.getElementById('btn-load') as HTMLButtonElement;
const btnAssemble = document.getElementById('btn-assemble') as HTMLButtonElement;
const btnAsmInline = document.getElementById('btn-asm-inline') as HTMLButtonElement;
const btnRun = document.getElementById('btn-run') as HTMLButtonElement;
const btnPause = document.getElementById('btn-pause') as HTMLButtonElement;
const btnStep = document.getElementById('btn-step') as HTMLButtonElement;
const btnStepOver = document.getElementById('btn-step-over') as HTMLButtonElement;
const btnReset = document.getElementById('btn-reset') as HTMLButtonElement;
const btnClearSerial = document.getElementById('btn-clear-serial') as HTMLButtonElement;
const exampleSelect = document.getElementById('example-select') as HTMLSelectElement;
const fileInput = document.getElementById('file-input') as HTMLInputElement;
const speedSlider = document.getElementById('speed-slider') as HTMLInputElement;
const statusBadge = document.getElementById('status-badge') as HTMLSpanElement;
const cyclesDisplay = document.getElementById('cycles-display') as HTMLSpanElement;
const disasmContainer = document.getElementById('disasm-container') as HTMLDivElement;
const asmEditor = document.getElementById('asm-editor') as HTMLTextAreaElement;
const asmErrors = document.getElementById('asm-errors') as HTMLDivElement;
const regsGrid = document.getElementById('registers-grid') as HTMLDivElement;
const memContainer = document.getElementById('mem-container') as HTMLDivElement;
const memAddrInput = document.getElementById('mem-addr-input') as HTMLInputElement;
const memRegion = document.getElementById('mem-region') as HTMLSelectElement;
const serialOutput = document.getElementById('serial-output') as HTMLPreElement;
const sregBits = document.querySelectorAll('.sreg-bit') as NodeListOf<HTMLSpanElement>;
const valPC = document.getElementById('val-pc') as HTMLSpanElement;
const valSP = document.getElementById('val-sp') as HTMLSpanElement;
const valCycles = document.getElementById('val-cycles') as HTMLSpanElement;

// Speed mapping
const speedMap = [500, 5000, 20000, 100000, 500000];
speedSlider.addEventListener('input', () => {
  dbg.setSpeed(speedMap[parseInt(speedSlider.value) - 1]);
});
dbg.setSpeed(speedMap[2]);

// Build register grid
const regCells: HTMLDivElement[] = [];
for (let i = 0; i < 32; i++) {
  const cell = document.createElement('div');
  cell.className = 'reg-cell';
  // Mark pointer regs
  const isSpecial = i >= 26;
  if (isSpecial) cell.classList.add('special');
  const pairNames: Record<number, string> = { 26: 'XL', 27: 'XH', 28: 'YL', 29: 'YH', 30: 'ZL', 31: 'ZH' };
  cell.innerHTML = `<span class="reg-name">${pairNames[i] || 'r' + i}</span><span class="reg-val">00</span>`;
  regCells.push(cell);
  regsGrid.appendChild(cell);
}

// --- Rendering ---

function updateStatus() {
  statusBadge.textContent = dbg.state.charAt(0).toUpperCase() + dbg.state.slice(1);
  statusBadge.className = 'badge ' + dbg.state;
}

function updateRegisters() {
  const cpu = dbg.cpu;
  for (let i = 0; i < 32; i++) {
    const val = cpu.data[i];
    const valEl = regCells[i].querySelector('.reg-val') as HTMLSpanElement;
    valEl.textContent = val.toString(16).padStart(2, '0');
    regCells[i].classList.toggle('changed', val !== dbg.prevRegisters[i]);
  }

  valPC.textContent = '0x' + (cpu.pc * 2).toString(16).padStart(4, '0');
  valPC.classList.toggle('changed', cpu.pc !== dbg.prevPC);

  valSP.textContent = '0x' + cpu.SP.toString(16).padStart(4, '0');
  valSP.classList.toggle('changed', cpu.SP !== dbg.prevSP);

  valCycles.textContent = cpu.cycles.toLocaleString();
  cyclesDisplay.textContent = `Cycles: ${cpu.cycles.toLocaleString()}`;

  // SREG bits
  const sreg = cpu.SREG;
  const prevSreg = dbg.prevSREG;
  sregBits.forEach(el => {
    const bit = parseInt(el.dataset.bit || '0');
    const isSet = (sreg >> bit) & 1;
    const wasSet = (prevSreg >> bit) & 1;
    el.classList.toggle('set', !!isSet);
    el.classList.toggle('changed', isSet !== wasSet);
  });
}

function renderDisassembly() {
  disasmContainer.innerHTML = '';
  const frag = document.createDocumentFragment();

  for (const inst of dbg.disassembly) {
    const line = document.createElement('div');
    line.className = 'disasm-line';
    line.dataset.addr = inst.address.toString();

    if (inst.address === dbg.cpu.pc) line.classList.add('current');
    if (dbg.breakpoints.has(inst.address)) line.classList.add('breakpoint');

    line.innerHTML =
      `<span class="disasm-bp"></span>` +
      `<span class="disasm-addr">${(inst.address * 2).toString(16).padStart(4, '0')}:</span>` +
      `<span class="disasm-bytes">${inst.bytes}</span>` +
      `<span class="disasm-mnemonic">${inst.mnemonic}</span>` +
      `<span class="disasm-operands">${inst.operands}</span>`;

    line.addEventListener('click', () => {
      dbg.toggleBreakpoint(inst.address);
      line.classList.toggle('breakpoint');
    });

    frag.appendChild(line);
  }
  disasmContainer.appendChild(frag);
}

function updateDisassemblyHighlight() {
  const lines = disasmContainer.querySelectorAll('.disasm-line');
  let currentLine: HTMLElement | null = null;
  lines.forEach(el => {
    const line = el as HTMLElement;
    const addr = parseInt(line.dataset.addr || '-1');
    const isCurrent = addr === dbg.cpu.pc;
    line.classList.toggle('current', isCurrent);
    if (isCurrent) currentLine = line;
  });

  // Scroll current line into view
  if (currentLine) {
    (currentLine as HTMLElement).scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }
}

function renderMemory() {
  const isData = memRegion.value === 'data';
  const mem = isData ? dbg.cpu.data : dbg.cpu.progBytes;
  let startAddr = parseInt(memAddrInput.value, 16) || 0;
  startAddr = Math.max(0, Math.min(startAddr, mem.length - 16));
  startAddr = startAddr & ~0xf; // align to 16

  const rows = Math.min(32, Math.ceil((mem.length - startAddr) / 16));
  let html = '';

  for (let r = 0; r < rows; r++) {
    const addr = startAddr + r * 16;
    if (addr >= mem.length) break;

    let hexPart = '';
    let asciiPart = '';
    for (let c = 0; c < 16; c++) {
      const a = addr + c;
      if (a >= mem.length) {
        hexPart += '<span class="mem-byte">  </span>';
        asciiPart += ' ';
        continue;
      }
      const val = mem[a];
      const isChanged = isData && dbg.recentWrites.has(a);
      const cls = isChanged ? 'mem-byte changed' : val === 0 ? 'mem-byte zero' : 'mem-byte';
      hexPart += `<span class="${cls}">${val.toString(16).padStart(2, '0')}</span>`;

      const ch = val >= 0x20 && val <= 0x7e ? String.fromCharCode(val) : '.';
      const acls = val === 0 ? 'mem-ascii-char zero' : 'mem-ascii-char';
      asciiPart += `<span class="${acls}">${ch === '<' ? '&lt;' : ch === '>' ? '&gt;' : ch === '&' ? '&amp;' : ch}</span>`;
    }

    html += `<div class="mem-row"><span class="mem-addr">${addr.toString(16).padStart(4, '0')}</span><span class="mem-hex">${hexPart}</span><span class="mem-ascii">${asciiPart}</span></div>`;
  }
  memContainer.innerHTML = html;
}

function updateAll() {
  updateStatus();
  updateRegisters();
  updateDisassemblyHighlight();
  renderMemory();
  serialOutput.textContent = dbg.serialOutput;
}

// --- Events ---

dbg.addListener((event) => {
  switch (event.type) {
    case 'program-loaded':
      renderDisassembly();
      updateAll();
      break;
    case 'state-change':
    case 'step':
    case 'breakpoint-hit':
      updateAll();
      break;
    case 'serial-output':
      serialOutput.textContent = dbg.serialOutput;
      serialOutput.scrollTop = serialOutput.scrollHeight;
      break;
  }
});

// Example loader
exampleSelect.addEventListener('change', async () => {
  const name = exampleSelect.value;
  if (!name) return;
  try {
    const resp = await fetch(`/hex/${name}.hex`);
    if (!resp.ok) throw new Error(`Failed to load ${name}.hex`);
    const hex = await resp.text();
    dbg.loadFromHex(hex);
  } catch (e) {
    asmErrors.textContent = String(e);
  }
  exampleSelect.value = '';
});

// Buttons
btnLoad.addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', () => {
  const file = fileInput.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    dbg.loadFromHex(reader.result as string);
  };
  reader.readAsText(file);
  fileInput.value = '';
});

function doAssemble() {
  const src = asmEditor.value;
  asmErrors.textContent = '';
  try {
    const result = assemble(src);
    if (result.errors.length > 0) {
      asmErrors.textContent = result.errors.join('\n');
      return;
    }
    dbg.loadFromBytes(result.bytes);
  } catch (e: unknown) {
    asmErrors.textContent = String(e);
  }
}

btnAssemble.addEventListener('click', doAssemble);
btnAsmInline.addEventListener('click', doAssemble);

btnRun.addEventListener('click', () => dbg.run());
btnPause.addEventListener('click', () => dbg.pause());
btnStep.addEventListener('click', () => dbg.step());
btnStepOver.addEventListener('click', () => dbg.stepOver());
btnReset.addEventListener('click', () => dbg.reset());
btnClearSerial.addEventListener('click', () => {
  dbg.serialOutput = '';
  serialOutput.textContent = '';
});

memAddrInput.addEventListener('change', renderMemory);
memRegion.addEventListener('change', renderMemory);

// Keyboard shortcuts
document.addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLInputElement) return;

  switch (e.key) {
    case 'F5':
      e.preventDefault();
      dbg.state === 'running' ? dbg.pause() : dbg.run();
      break;
    case 'F10':
      e.preventDefault();
      dbg.step();
      break;
    case 'F11':
      e.preventDefault();
      dbg.stepOver();
      break;
    case 'F9':
      e.preventDefault();
      dbg.reset();
      break;
  }
});

// Initial state
updateAll();
