# LexArchivo macOS

Version independiente para macOS de LexArchivo.

Esta rama empieza en `0.0.1` y mantiene las mismas funciones principales que la version de Windows:

- Clientes y expedientes.
- Documentos por expediente.
- Cronologia y avisos.
- Notas internas.
- Archivados y Recien eliminado.
- Copias de seguridad.
- Uso Compartido experimental.
- Actualizaciones desde GitHub Releases.

## Requisitos para desarrollo

- macOS reciente.
- Node.js LTS.
- pnpm.
- Rust estable.
- Xcode Command Line Tools.

## Ejecutar en desarrollo

```bash
pnpm install
pnpm run tauri:dev
```

## Crear instalador macOS

```bash
pnpm install
pnpm exec tauri build --target universal-apple-darwin --bundles app,dmg
```

El instalador se genera como `.dmg` en:

```text
src-tauri/target/universal-apple-darwin/release/bundle/dmg
```

## Publicar la version 0.0.1 en GitHub

1. Crea un repositorio nuevo, por ejemplo `LexArchivo-macOS`.
2. Sube todos los archivos de esta carpeta al repositorio.
3. En GitHub, configura estos secretos en `Settings > Secrets and variables > Actions`:
   - `TAURI_SIGNING_PRIVATE_KEY`
   - `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`
4. Publica una etiqueta:

```bash
git tag v0.0.1
git push origin v0.0.1
```

GitHub Actions generara automaticamente:

- `LexArchivo_0.0.1_universal.dmg`
- `LexArchivo_0.0.1_universal.dmg.sig`
- `latest.json`

## Importante sobre el repositorio

El actualizador de esta version apunta a:

```text
https://github.com/javi99f/LexArchivo-macOS/releases/latest/download/latest.json
```

Si creas el repositorio con otro nombre, cambia esa direccion en:

```text
src-tauri/tauri.conf.json
```

## Nota sobre firma de Apple

Esta version genera un `.dmg`, pero para distribuirla sin avisos de seguridad de macOS normalmente necesitarias cuenta de Apple Developer, firma de codigo y notarizacion. Para pruebas internas puedes usar el `.dmg` generado por GitHub.
