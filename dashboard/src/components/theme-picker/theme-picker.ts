import type { ThemeConfig } from '../../registry/types';

/**
 * <theme-picker> — step 2 of Layout → Theme → PIDs. Only "Performance
 * Chrome" exists today, but this is registry-driven so more themes are
 * data-only additions, not code changes.
 */
export class ThemePicker extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
  }

  configure(themes: ThemeConfig[]) {
    const root = this.shadowRoot!;
    root.innerHTML = `
      <style>
        *, *::before, *::after { box-sizing:border-box; }
        :host { display:block; }
        .option-grid {
          display:grid;
          grid-template-columns: repeat(auto-fit, minmax(min(220px, 100%), 1fr));
          gap: clamp(10px, 2.5vw, 18px);
        }
        .card {
          background:#14181d; border:1px solid #2a3038; border-radius:14px;
          padding:16px; display:flex; flex-direction:column; gap:10px; cursor:pointer;
          color:#eee; font-family:Arial, sans-serif; text-align:left;
        }
        .card:hover, .card:active { border-color:#ff9700; }
        .swatches { display:flex; gap:8px; }
        .swatch { width:28px; height:28px; border-radius:50%; border:2px solid #0008; }
        .name { font-size:18px; font-weight:700; }
      </style>
      <div class="option-grid"></div>
    `;
    const grid = root.querySelector('.option-grid')!;
    for (const theme of themes) {
      const card = document.createElement('button');
      card.className = 'card';
      card.type = 'button';

      const swatches = document.createElement('div');
      swatches.className = 'swatches';
      for (const color of [theme.colors.active, theme.colors.warning, theme.colors.digits]) {
        const s = document.createElement('div');
        s.className = 'swatch';
        s.style.background = color;
        swatches.appendChild(s);
      }
      card.appendChild(swatches);

      const name = document.createElement('div');
      name.className = 'name';
      name.textContent = theme.name;
      card.appendChild(name);

      card.addEventListener('click', () => {
        this.dispatchEvent(
          new CustomEvent('theme-selected', { detail: { themeId: theme.id }, bubbles: true, composed: true }),
        );
      });
      grid.appendChild(card);
    }
  }
}

customElements.define('theme-picker', ThemePicker);
