# Gesto Studio

**Toca con las manos. Produce con IA.**

Gesto Studio une dos proyectos de código abierto en una sola app:

- **[Gesture Synth Weld](https://github.com/rainbow686/gesture-synth-weld)**: un sintetizador que se toca con las manos frente a la cámara (MediaPipe + Tone.js). La mano izquierda elige el acorde y la derecha el volumen, el tono y la octava.
- **[Vibe DAW](https://github.com/cristonj/Vibe-DAW)**: un estudio completo (pistas, piano roll, batería, mezclador) con un agente productor que edita la sesión.

| | |
|---|---|
| App web | https://gesto-studio.unhumanx.workers.dev |
| APK Android | [Descargar la última versión](https://github.com/humanx123/gesto-studio/releases/latest/download/gesto-studio.apk) |
| Página del proyecto | https://humanx123.github.io/gesto-studio/ |

## Qué agrega Gesto Studio

- **Un solo sitio**: el lanzador en `/`, Gesture Synth en `/gesto/` y el estudio en `/studio`. Comparten origen, así que comparten ajustes.
- **Puente manos → estudio**: Gesture Synth recuerda los acordes que mantienes más de medio segundo (`gesture-synth/src/bridge.ts`). El botón «Al estudio» abre Vibe con un pedido listo para el productor («Haz una canción sobre C – G – Am – F…»).
- **Gesto dentro del estudio** (`/studio/#gesto`): una tercera modalidad junto a Agent y Ask en el panel del productor. Tocas pads con las manos (o con las teclas de Gesto) sobre una pista del estudio y **Record live** los graba como un clip MIDI mientras suena la canción. Respeta la configuración de Gesto (grado y calidad con la izquierda, estilo de acorde, octava y volumen con la derecha) y suma tonalidad, sonido (pads, teclados, sintes…), octava, arpegio sincronizado al tempo, bajo automático y cuantización. El lector de acordes es el mismo de Gesture Synth (`gesture-synth/src/chordReader.ts`), importado sin copiar; el motor de Vibe toca con un instrumento "monitor" aparte para no cortar lo que ya suena en la pista (`vibe-daw/src/gesto/`).
- **Groq además de Gemini**: el productor puede usar los modelos abiertos de Groq con tu propia clave (`vibe-daw/src/agent/llm.ts`). Las notas de voz se transcriben con Whisper. La «escucha» de la mezcla sigue siendo solo de Gemini: con Groq esas herramientas fallan con un aviso claro en vez de inventar lo que «oyeron».
- **Ajustes de IA en el inicio**: eliges Gemini o Groq, pegas la clave, se valida y (con Groq) se carga la lista real de modelos de tu cuenta.
- **APK**: un WebView de 20 KB que abre la versión publicada (se actualiza solo), con cámara y micrófono solo para el propio sitio, selector de archivos y exportaciones guardadas en `Descargas/Gesto Studio`.
- Se quitaron Google Analytics, Clarity y AdSense del autor original de Gesture Synth, y el modelo de manos se sirve desde el propio sitio.

Las claves de IA se guardan solo en el navegador o teléfono de cada persona y van directo al proveedor. No hay servidor propio.

## Estructura

```
gesture-synth/   Gesture Synth Weld (Vite + React), servido en /gesto/
vibe-daw/        Vibe DAW (Vite + React), servido en / y /studio
hub/             Lanzador (HTML + JS sin dependencias)
android/         APK (WebView, Java, sin dependencias)
site/            Página del proyecto (Vite + React + motion) → GitHub Pages
scripts/         build.sh arma dist/, deploy.sh lo publica en Cloudflare
```

## Compilar y publicar

```bash
(cd gesture-synth && npm ci) && (cd vibe-daw && npm ci)
scripts/build.sh            # arma dist/
export CLOUDFLARE_ACCOUNT_ID=… CLOUDFLARE_API_TOKEN=…   # token con «Workers Scripts: Edit»
scripts/deploy.sh           # publica dist/ (wrangler.jsonc, archivos estáticos)
```

APK (Android SDK 34, Java 17):

```bash
cd android
./gradlew assembleRelease -PsitioGesto=https://tu-despliegue.workers.dev   # opcional: tu propio sitio
```

Sin `-PfirmaLocal` el APK sale sin firmar; con `-PfirmaLocal` se firma con la llave de depuración del equipo.

Pruebas: `cd gesture-synth && npx vitest run` y `cd vibe-daw && npx vitest run` (incluye `src/agent/llm.groq.test.ts` para el transporte de Groq).

## Estado

Probado: compilación y pruebas de las dos apps (37 + 292, incluidas las del lector de acordes, las tomas en vivo y la sesión de Gesto en el estudio), el transporte de Groq contra respuestas simuladas, el lanzador y el puente de descargas del APK en jsdom, y las rutas del sitio publicado.

**Sin probar todavía en un teléfono real**: la cámara dentro del APK y del modo Gesto del estudio (el seguimiento de manos y el sonido en vivo solo se probaron con simulaciones), las descargas y una conversación de verdad con Groq (no había clave de Groq para probarla). Si algo falla, abre un issue.

## Licencias

Gesture Synth Weld (MIT, © sus autores, `gesture-synth/LICENSE`) y Vibe DAW (MIT, © sus autores, `vibe-daw/LICENSE`). Los cambios de Gesto Studio también son MIT. Esta es una versión comunitaria, no oficial: los textos legales dentro de Vibe describen el servicio original de sus autores. `site/.agent/` contiene el skill [UI UX Pro Max](https://www.npmjs.com/package/uipro-cli) (MIT) usado para diseñar la página.

Hecho xhumanx + IA.
