# Actualizaciones de LexArchivo macOS

LexArchivo macOS usa el actualizador firmado de Tauri. La primera instalacion se hace con el instalador `.dmg`; despues, la app puede buscar, descargar e instalar nuevas versiones desde GitHub Releases.

## Importante

Para que los ordenadores puedan actualizar sin tokens, el repositorio de releases debe ser publico. Si el repositorio es privado, la app no podra descargar `latest.json` ni el instalador sin credenciales, y no se deben meter tokens dentro de la app.

## Secretos de GitHub

En GitHub, entra en:

`Settings > Secrets and variables > Actions > New repository secret`

Crea estos secretos:

- `TAURI_SIGNING_PRIVATE_KEY`: contenido completo del archivo `TAURI_PRIVATE_KEY.key`.
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`: contenido del archivo `TAURI_KEY_PASSWORD.txt`.

La clave privada no se sube al repositorio.

## Publicar una version nueva

1. Actualiza versiones en `package.json`, `src-tauri/Cargo.toml` y `src-tauri/tauri.conf.json`.
2. Actualiza `CHANGELOG.md`.
3. Haz commit y push a GitHub.
4. Crea una etiqueta, por ejemplo `v0.0.1`.
5. Sube la etiqueta a GitHub.
6. GitHub Actions construira los instaladores, las firmas y `latest.json`.
7. Publicara esos archivos en la release.

## Archivos que usa el actualizador

La app consulta:

`https://github.com/javi99f/LexArchivo-macOS/releases/latest/download/latest.json`

Ese archivo apunta al instalador `.dmg` firmado de la ultima version.
