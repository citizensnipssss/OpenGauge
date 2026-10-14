import { isNative } from './connection';
import { Filesystem, Directory, Encoding } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';

export async function exportJson(filename: string, text: string) {
  try {
    const desktop = (window as unknown as {openGaugeDesktop?: {export: (name:string,text:string)=>Promise<{ok:boolean;canceled?:boolean;error?:string}>}}).openGaugeDesktop;
    if (desktop) {
      const result = await desktop.export(filename, text);
      if (!result.ok) throw new Error(result.error ?? 'File save failed.');
      return !result.canceled;
    }
    if (isNative()) {
      const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, '_');
      const file = await Filesystem.writeFile({ path: safeName, data: text, directory: Directory.Cache, encoding: Encoding.UTF8 });
      await Share.share({ title: 'OpenGauge settings', files: [file.uri] });
      return true;
    }
    const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return true;
  } catch {
    window.alert('Export could not be completed. Please try again.');
    return false;
  }
}
