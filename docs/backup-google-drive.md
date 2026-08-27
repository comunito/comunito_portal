# Respaldo e importación de configuración

El portal permite crear un archivo `.cbackup` cifrado con una frase elegida por
el administrador. El archivo contiene los ajustes del Pi: cámaras, URL RTSP,
ROI, parámetros ALPR, whitelist, gate, nombres y ajustes de auditoría.

No contiene lecturas históricas ni video. La frase de respaldo no se almacena
en el Pi ni en Google Drive.

## Respaldo manual

1. Abre `http://IP-DEL-PI:5000/settings`.
2. En **Respaldo de configuración**, escribe una frase de al menos 12
   caracteres y guárdala en un administrador de contraseñas.
3. Selecciona **Crear y descargar respaldo**.
4. Sube el archivo descargado a una carpeta privada de Google Drive.

## Respaldo directo a Google Drive

1. Crea una carpeta privada en Drive llamada, por ejemplo, `Comunito Backups`.
2. Abre el proyecto de Apps Script que contiene
   `Portal-ANPR-AppScript/bitacora_webhook.gs` y reemplaza el archivo.
3. En **Project Settings > Script properties**, crea:
   - `COMUNITO_BACKUP_FOLDER_ID`: ID de la carpeta privada de respaldos.
   - `COMUNITO_BACKUP_SECRET`: un secreto largo y aleatorio.
4. Implementa el proyecto como **Web app**, ejecutado como tu cuenta y con
   acceso para quien tenga el enlace. Copia su URL `/exec`.
5. En cada Pi, pega la URL y el mismo secreto en Settings. Escribe la frase de
   respaldo y selecciona **Crear respaldo en Google Drive**.

Apps Script verifica el secreto y guarda el archivo cifrado en la carpeta
privada. No comparte los archivos públicamente.

## Restaurar en un Pi nuevo

1. Instala el portal desde el repositorio.
2. Abre `/settings`.
3. En **Respaldo de configuración**, selecciona el archivo `.cbackup`.
4. Escribe la misma frase usada al crearlo y selecciona **Importar respaldo**.
5. Comprueba las IP de cámara y el estado de Tailscale antes de dejar el Pi en
   operación.

Antes de importar, el Pi guarda una copia local de su configuración inicial.
