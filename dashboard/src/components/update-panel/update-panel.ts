/**
 * <update-panel> — install firmware / dashboard updates from files on the
 * phone. The device's WiFi has no internet, so the flow is:
 *   1. On cell data, download the release files from GitHub (Safari → Files)
 *   2. Connect to OpenGauge WiFi
 *   3. Select the application image and matching manifest, back up, review, install
 *
 * Firmware (.bin)  → POST /update            (device flashes + reboots)
 * Dashboard (.html)→ POST /upload?path=/www/index.html (page reloads)
 */

import { deviceUrl, isNative, connection } from '../../platform/connection';
import { parseDeviceInfo, type DeviceInfo } from '../../platform/device-info';
import {parseFirmwareManifest, validateFirmwarePackage, firmwareUploadPath, matchesInstalledFirmware, type FirmwareManifest} from '../../platform/firmware-package';
import {exportJson} from '../../platform/export';
import {validateDevice} from '../../sensors/model';

const RELEASES_URL = 'https://github.com/citizensnipssss/OpenGauge/releases/latest';

export class UpdatePanel extends HTMLElement {
  private busy = false;
  private deviceInfo: DeviceInfo | null = null;
  private infoRequest = 0;
  private infoLoading = false;
  private demo = false;
  private pendingFirmware: File | null = null;
  private activeDashboard: unknown = null;

  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this.render();
  }

  open(dashboard?:unknown) {
    if (this.busy) return;
    this.resetStatus();
    this.pendingFirmware = null;
    this.activeDashboard = dashboard ? structuredClone(dashboard) : null;
    this.style.display = 'block';
    this.demo = connection().demo;
    if (this.demo) {
      this.deviceInfo = null;
      this.infoLoading = false;
      this.infoRequest++;
      (this.shadowRoot!.querySelector('#deviceInfo') as HTMLElement).textContent = 'Demo — no device connected.';
      this.setBusy(false);
      this.setStatus('Switch off Demo in Device connection before installing device updates.', 'err');
      return;
    }
    void this.loadDeviceInfo();
  }

  close() {
    if (this.busy) return; // don't let a half-finished upload get hidden
    this.style.display = 'none';
  }

  private render() {
    const root = this.shadowRoot!;
    root.innerHTML = `
      <style>
        *, *::before, *::after { box-sizing:border-box; }
        :host { display:none; position:fixed; inset:0; z-index:60; font-family:Arial, sans-serif; }
        .backdrop { position:absolute; inset:0; background:rgba(0,0,0,.75); }
        .sheet {
          position:absolute; left:50%; top:50%; transform:translate(-50%,-50%);
          width:min(420px, calc(100vw - 32px)); max-height:calc(100dvh - 32px); overflow-y:auto;
          background:#0f1318; border:1px solid #2a3038; border-radius:14px; padding:20px; color:#eee;
        }
        .head { display:flex; justify-content:space-between; align-items:center; margin-bottom:8px; }
        .head h2 { margin:0; font-size:18px; letter-spacing:2px; }
        .close { background:none; border:none; color:#9ab; font-size:26px; min-width:48px; min-height:48px; cursor:pointer; }
        .step { color:#9ab; font-size:13px; line-height:1.5; margin:14px 0 8px; }
        .step b { color:#ff9700; }
        .btn {
          display:flex; align-items:center; gap:12px; width:100%; min-height:56px; padding:12px 16px;
          background:#181c22; color:#eee; border:1px solid #2a3038; border-radius:10px;
          font:600 16px Arial, sans-serif; text-align:left; text-decoration:none; cursor:pointer;
          margin-bottom:10px;
        }
        .btn:active, .btn:hover { border-color:#ff9700; }
        .btn small { display:block; font-weight:400; font-size:12px; color:#9ab; margin-top:2px; }
        .btn[disabled] { opacity:.5; pointer-events:none; }
        .icon { font-size:22px; width:28px; text-align:center; flex-shrink:0; }
        .status { min-height:20px; font-size:14px; margin-top:6px; }
        .status.ok { color:#3dca5c; } .status.err { color:#e05050; } .status.work { color:#ff9700; }
        .bar { height:6px; background:#23282f; border-radius:3px; overflow:hidden; margin-top:8px; display:none; }
        .bar > div { height:100%; width:0; background:#ff9700; transition:width .15s; }
        input[type=file] { display:none; }
      </style>
      <div class="backdrop" id="backdrop"></div>
      <div class="sheet" role="dialog" aria-label="Update">
        <div class="head">
          <h2>UPDATE</h2>
          <button class="close" id="closeBtn" type="button" aria-label="Close">&times;</button>
        </div>

        <p id="deviceInfo" role="status">Checking device information…</p>

        <div class="step"><b>1.</b> While online, download the firmware .bin and matching firmware .json from a trusted release.</div>
        <button class="btn" id="checkReleases" type="button">Check releases &amp; release notes</button>
        <a class="btn" href="${RELEASES_URL}" target="_blank" rel="noopener">
          <span class="icon">⬇</span>
          <span>Open GitHub Releases<small>Save firmware .bin + .json; dashboard .html updates separately</small></span>
        </a>

        <div class="step"><b>2.</b> Connect to <b>OpenGauge</b> WiFi, then install.</div>
        <button class="btn" id="fwBtn" type="button">
          <span class="icon">⚙</span>
          <span>Choose Firmware<small>Select the .bin for your board</small></span>
        </button>
        <button class="btn" id="detailsBtn" type="button" disabled><span class="icon">✓</span><span>Review Firmware Update<small>Select its matching firmware .json; back up and confirm</small></span></button>
        <button class="btn" id="dashBtn" type="button">
          <span class="icon">▦</span>
          <span>Install Dashboard<small>OpenGauge-dashboard-vX.Y.html — page reloads</small></span>
        </button>
        <input type="file" id="fwFile" accept=".bin,application/octet-stream" />
        <input type="file" id="detailsFile" accept=".json,application/json" />
        <input type="file" id="dashFile" accept=".html,text/html" />

        <div class="bar" id="bar"><div></div></div>
        <div class="status" id="status"></div>
      </div>
    `;

    const fwFile = root.querySelector('#fwFile') as HTMLInputElement;
    const detailsFile = root.querySelector('#detailsFile') as HTMLInputElement;
    root.querySelector('#detailsBtn')!.addEventListener('click', () => detailsFile.click());
    detailsFile.addEventListener('change', () => {
      const details = detailsFile.files?.[0]; detailsFile.value = '';
      if (details && this.pendingFirmware) void this.prepareFirmware(this.pendingFirmware, details);
    });
    root.querySelector('#checkReleases')!.addEventListener('click', () => {
      this.close();
      this.dispatchEvent(new CustomEvent('browse-releases', {bubbles:true,composed:true}));
    });
    const dashFile = root.querySelector('#dashFile') as HTMLInputElement;
    root.querySelector('#backdrop')!.addEventListener('click', () => this.close());
    root.querySelector('#closeBtn')!.addEventListener('click', () => this.close());
    root.querySelector('#fwBtn')!.addEventListener('click', () => fwFile.click());
    root.querySelector('#dashBtn')!.addEventListener('click', () => dashFile.click());

    fwFile.addEventListener('change', () => {
      const file = fwFile.files?.[0];
      fwFile.value = '';
      if (!file) return;
      if (this.busy || this.demo || this.infoLoading || this.deviceInfo?.capabilities.firmwareUpload === false) return;
      this.pendingFirmware = null;
      this.setBusy(false);
      if (!file.name.toLowerCase().endsWith('.bin')) {
        this.setStatus('That isn’t a firmware file — pick the .bin from the release.', 'err');
        return;
      }
      this.pendingFirmware = file;
      this.setBusy(false);
      this.setStatus(`Selected ${file.name}. Choose its matching firmware .json to review.`, 'work');
    });

    dashFile.addEventListener('change', () => {
      const file = dashFile.files?.[0];
      dashFile.value = '';
      if (!file) return;
      if (this.busy || this.demo) return;
      if (!file.name.toLowerCase().endsWith('.html')) {
        this.setStatus('That isn’t a dashboard file — pick the .html from the release.', 'err');
        return;
      }
      this.upload(file, '/upload?path=/www/index.html', isNative() ? 'ESP32 browser dashboard installed. The iPhone app updates separately.' : 'Dashboard installed — reloading…', () => {
        if(isNative())this.setBusy(false);
        else setTimeout(() => location.reload(), 1500);
      });
    });
  }

  private async loadDeviceInfo() {
    const request = ++this.infoRequest;
    this.deviceInfo = null;
    this.infoLoading = true;
    this.setBusy(this.busy);
    const el = this.shadowRoot!.querySelector('#deviceInfo') as HTMLElement;
    el.textContent = 'Checking device information…';
    try {
      const response = await fetch(deviceUrl('/api/device-info'), {cache: 'no-store', signal: AbortSignal.timeout(5000)});
      if (!response.ok) throw new Error('Device does not report its version.');
      const info = parseDeviceInfo(await response.json());
      if (request !== this.infoRequest) return;
      this.deviceInfo = info;
      el.textContent = `Firmware: ${info.firmwareVersion} · Board target: ${info.firmwareTarget} · Chip: ${info.chipModel}`;
    } catch {
      if (request !== this.infoRequest) return;
      el.textContent = 'Firmware version and board target unavailable. Older firmware needs a manually verified update for your exact board.';
    } finally {
      if (request === this.infoRequest) {
        this.infoLoading = false;
        this.setBusy(this.busy);
      }
    }
  }

  private async readJson(path: string,allowMissing=false): Promise<unknown> {
    const response=await fetch(deviceUrl(path),{cache:'no-store',signal:AbortSignal.timeout(5000)});
    if(allowMissing && response.status===404)return null;
    if(!response.ok)throw new Error(`${path === '/api/device-info' ? 'Device identity' : 'Settings backup'} unavailable (${response.status}). Older firmware requires a separately verified first upgrade.`);
    return response.json();
  }

  private async prepareFirmware(file:File,details:File) {
    if(this.busy || this.demo || this.infoLoading)return;
    this.setBusy(true);
    const deviceBase=deviceUrl('/');
    let handingOff=false;
    try {
      if(details.size>16384)throw new Error('Firmware update details are too large.');
      const manifest=parseFirmwareManifest(JSON.parse(await details.text()));
      if(file.size!==manifest.size)throw new Error('Firmware file size does not match the update details.');
      const info=parseDeviceInfo(await this.readJson('/api/device-info'));
      this.deviceInfo=info;
      this.setStatus('Checking firmware and preparing a settings backup…','work');
      validateFirmwarePackage(info,manifest,file.name,new Uint8Array(await file.arrayBuffer()));
      if(!info.capabilities.sensorConfig)throw new Error('This device cannot provide a complete sensor settings backup.');
      const [deviceDashboard,sensors]=await Promise.all([this.readJson('/api/config',true),this.readJson('/api/sensor-config')]);
      const dashboard=this.activeDashboard ?? deviceDashboard;
      validateDevice(sensors);
      if(!dashboard||typeof dashboard!=='object'||Array.isArray(dashboard))throw new Error('Dashboard settings backup is invalid.');
      if(deviceUrl('/')!==deviceBase)throw new Error('Device connection changed. Reopen Update before continuing.');
      const backup={format:'opengauge-device-backup',schemaVersion:1,created:new Date().toISOString(),device:info,dashboard,deviceDashboard,sensors};
      if(!await this.exportBackup(backup))throw new Error('Settings backup could not be exported; update cancelled.');
      if(!window.confirm(`Install firmware ${manifest.firmwareVersion}?\nCurrent: ${info.firmwareVersion}\nBoard: ${manifest.firmwareTarget}\nBuild: ${manifest.buildId}\nFile checksum matches the release details.\n${deviceDashboard===null?'The board has no available saved dashboard file; the backup includes the current app preferences.\n':''}Confirm that you saved the settings backup. Keep power connected; the device will reboot. Use files from a trusted release; these details are not a digital signature.`)) {
        this.setStatus('Update cancelled. No firmware was uploaded.');return;
      }
      // Recheck identity after the user has saved the backup and reviewed the update.
      const latest=parseDeviceInfo(await this.readJson('/api/device-info'));
      if(deviceUrl('/')!==deviceBase || latest.firmwareTarget!==info.firmwareTarget || latest.firmwareVersion!==info.firmwareVersion || latest.buildId!==info.buildId)
        throw new Error('Device or firmware changed during review. Start the update again.');
      validateFirmwarePackage(latest,manifest,file.name,new Uint8Array(await file.arrayBuffer()));
      const identityUrl=deviceUrl('/api/device-info');
      this.setBusy(false);
      handingOff=true;
      const verify=()=>this.waitForReboot(manifest,identityUrl);
      this.upload(file,firmwareUploadPath(manifest),'Firmware received — checking after reboot…',verify,verify);
    } catch(error) {
      this.setStatus(error instanceof Error ? error.message : 'Could not prepare firmware update.','err');
    } finally {
      if(!handingOff)this.setBusy(false);
    }
  }

  private exportBackup(backup:unknown) {
    return exportJson(`OpenGauge-backup-${Date.now()}.json`,JSON.stringify(backup,null,2));
  }

  /** XHR (not fetch) so we get upload progress. */
  private upload(file: File, url: string, doneMsg: string, onDone: () => void,verifyUnknown?:()=>void) {
    if (this.busy) return;
    this.setBusy(true);
    this.setStatus(`Uploading ${file.name}…`, 'work');
    this.setProgress(0);

    const form = new FormData();
    form.append('file', file, file.name);
    const xhr = new XMLHttpRequest();
    xhr.open('POST', deviceUrl(url));
    xhr.timeout = 120000;
    let transferComplete=false;
    xhr.upload.onload=()=>{transferComplete=true;};
    const disconnected=()=>{
      if(transferComplete && verifyUnknown) {
        this.setStatus('Transfer finished but the response was lost — checking installed firmware…','work');verifyUnknown();
      } else {
        this.setBusy(false);
        this.setStatus('Connection lost; installation result is unknown. Reconnect to OpenGauge WiFi and check the installed version before retrying.','err');
      }
    };
    xhr.ontimeout = disconnected;
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) this.setProgress(e.loaded / e.total);
      if (e.lengthComputable && e.loaded===e.total)transferComplete=true;
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        this.setProgress(1);
        this.setStatus(doneMsg, 'ok');
        onDone();
      } else {
        this.setBusy(false);
        this.setStatus(`Install failed (${xhr.status}): ${xhr.responseText || 'device rejected the file'}`, 'err');
      }
    };
    xhr.onerror = disconnected;
    xhr.send(form);
  }

  /** After a firmware flash, poll until the device answers again, then reload. */
  private waitForReboot(manifest:FirmwareManifest,identityUrl:string) {
    const started = Date.now();
    const poll = async () => {
      if (Date.now() - started > 120000) {
        this.setBusy(false);
        this.setStatus('Update result is unknown. Reconnect to OpenGauge WiFi and check the installed version before retrying.', 'err');
        return;
      }
      try {
        const res = await fetch(identityUrl, { cache: 'no-store', signal: AbortSignal.timeout(3000) });
        if (res.ok) {
          const info=parseDeviceInfo(await res.json());
          this.deviceInfo=info;
          this.setBusy(false);
          if(matchesInstalledFirmware(info,manifest)) {
            this.setStatus(`Verified firmware ${info.firmwareVersion} (${info.buildId}). Update complete.`, 'ok');
            (this.shadowRoot!.querySelector('#deviceInfo') as HTMLElement).textContent=`Firmware: ${info.firmwareVersion} · Board target: ${info.firmwareTarget}`;
          } else this.setStatus(`Device returned with ${info.firmwareVersion} (${info.buildId ?? 'unknown build'}), not the expected firmware. Installation was not verified.`, 'err');
          return;
        }
      } catch { /* still rebooting */ }
      setTimeout(poll, 2000);
    };
    setTimeout(poll, 5000);
  }

  private setBusy(busy: boolean) {
    this.busy = busy;
    const root = this.shadowRoot!;
    (root.querySelector('#fwBtn') as HTMLButtonElement).disabled = busy || this.demo || this.infoLoading || this.deviceInfo?.capabilities.firmwareUpload === false;
    (root.querySelector('#dashBtn') as HTMLButtonElement).disabled = busy || this.demo;
    (root.querySelector('#detailsBtn') as HTMLButtonElement).disabled = busy || this.demo || this.infoLoading || !this.pendingFirmware || this.deviceInfo?.capabilities.firmwareUpload === false;
    (root.querySelector('#checkReleases') as HTMLButtonElement).disabled = busy;
  }

  private setProgress(frac: number) {
    const bar = this.shadowRoot!.querySelector('#bar') as HTMLDivElement;
    bar.style.display = 'block';
    (bar.firstElementChild as HTMLDivElement).style.width = `${Math.round(frac * 100)}%`;
  }

  private setStatus(text: string, kind: 'ok' | 'err' | 'work' | '' = '') {
    const el = this.shadowRoot!.querySelector('#status') as HTMLDivElement;
    el.textContent = text;
    el.className = `status ${kind}`;
  }

  private resetStatus() {
    if (this.busy) return;
    this.setStatus('');
    (this.shadowRoot!.querySelector('#bar') as HTMLDivElement).style.display = 'none';
  }
}

customElements.define('update-panel', UpdatePanel);
