import { relaunch } from "@tauri-apps/plugin-process";
import { check } from "@tauri-apps/plugin-updater";

export async function checkDownloadAndInstallUpdate(onStatus: (message: string) => void) {
  onStatus("Buscando actualizaciones...");
  const update = await check();

  if (!update) {
    onStatus("LexArchivo ya esta actualizado.");
    return;
  }

  onStatus(`Nueva version disponible: ${update.version}. Descargando...`);
  let downloaded = 0;
  let contentLength = 0;

  await update.downloadAndInstall((event) => {
    switch (event.event) {
      case "Started":
        contentLength = event.data.contentLength ?? 0;
        onStatus("Descarga iniciada.");
        break;
      case "Progress":
        downloaded += event.data.chunkLength;
        if (contentLength > 0) {
          const percent = Math.round((downloaded / contentLength) * 100);
          onStatus(`Descargando actualizacion: ${percent}%`);
        } else {
          onStatus("Descargando actualizacion...");
        }
        break;
      case "Finished":
        onStatus("Actualizacion instalada. Reiniciando LexArchivo...");
        break;
    }
  });

  await relaunch();
}
