"""Vivaldi-profil beállítása fájlból: Brave-szerű privacy, macOS-téma, CSS-mod, webpanelek.

Használat (a Vivaldi legyen BEZÁRVA):
    python setup/apply_vivaldi_settings.py

Mit csinál:
- mentést készít a módosított fájlokról (User Data/_beallitas_mentes/<időbélyeg>/),
- csak a NEM védett beállításokat írja. A Chromium által védett kulcsokhoz
  (bővítmények, fejlesztői mód, alapértelmezett kereső, kezdőlap) nem nyúl,
  mert azokat a böngésző visszaállítaná.
A kulcsnevek a telepített Vivaldi saját prefs_definitions.json-jából valók (8.3).
"""
import copy
import json
import os
import shutil
import subprocess
import sys
import uuid
from datetime import datetime
from pathlib import Path

LOCAL = Path(os.environ["LOCALAPPDATA"]) / "Vivaldi"
USER_DATA = LOCAL / "User Data"
PROFILE = USER_DATA / "Default"
REPO = Path(__file__).resolve().parent.parent
MODS_DIR = REPO / "vivaldi-mods"
EXTENSION_ID = "cnolniedinhhiafipejmfigkbidglnea"  # a manifest.json "key" mezőjéből

WEB_PANELS = [
    ("Gemini Panel", f"chrome-extension://{EXTENSION_ID}/panel.html", False),
    ("Claude", "https://claude.ai/new", True),
    ("Instagram", "https://www.instagram.com/", True),
    ("Shopify", "https://admin.shopify.com/", True),
    ("Metricool", "https://app.metricool.com/", True),
    ("Klaviyo", "https://www.klaviyo.com/dashboard", True),
]

# macOS-szerű színek (világos / sötét), kék kiemeléssel
THEMES = {
    "macos-light": dict(base="Vivaldi1", name="macOS világos", colorBg="#f5f5f7", colorFg="#1d1d1f",
                        colorAccentBg="#e5e5ea", colorHighlightBg="#0a84ff", colorWindowBg="#ececee"),
    "macos-dark": dict(base="Vivaldi2", name="macOS sötét", colorBg="#2c2c2e", colorFg="#f5f5f7",
                       colorAccentBg="#3a3a3c", colorHighlightBg="#0a84ff", colorWindowBg="#1c1c1e"),
}


def vivaldi_running():
    out = subprocess.run(["tasklist", "/FI", "IMAGENAME eq vivaldi.exe"], capture_output=True, text=True).stdout
    return "vivaldi.exe" in out.lower()


def load(path):
    return json.loads(path.read_text(encoding="utf-8"))


def save(path, data):
    path.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")


def put(d, dotted, value):
    keys = dotted.split(".")
    for k in keys[:-1]:
        d = d.setdefault(k, {})
    d[keys[-1]] = value


def defaults():
    f = next(LOCAL.glob("Application/*/resources/vivaldi/prefs_definitions.json"))
    return load(f)


