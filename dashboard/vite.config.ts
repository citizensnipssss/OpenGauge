import { defineConfig, type Plugin } from 'vite';

/**
 * Inline the built JS/CSS into index.html so the whole dashboard is ONE file.
 * The iPhone Files picker can only upload single files, and the ESP32's SD
 * FAT filesystem is happier with fewer, shorter paths — so the release ships
 * OpenGauge-dashboard-vX.Y.html and the device stores it at /www/index.html.
 */
function singleFile(): Plugin {
  return {
    name: 'opengauge-single-file',
    enforce: 'post',
    generateBundle(_opts, bundle) {
      const html = Object.values(bundle).find((f) => f.fileName === 'index.html');
      if (!html || html.type !== 'asset') return;
      let src = String(html.source);

      for (const [name, file] of Object.entries(bundle)) {
        if (file.type === 'chunk' && file.isEntry) {
          const re = new RegExp(`<script[^>]*src="[^"]*${escape(name)}"[^>]*></script>`);
          // Escape "</script" inside the code so it can't close the tag early
          const code = file.code.replace(/<\/script/gi, '<\\/script');
          src = src.replace(re, () => `<script type="module">${code}</script>`);
          delete bundle[name];
        } else if (file.type === 'asset' && name.endsWith('.css')) {
          const re = new RegExp(`<link[^>]*href="[^"]*${escape(name)}"[^>]*>`);
          src = src.replace(re, () => `<style>${String(file.source)}</style>`);
          delete bundle[name];
        }
      }
      html.source = src;
    },
  };
}

function escape(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export default defineConfig(({ mode }) => ({
  plugins: mode === 'native' ? [] : [singleFile()],
  build: {
    outDir: mode === 'native' ? 'dist-native' : 'dist',
    // One entry, no lazy chunks — everything must land in index.html
    rollupOptions: { output: { codeSplitting: false } },
  },
}));
