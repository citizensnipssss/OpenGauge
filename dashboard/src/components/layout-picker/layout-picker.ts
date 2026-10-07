import type { LayoutDefinition } from '../../registry/types';

/**
 * <layout-picker> — step 1 of Layout → Theme → PIDs. Renders the layout
 * registry as a responsive card grid (RESPONSIVE_UI.md "Layout/theme
 * picker" pattern) with a small CSS-grid preview of each layout's shape.
 */
export class LayoutPicker extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
  }

  configure(layouts: LayoutDefinition[]) {
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
          color:#eee; font-family:Arial, sans-serif; text-align:left; min-height:48px;
        }
        .card:hover, .card:active { border-color:#ff9700; }
        .preview {
          display:grid; gap:3px; width:100%; aspect-ratio:1/1; background:#0b0e12;
          border-radius:8px; padding:8px;
        }
        .preview .cell { background:#ff9700; border-radius:2px; opacity:.85; }
        .name { font-size:18px; font-weight:700; }
        .count { font-size:12px; color:#9ab; }
        .rationale { font-size:13px; color:#aab4bf; line-height:1.4; }
      </style>
      <div class="option-grid"></div>
    `;
    const grid = root.querySelector('.option-grid')!;
    for (const layout of layouts) {
      const card = document.createElement('button');
      card.className = 'card';
      card.type = 'button';

      const preview = document.createElement('div');
      preview.className = 'preview';
      preview.style.gridTemplateColumns = `repeat(${layout.portrait.columns}, 1fr)`;
      preview.style.gridTemplateRows = `repeat(${layout.portrait.rows}, 1fr)`;
      for (const slot of layout.portrait.slots) {
        const cell = document.createElement('div');
        cell.className = 'cell';
        cell.style.gridColumn = `${slot.x + 1} / span ${slot.w}`;
        cell.style.gridRow = `${slot.y + 1} / span ${slot.h}`;
        preview.appendChild(cell);
      }
      card.appendChild(preview);

      const name = document.createElement('div');
      name.className = 'name';
      name.textContent = layout.name;
      card.appendChild(name);

      const count = document.createElement('div');
      count.className = 'count';
      count.textContent = `${layout.slotCount} gauge${layout.slotCount === 1 ? '' : 's'}`;
      card.appendChild(count);

      const rationale = document.createElement('div');
      rationale.className = 'rationale';
      rationale.textContent = layout.rationale;
      card.appendChild(rationale);

      card.addEventListener('click', () => {
        this.dispatchEvent(
          new CustomEvent('layout-selected', { detail: { layoutId: layout.layoutId }, bubbles: true, composed: true }),
        );
      });
      grid.appendChild(card);
    }
  }
}

customElements.define('layout-picker', LayoutPicker);
