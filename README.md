# EnvíoExpress — Guía de Llamada (app web / PWA)

App para que los colaboradores de EnvíoExpress registren clientes, sigan la guía de
llamada y agenden sus seguimientos y citas con recordatorios.

## Qué hace

- **Inicio** con dos opciones:
  - **Nuevo cliente** → pide nombre y teléfono, lo guarda como *Contactado* y abre la guía.
  - **Clientes y agenda** → lista de clientes con su estado y los próximos recordatorios.
- **Guía de llamada** de 5 pasos (Apertura → Valor → Escucha/objeciones → Vs competencia → **Resultado**).
- En el paso **Resultado**, según lo que elija el colaborador, cambia el estado del cliente:
  - **Por contactar** → pide fecha/hora del próximo contacto. *Aviso 5 minutos antes.*
  - **Cita presencial** → pide fecha/hora y dirección. *Aviso 1 día antes.*
  - **No interesado** → solo marca el estado.
- **Notificaciones**: del navegador (si das permiso) + aviso visual dentro de la app.

Los datos se guardan en el navegador (`localStorage`), por lo que persisten al recargar,
pero **viven solo en ese dispositivo y navegador**.

## Cómo usarla en local

- **Rápido:** abre `index.html` con doble clic. Funciona la app y las notificaciones del
  navegador, pero el modo PWA / offline (service worker) **no** se activa con `file://`.
- **Completo (recomendado):** sírvela por http para probar la PWA:
  ```powershell
  # dentro de esta carpeta
  python -m http.server 8000
  ```
  y abre `http://localhost:8000/`.

## Publicar en GitHub Pages (PWA con https)

1. Crea un repositorio en GitHub y sube estos archivos (`index.html`, `app.js`,
   `manifest.webmanifest`, `sw.js`, `icons/`, `README.md`).
2. En el repo: **Settings → Pages**.
3. En *Build and deployment* elige **Deploy from a branch**, rama `main` y carpeta `/ (root)`.
4. Guarda. En 1–2 minutos tu app estará en:
   `https://<tu-usuario>.github.io/<nombre-del-repo>/`
5. Abre esa URL en el móvil y usa **"Agregar a pantalla de inicio"** para instalarla.

> Se necesita **https** (GitHub Pages ya lo da) para instalar la PWA y para que el
> navegador permita notificaciones.

## Límite importante de las notificaciones

Este es un sitio **estático sin servidor de push**. Por eso:

- Los avisos (5 min antes / 1 día antes) se disparan **mientras la app esté abierta**
  (pestaña o ventana instalada). No pueden saltar con el navegador totalmente cerrado.
- Para no depender solo de eso, la **agenda muestra siempre los próximos recordatorios**
  con su cuenta regresiva.
- Si quieres avisos 100% en segundo plano (con el teléfono bloqueado y la app cerrada),
  haría falta un backend con Web Push / un servicio de notificaciones — fuera del alcance
  de esta versión estática.

## Archivos

| Archivo | Rol |
|---|---|
| `index.html` | Vistas (inicio, guía, agenda), modal y estilos |
| `app.js` | Estado, persistencia, navegación, resultado y scheduler de avisos |
| `manifest.webmanifest` | Metadatos de la PWA |
| `sw.js` | Service worker (cache offline) |
| `icons/` | Iconos de la PWA |

El archivo original `speech html.txt` se conserva como respaldo de la guía inicial.
