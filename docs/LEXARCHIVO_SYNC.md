# LexArchivo Sync

Documento de trabajo para integrar sincronizacion propia en LexArchivo usando ideas de Syncthing Windows Setup.

## Que se ha revisado

Carpeta revisada:

`C:\Users\javie\Downloads\SyncthingWindowsSetup-main`

Tambien se reviso:

`C:\Users\javie\Downloads\SyncthingWindowsSetup-main\SYNCTHING`

Archivos principales:

- `README.md`
- `LICENSE`
- `Syncthing.iss`
- `building.md`
- `en-SetSyncthingConfig.js`
- `en-SyncthingFirewallRule.js`
- `en-SyncthingLogonTask.js`

## Conclusion importante

La carpeta revisada no contiene el motor real `syncthing.exe`.

Contiene un instalador de Windows hecho con Inno Setup. Ese instalador descarga Syncthing desde GitHub, extrae `syncthing.exe`, genera su configuracion y crea tareas de inicio o servicio de Windows.

Por tanto, no conviene copiar toda esa carpeta dentro de LexArchivo. Lo aprovechable es la estrategia.

La subcarpeta `SYNCTHING` contiene:

- `syncthing-windows-setup.exe`
- una copia del proyecto `SyncthingWindowsSetup-2.0.2`

Tampoco contiene `syncthing.exe`. El instalador compilado es pequeno y esta preparado para descargar Syncthing durante la instalacion.

## Instalacion local comprobada

Se ejecuto el instalador `syncthing-windows-setup.exe` en modo usuario actual.

Rutas creadas:

- Programa: `C:\Users\javie\AppData\Local\Programs\Syncthing\syncthing.exe`
- Configuracion: `C:\Users\javie\AppData\Local\Syncthing\config.xml`
- Log: `C:\Users\javie\AppData\Local\Syncthing\syncthing.log`

Version instalada:

`syncthing v2.1.1`

Syncthing queda escuchando en:

`http://127.0.0.1:8384`

La app puede comunicarse con Syncthing mediante su API local leyendo la clave desde `config.xml`. Esa clave no debe mostrarse al usuario.

LexArchivo ya puede detectar:

- si Syncthing esta instalado,
- si esta respondiendo,
- la version instalada,
- el identificador del ordenador,
- la carpeta `LexArchivo Sync`.

Tambien se ha preparado un comando experimental para crear:

`Datos de LexArchivo\LexArchivo Sync`

y registrarla en Syncthing como carpeta `lexarchivo-sync`.

## Que podemos imitar

Para LexArchivo interesa imitar estas ideas:

1. Instalar o incluir un motor auxiliar de sincronizacion.
2. Guardar su configuracion en una carpeta propia de LexArchivo.
3. Arrancar el motor sin que el usuario tenga que abrir otra aplicacion.
4. Configurar una carpeta interna de intercambio.
5. Permitir modo sencillo para usuario actual, sin instalacion como servicio.
6. Mostrar el estado dentro de LexArchivo.
7. Tener botones simples: preparar, iniciar, detener, actualizar, abrir carpeta.

## Que no deberiamos copiar ahora

Para una primera prueba no hace falta copiar:

- Instalacion como servicio de Windows.
- Reglas automaticas de firewall.
- Instalador independiente de Syncthing.
- Tareas programadas complejas.
- Autoactualizaciones del motor.
- Localizacion multiidioma.
- Scripts JScript completos.

Eso complica mucho la primera version y no aporta valor para comprobar si el flujo funciona.

## Propuesta tecnica

Crear un modulo llamado `LexArchivo Sync`.

La idea no es renombrar Syncthing como si fuera codigo propio. La idea correcta es:

- LexArchivo muestra una interfaz propia.
- Syncthing, o un motor auxiliar equivalente, hace la sincronizacion.
- LexArchivo conserva los avisos de licencia si se incluye codigo o binarios de terceros.

## Primera version experimental

Objetivo:

Probar si varios ordenadores pueden compartir expedientes sin pagar una nube mensual.

Funcionamiento previsto:

1. LexArchivo crea una carpeta interna de sincronizacion:
   `Datos de LexArchivo\LexArchivo Sync`

2. LexArchivo publica los expedientes en esa carpeta con la estructura:

   ```text
   LexArchivo Sync/
     Expedientes/
       <id-expediente>/
         expediente.json
         documentos/
   ```

3. El motor de sincronizacion se encargaria de copiar esa carpeta entre ordenadores.

4. Al abrir la app o pulsar `Actualizar`, LexArchivo lee los expedientes que encuentre.

5. De momento, la seguridad avanzada se deja para versiones posteriores.

## Integracion recomendada por fases

### Fase 1: Preparar LexArchivo

- Cambiar la pantalla de Uso Compartido para hablar de `LexArchivo Sync`.
- Crear una carpeta interna automaticamente.
- Mantener botones para publicar y actualizar.
- Mostrar si el motor de sincronizacion esta disponible o no.

### Fase 2: Incluir motor

- Incluir `syncthing.exe` oficial como binario auxiliar o pedir al usuario seleccionarlo.
- Guardar su configuracion en datos locales de LexArchivo.
- Arrancarlo solo cuando la app lo necesite.
- No abrir la interfaz web de Syncthing al usuario normal.

### Fase 3: Conectar ordenadores

- Mostrar un codigo o identificador del ordenador.
- Permitir pegar el identificador de otro ordenador.
- Configurar la carpeta de intercambio.
- Sincronizar solo la carpeta de LexArchivo.

### Fase 4: Mejoras de seguridad

- Aviso de conflictos.
- Historial de cambios.
- Bloqueo de edicion simultanea.
- Registro claro de quien publico o modifico.
- Cifrado o protecciones adicionales si el proyecto pasa a datos reales.

## Necesario para continuar

Para hacer una integracion real hace falta uno de estos dos caminos:

1. Descargar o aportar `syncthing.exe` oficial para Windows.
2. Crear un sincronizador propio basico desde cero, con menos funciones que Syncthing.

Para LexArchivo, lo mas sensato es empezar con el primer camino.
