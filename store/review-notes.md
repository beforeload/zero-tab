# Chrome Web Store Review Notes

## Single purpose

Zero Tab is a developer-focused new-tab workspace. Its features serve that single purpose:

- Organize and navigate open work tabs
- Close exact tabs and duplicates
- Save work links for later
- Surface an optional developer-industry report in the same new-tab workspace

## Permissions

### `tabs`

Required to read tab titles and URLs, group tabs, focus an existing tab across windows, detect exact duplicates, and close user-selected tabs. Zero Tab protects pinned tabs from bulk actions.

### `storage`

Required to store Saved for later items, archive state, UI preferences, report cache, read state, and optional local translations.

### `favicon`

Required to display Chrome's local favicon representation without sending tab hostnames to a third-party favicon service.

### Optional host permission: `https://raw.githubusercontent.com/*`

Requested only after the user clicks **Enable AI Builder Daily Report**. Used only to fetch these public data files:

- `zarazhangrui/follow-builders/main/feed-x.json`
- `zarazhangrui/follow-builders/main/feed-podcasts.json`
- `zarazhangrui/follow-builders/main/feed-blogs.json`

The files contain data, not executable logic. All parsing, ranking, rendering, and interaction logic is packaged in the extension.

No tab data, saved links, identifiers, credentials, or API keys are transmitted in these requests.

## Remote code

Zero Tab does not download or execute remotely hosted code. The optional GitHub resources are JSON content feeds only.

## Built-in AI

Zero Tab may use Chrome's documented built-in Translator API after an explicit user action. Translation is optional, device-dependent, and performed by Chrome's on-device capability. Zero Tab does not include a cloud AI SDK or API key.

## Data handling

Open-tab data is processed locally. Zero Tab has no publisher-operated backend, analytics, advertising, or account system. See the linked privacy policy for full disclosure.

## Attribution

Zero Tab is an independent derivative of Zara Zhang's MIT-licensed original project. The original copyright and permission notice are included in `THIRD_PARTY_NOTICES.txt`.
