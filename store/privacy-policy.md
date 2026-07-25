# Zero Tab Privacy Policy

**Effective date:** July 25, 2026  
**Publisher:** `REPLACE_WITH_PUBLISHER_NAME`  
**Contact:** `REPLACE_WITH_SUPPORT_EMAIL`

Zero Tab is a local-first Chrome extension that replaces the new tab page with a dashboard for organizing open tabs.

## Data Zero Tab handles

Zero Tab processes the following information locally in the browser:

- Open-tab URLs, titles, favicons, window identifiers, pinned state, and active state
- Links and titles saved to the Saved for later checklist
- Local preferences, read states, dismissed report items, translations, and cached public-feed content

This information is required to display the dashboard, focus or close selected tabs, detect duplicates, protect pinned tabs, and restore local state.

## Local storage

Saved links, preferences, AI Builder Daily Report cache, read state, and translations are stored in `chrome.storage.local`. They remain on the user's device until the user clears extension data or uninstalls Zero Tab.

Zero Tab does not operate a server and does not synchronize this local data to the publisher.

## AI Builder Daily Report

AI Builder Daily Report is optional and disabled until the user enables it.

When enabled, Zero Tab requests access only to `https://raw.githubusercontent.com/` and downloads public JSON feeds published by the Follow Builders project. Requests do not include open-tab data, saved links, browsing history, identifiers, credentials, or API keys. As with any HTTPS request, the remote host may receive standard network metadata such as the user's IP address and user agent under its own privacy policy.

Feed content is cached locally and filtered in the browser. Original report text is not sent by Zero Tab to a cloud AI service.

## On-device translation

When supported and explicitly requested by the user, Zero Tab uses Chrome's built-in Translator API. Chrome may download a language pack or on-device model. Zero Tab does not send report text to a third-party translation API.

## Sharing and sale

Zero Tab does not sell, rent, transfer, or share user data with advertisers, data brokers, analytics providers, or the publisher.

Zero Tab does not use user data for advertising, credit decisions, profiling, or purposes unrelated to the extension's user-facing functionality.

## Security

- Extension logic is packaged with the extension; Zero Tab does not execute remotely hosted code.
- Optional feed requests use HTTPS.
- Remote feed strings are treated as untrusted content and rendered without executing scripts.
- Permissions are limited to the functionality described in the Chrome Web Store listing.

## Limited Use

Zero Tab's use of information received from Chrome APIs complies with the Chrome Web Store User Data Policy, including the Limited Use requirements. Chrome API data is used only to provide and improve the extension's single user-facing purpose: a developer-focused new tab workspace.

## User controls

Users can:

- Leave AI Builder Daily Report disabled
- Revoke the optional GitHub host permission in Chrome extension settings
- Remove saved links and report items in the interface
- Clear all extension data through Chrome
- Uninstall Zero Tab to remove its locally stored data

## Third-party content

AI Builder Daily Report displays links and excerpts from public third-party sources. Those sources have their own terms and privacy policies. Zero Tab is not affiliated with those sources unless explicitly stated.

## Changes

This policy may be updated when Zero Tab's behavior changes. The effective date above will be revised, and material changes will be reflected in the Chrome Web Store listing.

## Contact

Questions or privacy requests: `REPLACE_WITH_SUPPORT_EMAIL`
