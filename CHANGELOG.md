# Registro de cambios

## 0.2.2

- Correccion del tema claro/oscuro para que cambie al seleccionar la opcion.
- Correccion del boton de actualizaciones para que no quede bloqueado si ya esta actualizado.
- Separadas las vistas de Clientes y Expedientes.
- Nueva zona de documentos preparada para arrastrar archivos.
- Los documentos se guardan en carpetas internas por cliente y expediente.
- Correccion del arrastre de documentos en Windows usando el evento nativo de Tauri.
- Ajustes visuales para que el modo oscuro no deje zonas claras en documentos y paneles.
- La vista Clientes agrupa por nombre de cliente.
- Si un cliente tiene un solo expediente, se abre directamente.
- Si tiene varios expedientes, se muestra una lista interna de expedientes del cliente.
- Al crear un expediente se puede seleccionar un cliente ya registrado desde un desplegable.

## 0.2.1

- Anade eliminacion segura de expedientes con confirmacion.
- Nueva vista "Recien eliminado" para recuperar o borrar definitivamente expedientes.
- Limpieza automatica de expedientes eliminados pasados 30 dias.
- Ajuste de tema claro u oscuro para la interfaz.

## 0.2.0

- Activado el sistema de actualizaciones firmadas mediante Tauri Updater.
- El boton de actualizaciones de Ajustes puede comprobar, descargar e instalar una nueva version publicada en GitHub Releases.
- Preparada la configuracion para publicar `latest.json` y artefactos firmados sin incluir claves privadas en el codigo.

## 0.1.1

- Correccion para que el instalador de Windows no abra una ventana de terminal junto a LexArchivo.
- Eliminados los botones visibles de datos de demostracion de la pantalla principal.
- Corregida la apertura de la ficha al seleccionar un cliente desde la tabla.

## 0.1.0

- Primera version funcional del prototipo LexArchivo.
- Gestion local de clientes, expedientes, parte contraria, abogado contrario, cronologia, documentos, notas, archivo, ajustes y copias de seguridad.
- Acceso con contrasena maestra protegida con Argon2.
- Arquitectura preparada para futuras integraciones de nube, sin conexiones externas activas.
