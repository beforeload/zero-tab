# Zero Tab

**Your tabs, under control.**

Zero Tab replaces Chrome's new tab page with a local-first developer dashboard. It groups open tabs by domain, protects pinned tabs, clears duplicates, saves links for later, and optionally shows a locally ranked AI Builder Daily Report.

No server and no account are required. Open-tab URLs, titles, and saved links stay on the device.

## Features

- Domain-grouped tab dashboard with balanced masonry layout
- Homepages group for Gmail, X, YouTube, LinkedIn, and GitHub
- Exact tab targeting across Chrome windows
- Global and per-domain duplicate cleanup
- Pinned-tab protection
- Saved for later checklist and archive
- Localhost port labels
- macOS-inspired light and dark themes
- Optional AI Builder Daily Report sourced from public Follow Builders feeds
- Optional on-device translation through Chrome's built-in Translator API

## Install locally

1. Clone this repository:

   ```bash
   git clone REPLACE_WITH_REPOSITORY_URL
   cd zero-tab
   ```

2. Open `chrome://extensions`.
3. Enable Developer mode.
4. Click **Load unpacked**.
5. Select the `extension/` directory.

## Privacy

Core tab management makes no external requests. Tab URLs, titles, Saved for later items, read state, and preferences are stored locally using Chrome extension storage.

AI Builder Daily Report is disabled until the user enables it. When enabled, Zero Tab requests optional access to `raw.githubusercontent.com` and downloads three public Follow Builders JSON feeds at most once per local calendar day. No tab, browsing, saved-link, identifier, or API-key data is included in those requests.

Translation uses Chrome's built-in on-device Translator API when available. The language model or language pack may be downloaded by Chrome, but report text is not sent to a third-party translation service by Zero Tab.

See [`store/privacy-policy.md`](store/privacy-policy.md) for the publication-ready privacy policy template.

## Build a Web Store package

```bash
cd extension
zip -r ../dist/zero-tab-webstore-1.2.0.zip . \
  -x "config.local.js" "*.DS_Store"
```

The ZIP root must contain `manifest.json`. Never upload `dist/zero-tab.pem`.

## Technology

- Chrome Manifest V3
- Vanilla JavaScript and CSS
- `chrome.tabs`, `chrome.storage.local`, and Chrome favicon API
- Optional Chrome Translator API
- Web Audio API and CSS animation

## Attribution and license

Zero Tab began as a fork of Zara Zhang's MIT-licensed original project.

Special thanks to [Zara Zhang](https://github.com/zarazhangrui) for the original idea and foundation. Zero Tab is an independent project with a redesigned interface, privacy hardening, safer tab actions, local-first reports, and additional workflow features.

The original copyright and MIT permission notice are preserved in [`LICENSE`](LICENSE) and the packaged [`extension/THIRD_PARTY_NOTICES.txt`](extension/THIRD_PARTY_NOTICES.txt).

Publisher: `REPLACE_WITH_PUBLISHER_NAME`

Support: `REPLACE_WITH_SUPPORT_EMAIL`

Homepage: `REPLACE_WITH_HOMEPAGE_URL`
