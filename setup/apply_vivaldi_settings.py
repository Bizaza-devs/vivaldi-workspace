"""Configure a Vivaldi profile from a file: Brave-style privacy, macOS theme, CSS mods, web panels.

Usage (Vivaldi must be CLOSED):
    python setup/apply_vivaldi_settings.py

What it does:
- backs up the files it changes (User Data/_settings_backup/<timestamp>/),
- writes only NON-protected settings. It does not touch keys that Chromium protects
  (extensions, developer mode, default search engine, start page),
  because the browser would reset them.
Key names come from the installed Vivaldi's own prefs_definitions.json (8.3).
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
EXTENSION_ID = "cnolniedinhhiafipejmfigkbidglnea"  # derived from the "key" field in manifest.json

WEB_PANELS = [
    ("Gemini Panel", f"chrome-extension://{EXTENSION_ID}/panel.html", False),
    ("Claude", "https://claude.ai/new", True),
    ("Instagram", "https://www.instagram.com/", True),
    ("Shopify", "https://admin.shopify.com/", True),
    ("Metricool", "https://app.metricool.com/", True),
    ("Klaviyo", "https://www.klaviyo.com/dashboard", True),
]

# macOS-style colours (light / dark) with a blue accent
THEMES = {
    "macos-light": dict(base="Vivaldi1", name="macOS light", colorBg="#f5f5f7", colorFg="#1d1d1f",
                        colorAccentBg="#e5e5ea", colorHighlightBg="#0a84ff", colorWindowBg="#ececee"),
    "macos-dark": dict(base="Vivaldi2", name="macOS dark", colorBg="#2c2c2e", colorFg="#f5f5f7",
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
        sys.exit("Vivaldi is running. Close it (including the tray icon), then run this again.")
    if not (PROFILE / "Preferences").exists():
        sys.exit("No Vivaldi profile yet: start Vivaldi once, close it, and run this again.")

    backup = USER_DATA / "_settings_backup" / datetime.now().strftime("%Y%m%d-%H%M%S")
    backup.mkdir(parents=True)
    for p in (USER_DATA / "Local State", PROFILE / "Preferences", PROFILE / "AdBlockState"):
        if p.exists():
            shutil.copy2(p, backup / p.name)

    defs = defaults()
    prefs = load(PROFILE / "Preferences")

    # --- Privacy (Brave-style) ---
    put(prefs, "profile.cookie_controls_mode", 1)                 # block third-party cookies
    put(prefs, "https_only_mode_enabled", True)                   # always HTTPS
    put(prefs, "webrtc.ip_handling_policy", "default_public_interface_only")  # do not leak the local IP
    put(prefs, "search.suggest_enabled", False)                   # typing is not sent to the search engine
    put(prefs, "net.network_prediction_options", 2)               # no preloading
    put(prefs, "enable_do_not_track", False)                      # protects nothing, only adds fingerprinting surface
    put(prefs, "enable_a_ping", False)                            # hyperlink auditing off
    put(prefs, "vivaldi.privacy.block_pings.enabled", True)
    put(prefs, "vivaldi.privacy.autofill.server_assist", False)   # form data is not sent to a server
    put(prefs, "vivaldi.address_bar.search.suggest_enabled", False)
    put(prefs, "vivaldi.address_bar.inline_search.suggest_enabled", False)
    # Google's phishing and malware protection (Safe Browsing) intentionally stays ON.

    # --- Appearance ---
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
    put(prefs, "vivaldi.theme.schedule.enabled", "system")        # follows Windows light/dark mode
    put(prefs, "vivaldi.theme.schedule.o_s", {"light": "macos-light", "dark": "macos-dark"})
    put(prefs, "vivaldi.themes.current", "macos-light")

    # --- Side bar: only our own web panels ---
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

    # --- First run: skip the welcome wizard ---
    put(prefs, "vivaldi.startup.has_seen_welcome_page", True)
    save(PROFILE / "Preferences", prefs)

    # --- Secure DNS (Quad9) ---
    state = load(USER_DATA / "Local State")
    put(state, "dns_over_https.mode", "secure")
    put(state, "dns_over_https.templates", "https://dns.quad9.net/dns-query")
    save(USER_DATA / "Local State", state)

    # --- Tracker and ad blocking: strongest level ---
    # ad-blocking-3: EasyList + EasyPrivacy + Peter Lowe + cookie banner filter + HUfilter (Hungarian list)
    ab_path = PROFILE / "AdBlockState"
    if ab_path.exists():
        ab = load(ab_path)
        ab.setdefault("ad-blocking", {})["global-blocking-category"] = "ad-blocking-3"
        ab_path.write_text(json.dumps(ab, ensure_ascii=False, indent=3), encoding="utf-8")

    print("Done. Backup:", backup)
    print("Web panels:", ", ".join(t for t, _, _ in WEB_PANELS))


if __name__ == "__main__":
    main()