def main():
    if vivaldi_running():
        sys.exit("A Vivaldi fut. Zárd be (a tálcáról is), aztán futtasd újra.")
    if not (PROFILE / "Preferences").exists():
        sys.exit("Nincs még Vivaldi-profil: indítsd el egyszer a Vivaldit, zárd be, és futtasd újra.")

    backup = USER_DATA / "_beallitas_mentes" / datetime.now().strftime("%Y%m%d-%H%M%S")
    backup.mkdir(parents=True)
    for p in (USER_DATA / "Local State", PROFILE / "Preferences", PROFILE / "AdBlockState"):
        if p.exists():
            shutil.copy2(p, backup / p.name)

    defs = defaults()
    prefs = load(PROFILE / "Preferences")

    # --- Privacy (Brave-szerűen) ---
    put(prefs, "profile.cookie_controls_mode", 1)                 # harmadik féltől származó sütik tiltása
    put(prefs, "https_only_mode_enabled", True)                   # mindig HTTPS
    put(prefs, "webrtc.ip_handling_policy", "default_public_interface_only")  # helyi IP nem szivárog
    put(prefs, "search.suggest_enabled", False)                   # gépelés nem megy a keresőhöz
    put(prefs, "net.network_prediction_options", 2)               # nincs előtöltés
    put(prefs, "enable_do_not_track", False)                      # semmit nem véd, csak ujjlenyomat
    put(prefs, "enable_a_ping", False)                            # hyperlink-auditálás ki
    put(prefs, "vivaldi.privacy.block_pings.enabled", True)
    put(prefs, "vivaldi.privacy.autofill.server_assist", False)   # űrlapadat nem megy szerverre
    put(prefs, "vivaldi.address_bar.search.suggest_enabled", False)
    put(prefs, "vivaldi.address_bar.inline_search.suggest_enabled", False)
    # A Google adathalász- és kártevővédelme (safebrowsing) szándékosan BE marad.

    # --- Megjelenés ---
    put(prefs, "vivaldi.appearance.css_ui_mods_directory", str(MODS_DIR))
    put(prefs, "vivaldi.status_bar.display", "off")
    system_themes = {t["id"]: t for t in defs["vivaldi"]["themes"]["system"]["default"]}
    user_themes = [t for t in prefs.get("vivaldi", {}).get("themes", {}).get("user", []) if t.get("id") not in THEMES]
    for tid, spec in THEMES.items():
        t = copy.deepcopy(system_themes[spec["base"]])
        t.update({k: v for k, v in spec.items() if k != "base"})
        t.update(id=tid, accentFromPage=False, accentOnWindow=False, preferSystemAccent=False, radius=10)
        user_themes.append(t)
    put(prefs, "vivaldi.themes.user", user_themes)
    put(prefs, "vivaldi.theme.schedule.enabled", "system")        # a Windows világos/sötét módját követi
    put(prefs, "vivaldi.theme.schedule.o_s", {"light": "macos-light", "dark": "macos-dark"})
    put(prefs, "vivaldi.themes.current", "macos-light")

    # --- Oldalsáv: csak a saját webpanelek ---
    web = defs["vivaldi"]["panels"]["web"]
    old_elements = prefs.get("vivaldi", {}).get("panels", {}).get("web", {}).get("elements", web["elements"]["default"])
    keep = {e["url"]: e for e in old_elements}
    elements, panel_ids = [], []
    for title, url, mobile in WEB_PANELS:
        e = keep.get(url) or {"id": f"WEBPANEL_{uuid.uuid4()}", "url": url, "zoom": 1}
        e.update(title=title, mobileMode=mobile)
        elements.append(e)
        panel_ids.append(e["id"])
    removed = [e["id"] for e in old_elements if e["id"] not in panel_ids]
    removed += [e["id"] for e in web["elements"]["default"] if e["id"] not in panel_ids and e["id"] not in removed]
    put(prefs, "vivaldi.panels.web.elements", elements)
    put(prefs, "vivaldi.panels.web.removed_elements", removed)
    put(prefs, "vivaldi.panels.web.items", [])
    put(prefs, "vivaldi.panels.web.removed_items", [i["id"] for i in web["items"]["default"]])
    put(prefs, "vivaldi.toolbars.panel",
        ["PanelBookmarks", "PanelDownloads", "PanelHistory", "Divider", *panel_ids, "PanelWeb", "FlexibleSpacer"])

    # --- Első indítás: az üdvözlő varázsló már ne jöjjön ---
    put(prefs, "vivaldi.startup.has_seen_welcome_page", True)
    save(PROFILE / "Preferences", prefs)

    # --- Biztonságos DNS (Quad9) ---
    state = load(USER_DATA / "Local State")
    put(state, "dns_over_https.mode", "secure")
    put(state, "dns_over_https.templates", "https://dns.quad9.net/dns-query")
    save(USER_DATA / "Local State", state)

    # --- Tracker- és hirdetésblokkolás: a legerősebb szint ---
    # ad-blocking-3: EasyList + EasyPrivacy + Peter Lowe + sütibanner-szűrő + magyar HUfilter
    ab_path = PROFILE / "AdBlockState"
    if ab_path.exists():
        ab = load(ab_path)
        ab.setdefault("ad-blocking", {})["global-blocking-category"] = "ad-blocking-3"
        ab_path.write_text(json.dumps(ab, ensure_ascii=False, indent=3), encoding="utf-8")

    print("Kész. Mentés:", backup)
    print("Webpanelek:", ", ".join(t for t, _, _ in WEB_PANELS))


if __name__ == "__main__":
    main()
