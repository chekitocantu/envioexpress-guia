# EnvíoExpress — Guía de Llamada (app web / PWA)

App para que los colaboradores de EnvíoExpress registren clientes, sigan la guía de
llamada y agenden sus seguimientos y citas con recordatorios. Los datos se comparten
en la nube (Firebase) entre todo el equipo.

## Qué hace

- **Login del equipo**: todos entran con la **misma cuenta compartida** y ven la misma cartera.
- **Inicio** con dos opciones:
  - **Nuevo cliente** → pide nombre y teléfono, lo guarda como *Contactado* y abre la guía.
  - **Clientes y agenda** → lista de clientes con su estado y los próximos recordatorios.
- **Guía de llamada** de 5 pasos (Apertura → Valor → Escucha/objeciones → Vs competencia → **Resultado**).
- En el paso **Resultado**, según lo que elija el colaborador, cambia el estado del cliente:
  - **Por contactar** → pide fecha/hora del próximo contacto. *Aviso 5 minutos antes.*
  - **Cita presencial** → pide fecha/hora y dirección. *Aviso 1 día antes.*
  - **No interesado** → solo marca el estado.
- **Notificaciones**: del navegador (si das permiso) + aviso visual dentro de la app.

## Datos en la nube (Firebase / Firestore)

- Los clientes se guardan en **Firestore** (base de datos en la nube), bajo la colección `clientes`.
- Todos los colaboradores que entran con la **cuenta compartida** ven y editan **la misma cartera**,
  sincronizada en tiempo real entre dispositivos.
- Funciona **offline**: si se va el internet, sigue funcionando y sincroniza al reconectar.
- La configuración pública del proyecto está en `firebase-init.js` (es segura para el cliente;
  la protección real son las reglas de `firestore.rules` + el login).

**Acceso (cuenta compartida):**
- Correo: `envioexpressmonterrey@outlook.com`
- Contraseña: la que definió el equipo (repártela solo a los colaboradores).

> La contraseña es la llave del equipo. Para cambiarla o agregar/quitar acceso,
> se hace desde la consola de Firebase → Authentication.

## App publicada

GitHub Pages (https, instalable como PWA):
**https://chekitocantu.github.io/envioexpress-guia/**

Ábrela en el móvil y usa **"Agregar a pantalla de inicio"** para instalarla.

## Cómo usarla en local (desarrollo)

Necesita servirse por http(s) (no `file://`) para que carguen Firebase y el service worker.
Como en esta máquina no hay Python/Node, se incluye un servidor mínimo en PowerShell:

```powershell
# dentro de esta carpeta
powershell -ExecutionPolicy Bypass -File .devserver.ps1
# luego abre http://127.0.0.1:8765/
```

## Editar y volver a publicar

```powershell
git add -A
git commit -m "cambios"
git push
```
GitHub Pages actualiza la liga sola en 1–2 minutos.

Para cambiar las reglas de seguridad de la base de datos:
```powershell
firebase deploy --only firestore:rules --project test-7c6c5
```

## Límite importante de las notificaciones

Este es un sitio **estático sin servidor de push**. Por eso:

- Los avisos (5 min antes / 1 día antes) se disparan **mientras la app esté abierta**
  (pestaña o ventana instalada). No pueden saltar con el navegador totalmente cerrado.
- Para no depender solo de eso, la **agenda muestra siempre los próximos recordatorios**
  con su cuenta regresiva.
- El "ya avisé" se recuerda **por dispositivo**, así cada colaborador recibe su propio aviso.

## Archivos

| Archivo | Rol |
|---|---|
| `index.html` | Vistas (login, inicio, guía, agenda), modal y estilos |
| `app.js` | Estado, navegación, resultado, sincronización Firestore y scheduler de avisos |
| `firebase-init.js` | Inicializa Firebase (config pública) y expone `window.FB` |
| `firestore.rules` | Reglas de seguridad: solo usuarios autenticados leen/escriben |
| `firebase.json` / `.firebaserc` | Configuración del proyecto Firebase para la CLI |
| `manifest.webmanifest` | Metadatos de la PWA |
| `sw.js` | Service worker (cache offline del app shell) |
| `icons/` | Iconos de la PWA |

El archivo original `speech html.txt` se conserva como respaldo de la guía inicial.
