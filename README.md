# vivaldi-workspace

Saját, letisztult böngészőkörnyezet Vivaldi alapon: Brave-szerű privacy-beállítások, macOS-stílusú felület és egy saját Gemini-panel.

## Tartalom

| Mappa | Mi ez |
|---|---|
| `extension/` | **Gemini Panel** – Manifest V3 bővítmény (Vivaldi, Edge, Brave, Chrome) |
| `vivaldi-mods/` | `macos.css` – a Vivaldi felületét módosító CSS |

## Gemini Panel

- Chat a Gemini API-val, streamelt válasszal, Markdown-megjelenítéssel.
- **Automatikus modellválasztás:** rövid kérdésre a gyors modell (Flash-Lite), munkára, elemzésre, kódra vagy hosszú üzenetre az erős (Flash, fizetős kulccsal Pro). A fejlécben kézzel is váltható (Auto / Gyors / Erős). Ha az erős modell nem elérhető (limit, jogosultság), a gyors válaszol.
- **Oldal csatolása** (gemkapocs), vagy jobb klikk: *Kérdezd a Geminit a kijelölésről* / *Oldal összefoglalása*.
- Megnyitás: ikon vagy **Alt+G** – külön kis ablakban (Vivaldi) vagy oldalpanelben (Chrome-szerű böngészők). Vivaldi-webpanelként is betölthető (a cím a beállításokban látszik).
- A modellek listáját a kulcsból tölti le, így nem kell kézzel modellnevet írni.

### Telepítés

1. `vivaldi://extensions` → **Fejlesztői mód** be → **Kicsomagolt bővítmény betöltése** → az `extension` mappa.
2. A panelen: Beállítások → API-kulcs (<https://aistudio.google.com/apikey>) → **Kulcs ellenőrzése és modellek betöltése**.

### Adatkezelés

- Az API-kulcs és a beszélgetés csak a böngésző helyi tárában van (`chrome.storage.local`), szinkron nincs.
- Az oldal tartalmát csak gombnyomásra vagy jobb klikkre olvassa be; az összes oldal olvasásához egyszer engedélyt kér.
- Hálózati kapcsolat csak a `generativelanguage.googleapis.com` felé megy.
- **Ingyenes kulcsnál a Google felhasználhatja a beküldött tartalmat** a termékei fejlesztésére; fizetős szinten nem. Érzékeny oldalt ingyenes kulccsal ne küldj el.

### Fájlok

| Fájl | Szerep |
|---|---|
| `manifest.json` | jogosultságok, Alt+G, oldalpanel |
| `background.js` | ikon, jobb klikkes menü, ablak / oldalpanel nyitása |
| `panel.html` / `panel.css` / `panel.js` | a chat felülete és logikája |
| `gemini.js` | Gemini API: modellek listája, javasolt modellpár, streamelt válasz |
| `md.js` | kicsi, biztonságos Markdown-megjelenítő (előbb escape-el) |
| `extract.js` | az oldal szövegének kinyerése |
| `store.js` | tároló (`chrome.storage.local`, előnézetben `localStorage`) |

Előnézet bővítmény nélkül (csak a kinézet, API-hívás nélkül):

```powershell
python -m http.server 5174 --directory extension
```

## Vivaldi CSS

`vivaldi://experiments` → *Allow for using CSS modifications* → Beállítások → Megjelenés → *Custom UI Modifications* → a `vivaldi-mods` mappa → Vivaldi újraindítása.
A Vivaldi belső osztálynevei változhatnak; ami nem talál, az egyszerűen nem hat.
