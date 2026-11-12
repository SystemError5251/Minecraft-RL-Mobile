# Kantenhain

Voxel-Spiel für den mobilen Browser (WebGL2, ohne Abhängigkeiten) mit Shader-Grafik: Lichtstrahlen, Dunst, spiegelndes Wasser und gemalte Blocktexturen. Alle Texturen entstehen prozedural per Node-Script – es werden keine fremden Bilder verwendet.

## Starten

```
npm start          # erzeugt die Texturen und startet http://localhost:8080
npm run build      # nur Texturen neu erzeugen (assets/tex64.bin, assets/tex128.bin)
npm run screenshots  # Vergleichsbilder Niedrig/Ultra (benötigt Playwright + Chromium)
```

Das Projekt ist eine rein statische Seite (`index.html`, `src/`, `assets/`) und läuft auf jedem Static-Hosting.

Steuerung (Touch, fürs Hochformat ausgelegt): Joystick links unten, rechts unten Tasten für Setzen, Abbauen und Springen (gedrückt halten wiederholt), überall sonst wischen zum Umsehen. Am PC: WASD, Maus, Linksklick abbauen, Rechtsklick setzen, 1–9/Mausrad für die Leiste, M/Esc für das Menü.

## Android-App (Hochformat)

`android/` enthält eine schlanke WebView-Hülle: Vollbild, fest im Hochformat, ohne Internetzugriff – die Spieldateien liegen in der APK. Eine fertige Debug-APK liegt unter `dist/Kantenhain-debug.apk` (Android 8.0+, WebGL2 nötig).

```
cd android
ANDROID_HOME=/pfad/zum/android-sdk gradle assembleDebug   # -> app/build/outputs/apk/debug/app-debug.apk
```

Benötigt JDK 17+, Gradle 8.13+ sowie Android-SDK-Plattform 35 und Build-Tools 35. Für eine Veröffentlichung im Play Store ist ein Release-Build mit eigenem Signaturschlüssel nötig.

## Grafik

| | Niedrig | Mittel | Hoch | Ultra |
|---|---|---|---|---|
| Texturen (Texture-Array, Mipmaps, anisotrop) | 64 px | 64 px | 64 px | 128 px |
| Normal-Maps + Roughness | – | ✓ | ✓ | ✓ |
| Schatten (CSM, weiches PCF) | – | 1 Kaskade | 2 Kaskaden | 2 Kaskaden |
| Lichtstrahlen (radialer Blur) | – | ¼ Auflösung | ¼ Auflösung | ½ Auflösung |
| Bloom | – | – | ✓ | ✓ |
| Wasser | einfache Wellen | Normal-Map, Fresnel, Glitzer | + Refraktion | + Screen-Space-Reflections |
| Parallax-Mapping | – | – | – | ✓ |
| Gras-/Blumenbüschel (Radius) | – | 22 | 34 | 48 |
| Wolkenschichten | 1 | 1 | 2 | 2 |
| Sichtweite (Chunks) | 5 | 7 | 9 | 12 |

Immer aktiv: Höhen- und Distanznebel mit Sonnenstreuung, Smooth Lighting + Vertex-AO, ACES-Tonemapping, warme Farbkorrektur.

Bloom und Lichtstrahlen laufen in einem gemeinsamen Pass in reduzierter Auflösung; ohne Post-Effekte (Niedrig) wird direkt in den Framebuffer gezeichnet. Jeder Effekt ist im Menü einzeln abschaltbar. Die Auto-Qualität schaltet bei unter 40 FPS nacheinander ab: SSR → Lichtstrahlen → Schatten → Bloom, danach Parallax, Auflösung, Grasdichte.

## Screenshots (Niedrig / Ultra)

| Szene | Niedrig | Ultra |
|---|---|---|
| Wiese mit Hügeln und Wolken (Mittag) | ![](screenshots/wiese-mittag_niedrig.jpg) | ![](screenshots/wiese-mittag_ultra.jpg) |
| Sumpf bei Sonnenaufgang | ![](screenshots/sumpf-sonnenaufgang_niedrig.jpg) | ![](screenshots/sumpf-sonnenaufgang_ultra.jpg) |
| Waldsee mit Blumen im Gegenlicht | ![](screenshots/waldsee-gegenlicht_niedrig.jpg) | ![](screenshots/waldsee-gegenlicht_ultra.jpg) |
| Block-Showcase | ![](screenshots/block-showcase_niedrig.jpg) | ![](screenshots/block-showcase_ultra.jpg) |

Die Szenen lassen sich direkt öffnen: `index.html?scene=meadow|swamp|forest|showcase&q=low|medium|high|ultra` (mit `&shot=1` als feste Kamera ohne HUD).

## Aufbau

- `tools/gen-textures.mjs` – Textur-Generator (Farbe, Normal, Roughness, Höhe, Emissive je Block)
- `src/worldgen.js`, `src/mesher.js`, `src/worker.js` – Welt und Meshes im Web Worker
- `src/renderer.js`, `src/shaders.js` – Render-Pipeline
- `src/settings.js` – Qualitätsstufen, Einzelschalter, Auto-Qualität
