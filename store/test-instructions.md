# Chrome Web Store Test Instructions

Zero Tab does not require an account, credentials, payment, or external test environment.

## Core tab management

1. Install the extension.
2. Open several HTTPS pages across two domains, including one duplicate URL.
3. Pin one tab.
4. Open a new tab. Zero Tab replaces the default new-tab page.
5. Verify that tabs are grouped by domain.
6. Click a tab row and confirm Chrome focuses the existing tab.
7. Return to Zero Tab and click **Close duplicate tabs**.
8. Confirm that one copy remains and the pinned tab was not closed.

## Saved for later

1. Hover over a tab row and click the bookmark icon.
2. Confirm the source tab closes and the item appears in Saved for later.
3. Check the item to move it into Archive.

## AI Builder Daily Report

1. Click **Enable AI Builder Daily Report**.
2. Approve the optional `raw.githubusercontent.com` permission.
3. Confirm that public report cards appear.
4. Click a card and confirm it opens the original HTTPS source and becomes visually marked as read.
5. If the test device uses a non-English system language and supports Chrome's Translator API, click **文A** to test on-device translation. This step is optional and depends on Chrome/device support.

## Privacy verification

- No account or publisher endpoint is contacted.
- Core tab management works without enabling the optional report permission.
- Revoking the optional host permission disables feed updates without affecting tab management.
