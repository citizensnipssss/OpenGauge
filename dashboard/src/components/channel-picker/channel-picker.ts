import type { GaugeDefinition } from '../../registry/types';

/**
 * <channel-picker> — the "+" slot picker. Assigns a channel back to the
 * exact originating slot (CLAUDE.md "Locked product flow"). Prevents
 * assigning a channel that's already in use on another slot.
 */
export class ChannelPicker extends HTMLElement {
  private slotId = '';

  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
  }

  connectedCallback() {
    this.hidden = true;
  }

  open(gauges: GaugeDefinition[], assignedElsewhere: Set<string>, slotId: string, currentChannelId: string | null) {
    this.slotId = slotId;
    this.hidden = false;
    const root = this.shadowRoot!;
    root.innerHTML = `
      <style>
        *, *::before, *::after { box-sizing:border-box; }
        :host {
          position:fixed; inset:0; display:flex; align-items:center; justify-content:center;
          padding: max(16px, env(safe-area-inset-top)) max(16px, env(safe-area-inset-right))
                   max(16px, env(safe-area-inset-bottom)) max(16px, env(safe-area-inset-left));
          z-index:1000;
        }
        .backdrop { position:absolute; inset:0; background:rgba(0,0,0,.65); }
        .panel {
          position:relative; background:#14181d; border:1px solid #2a3038; border-radius:16px;
          padding:16px; width:min(560px, 100%); max-height:100%; overflow-y:auto;
          font-family:Arial, sans-serif; color:#eee; display:flex; flex-direction:column; gap:12px;
        }
        .header { display:flex; justify-content:space-between; align-items:center; }
        .title { font-size:18px; font-weight:700; }
        .close { background:none; border:none; color:#9ab; font-size:22px; cursor:pointer; min-width:48px; min-height:48px; }
        .list { display:grid; grid-template-columns: repeat(auto-fit, minmax(min(220px, 100%), 1fr)); gap:8px; }
        .item {
          display:flex; flex-direction:column; gap:2px; text-align:left; padding:12px 14px;
          min-height:48px; border-radius:10px; border:1px solid #2a3038; background:#191e24; color:#eee;
          cursor:pointer; font-family:Arial, sans-serif;
        }
        .item:hover:not(:disabled) { border-color:#ff9700; }
        .item:disabled { opacity:.4; cursor:not-allowed; }
        .item .label { font-weight:700; }
        .item .meta { font-size:12px; color:#9ab; }
        .clear {
          margin-top:4px; padding:12px; min-height:48px; border-radius:10px; border:1px solid #4a2020;
          background:#241414; color:#e88; cursor:pointer; font-family:Arial, sans-serif;
        }
      </style>
      <div class="backdrop" id="backdrop"></div>
      <div class="panel">
        <div class="header">
          <div class="title">Assign gauge</div>
          <button class="close" id="closeBtn" type="button" aria-label="Close">&times;</button>
        </div>
        <div class="list" id="list"></div>
        ${currentChannelId ? '<button class="clear" id="clearBtn" type="button">Clear this slot</button>' : ''}
      </div>
    `;

    const list = root.querySelector('#list')!;
    for (const g of gauges) {
      const inUse = assignedElsewhere.has(g.id) && g.id !== currentChannelId;
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'item';
      item.disabled = inUse;
      item.innerHTML = `<span class="label">${g.label}</span><span class="meta">${g.unit}${inUse ? ' · in use' : ''}</span>`;
      item.addEventListener('click', () => this.select(g.id));
      list.appendChild(item);
    }

    root.querySelector('#backdrop')!.addEventListener('click', () => this.dismiss());
    root.querySelector('#closeBtn')!.addEventListener('click', () => this.dismiss());
    root.querySelector('#clearBtn')?.addEventListener('click', () => this.select(null));
  }

  private select(channelId: string | null) {
    this.dispatchEvent(
      new CustomEvent('channel-selected', {
        detail: { slotId: this.slotId, channelId },
        bubbles: true,
        composed: true,
      }),
    );
    this.close();
  }

  private dismiss() {
    this.dispatchEvent(new CustomEvent('picker-dismissed', { bubbles: true, composed: true }));
    this.close();
  }

  close() {
    this.hidden = true;
    this.shadowRoot!.innerHTML = '';
  }
}

customElements.define('channel-picker', ChannelPicker);
