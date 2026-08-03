# Zero Tab Chrome Web Store Publishing Checklist

## Publisher details

- [x] Publisher name: Daniel
- [x] Support email: fe.daniel91@gmail.com
- [x] Repository: https://github.com/beforeload/zero-tab
- [x] Homepage: https://github.com/beforeload/zero-tab
- [x] Privacy policy URL: https://beforeload.github.io/zero-tab/privacy.html

Search before publishing:

```bash
rg "REPLACE_WITH_" .
```

## Developer account

- [ ] Register at the Chrome Developer Dashboard
- [ ] Pay the one-time registration fee shown by Google
- [ ] Enable and verify account security requirements
- [ ] Confirm publisher display name

## Product and package

- [x] Confirm extension name is Zero Tab
- [x] Confirm manifest version is `1.2.0`
- [ ] Run automated tests
- [ ] Load the release package locally and test all features
- [x] Confirm ZIP root contains `manifest.json`
- [x] Confirm ZIP does not contain `.pem`, `.git`, tests, personal config, or `.DS_Store`
- [ ] Keep `dist/zero-tab.pem` private and never upload it

Generate package:

```bash
./store/assets/generate-assets.sh
```

## Store listing

- [x] Prepare 128×128 store icon
- [x] Prepare at least one 1280×800 screenshot
- [x] Prepare required 440×280 small promo tile
- [x] Add English listing copy
- [x] Add Simplified Chinese localization copy
- [ ] Upload assets in the Chrome Developer Dashboard
- [ ] Set category to Productivity
- [ ] Add support email
- [ ] Add homepage URL
- [ ] Add privacy policy URL
- [ ] Enable GitHub Pages from `/docs` so `docs/privacy.html` is reachable

## Privacy practices

- [x] Declare the extension's single purpose
- [x] Explain local handling of tab URLs and titles
- [x] Explain Saved for later storage
- [x] Disclose optional GitHub feed requests
- [x] State that no browsing data is included in feed requests
- [ ] Certify Limited Use compliance in the dashboard
- [x] Confirm no analytics, advertising, or data sale in policy text

## Distribution and review

- [ ] Select target countries
- [ ] Select public/unlisted/private visibility
- [x] Add reviewer test instructions
- [x] Add permission and remote-data review notes
- [ ] Choose automatic or deferred publishing
- [ ] Submit for review
- [ ] Monitor the publisher email for review questions

## Known publication decision

The first release includes AI Builder Daily Report. Its listing and review notes position it as part of one developer-focused new-tab workspace. The Follow Builders data source currently lacks a repository-level license; obtain written permission for public feed display before final publication.

See [`SUBMISSION_GUIDE.md`](SUBMISSION_GUIDE.md) for the full submission walkthrough.
