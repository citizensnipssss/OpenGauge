import './components/pc-gauge/pc-gauge';
import { loadGaugeRegistry, loadTheme } from './registry/gauges';
import type { PcGauge } from './components/pc-gauge/pc-gauge';

// The 4 gauges we show, in display order, mapped to /api/sensors keys
const ACTIVE_GAUGES = [
  { id: 'fuel_pressure', apiKey: 'fuel_psi'  },
  { id: 'trans_temp',    apiKey: 'trans_f'   },
  { id: 'boost',         apiKey: 'boost_psi' },
  { id: 'egt',           apiKey: 'egt_f'     },
];

const style = document.createElement('style');
style.textContent = `
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    background: #080b0e;
    font-family: Arial, sans-serif;
    color: #eee;
    min-height: 100vh;
    display: flex;
    flex-direction: column;
  }
  header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 6px 14px;
    background: #0c0f12;
    border-bottom: 1px solid #1a1e22;
    font-size: 11px;
    color: #444;
    flex-shrink: 0;
  }
  header .title { color: #666; font-size: 12px; letter-spacing: 3px; text-transform: uppercase; }
  #dot {
    width: 7px; height: 7px; border-radius: 50%;
    background: #222; display: inline-block; margin-right: 5px;
    transition: background 0.3s, box-shadow 0.3s;
  }
  #dot.ok  { background: #00e060; box-shadow: 0 0 6px #00e060; }
  #dot.err { background: #e03030; box-shadow: 0 0 6px #e03030; }
  .grid {
    flex: 1;
    display: grid;
    grid-template-columns: 1fr 1fr;
    grid-template-rows: 1fr 1fr;
    gap: 2px;
    background: #111;
    padding: 2px;
  }
  .cell {
    background: #080b0e;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 4px;
  }
  .cell pc-gauge { display: block; width: 100%; max-width: 260px; aspect-ratio: 1/1; }
  footer {
    background: #0c0f12;
    border-top: 1px solid #1a1e22;
    padding: 8px 14px;
    display: flex;
    gap: 10px;
    justify-content: center;
    flex-shrink: 0;
  }
  .relay-btn {
    background: #111;
    border: 1px solid #2a2e32;
    color: #444;
    padding: 7px 18px;
    font-family: Arial, sans-serif;
    font-size: 11px;
    letter-spacing: 1px;
    text-transform: uppercase;
    cursor: pointer;
    border-radius: 3px;
    transition: all 0.15s;
  }
  .relay-btn.on { color: #00e060; border-color: #00e060; box-shadow: 0 0 8px #00e0604a; }
  .relay-btn:active { opacity: 0.6; }
`;
document.head.appendChild(style);

async function main() {
  const [allGauges, theme] = await Promise.all([loadGaugeRegistry(), loadTheme()]);

  // Header
  const header = document.createElement('header');
  header.innerHTML = `
    <span class="title">Truck Gauge</span>
    <span><span id="dot"></span><span id="status-text">connecting\u2026</span></span>
  `;
  document.body.appendChild(header);

  // Gauge grid
  const grid = document.createElement('div');
  grid.className = 'grid';
  document.body.appendChild(grid);

  const gaugeMap = new Map<string, PcGauge>();

  for (const { id } of ACTIVE_GAUGES) {
    const def = allGauges.find(g => g.id === id);
    if (!def) continue;

    const cell = document.createElement('div');
    cell.className = 'cell';

    const gauge = document.createElement('pc-gauge') as PcGauge;
    cell.appendChild(gauge);
    grid.appendChild(cell);

    gauge.configure(def, theme);
    gaugeMap.set(id, gauge);
  }

  // Relay footer
  const footer = document.createElement('footer');
  footer.innerHTML = `
    <button class="relay-btn" id="btn-fan">Fan</button>
    <button class="relay-btn" id="btn-light">Lights</button>
  `;
  document.body.appendChild(footer);

  const relayState = { fan: false, lights: false };

  function toggleRelay(name: 'fan' | 'lights') {
    relayState[name] = !relayState[name];
    const btn = document.getElementById(name === 'fan' ? 'btn-fan' : 'btn-light')!;
    btn.classList.toggle('on', relayState[name]);
    fetch('/api/relay', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ relay: name, state: relayState[name] }),
    }).catch(() => {});
  }

  document.getElementById('btn-fan')!.addEventListener('click',   () => toggleRelay('fan'));
  document.getElementById('btn-light')!.addEventListener('click', () => toggleRelay('lights'));

  // Live polling
  const dot = document.getElementById('dot')!;
  const statusText = document.getElementById('status-text')!;
  let errCount = 0;

  async function poll() {
    try {
      const res = await fetch('/api/sensors');
      const d = await res.json();
      errCount = 0;
      dot.className = 'ok';
      statusText.textContent = 'live';

      for (const { id, apiKey } of ACTIVE_GAUGES) {
        const g = gaugeMap.get(id);
        if (g && d[apiKey] !== undefined) g.value = d[apiKey];
      }

      document.getElementById('btn-fan')!.classList.toggle('on', !!d.relay_fan);
      document.getElementById('btn-light')!.classList.toggle('on', !!d.relay_light);
      relayState.fan    = !!d.relay_fan;
      relayState.lights = !!d.relay_light;

    } catch {
      errCount++;
      if (errCount > 3) {
        dot.className = 'err';
        statusText.textContent = 'no signal';
      }
    }
  }

  poll();
  setInterval(poll, 500);
}

main();
