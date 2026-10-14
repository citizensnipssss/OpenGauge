import { CapacitorHttp } from '@capacitor/core';
import { connection, saveConnection, validateHost } from '../../platform/connection';
import { parseDeviceInfo } from '../../platform/device-info';

export class DeviceSettings extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this.shadowRoot!.innerHTML = `
      <style>
        * { box-sizing:border-box; } :host { display:none; position:fixed; inset:0; z-index:65; background:#000b; font:16px Arial; color:#eee; padding:max(20px,env(safe-area-inset-top)) 20px; overflow:auto; }
        section { margin:30px auto; max-width:420px; padding:24px; background:#141920; border-radius:14px; }
        input,button { font:inherit; min-height:48px; border-radius:8px; padding:10px; } input[type=text] { width:100%; margin:10px 0; } button { margin:12px 8px 0 0; } p { line-height:1.5; } #error { color:#ff897a; }
      </style>
      <section role="dialog" aria-label="Device connection"><h2>Device connection</h2>
        <p>Join <b>OpenGauge</b> Wi-Fi in iPhone Settings and allow Local Network access. The Wi-Fi may say “No Internet”; stay connected.</p>
        <label>Device IP or hostname<input id="host" type="text" autocapitalize="off" autocomplete="off" spellcheck="false"></label>
        <label><input id="demo" type="checkbox"> Demo readings (SIM)</label>
        <p>If readings stay offline, check Settings → Privacy &amp; Security → Local Network → OpenGauge, then return here.</p>
        <p id="status" role="status" aria-live="polite"></p>
        <div id="error" role="alert"></div><button id="test">Test connection</button><button id="save">Save and reconnect</button><button id="cancel">Cancel</button>
      </section>`;
    this.shadowRoot!.querySelector('#cancel')!.addEventListener('click', () => this.style.display = 'none');
    this.shadowRoot!.querySelector('#test')!.addEventListener('click', async () => {
      const button = this.shadowRoot!.querySelector('#test') as HTMLButtonElement;
      const status = this.shadowRoot!.querySelector('#status')!;
      const errorBox = this.shadowRoot!.querySelector('#error')!;
      button.disabled = true;
      errorBox.textContent = '';
      status.textContent = 'Checking the board…';
      try {
        const host = validateHost((this.shadowRoot!.querySelector('#host') as HTMLInputElement).value);
        const response = await CapacitorHttp.get({ url: `http://${host}/api/device-info`,
          connectTimeout: 5000, readTimeout: 5000, responseType: 'json', disableRedirects: true });
        if (response.status !== 200) throw new Error('The board did not return its identity.');
        const info = parseDeviceInfo(typeof response.data === 'string' ? JSON.parse(response.data) : response.data);
        if (info.firmwareTarget !== 'arduino-nano-esp32') throw new Error('This is not a supported OpenGauge board.');
        status.textContent = `Connected to OpenGauge — ${info.buildId ?? info.firmwareVersion}. No settings changed.`;
      } catch {
        status.textContent = '';
        errorBox.textContent = 'Could not verify OpenGauge. Check the address, OpenGauge Wi-Fi, and Local Network permission. Try 192.168.4.1 if the hostname fails.';
      } finally { button.disabled = false; }
    });
    this.shadowRoot!.querySelector('#save')!.addEventListener('click', () => {
      try {
        saveConnection({ host: (this.shadowRoot!.querySelector('#host') as HTMLInputElement).value,
          demo: (this.shadowRoot!.querySelector('#demo') as HTMLInputElement).checked });
        location.reload();
      } catch (error) { this.shadowRoot!.querySelector('#error')!.textContent = String((error as Error).message); }
    });
  }
  open() {
    const value = connection();
    (this.shadowRoot!.querySelector('#host') as HTMLInputElement).value = value.host;
    (this.shadowRoot!.querySelector('#demo') as HTMLInputElement).checked = value.demo;
    this.shadowRoot!.querySelector('#error')!.textContent = '';
    this.shadowRoot!.querySelector('#status')!.textContent = '';
    this.style.display = 'block';
  }
}
customElements.define('device-settings', DeviceSettings);
