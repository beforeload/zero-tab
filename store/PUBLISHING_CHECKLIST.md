# Zero Tab Chrome Web Store Publishing Checklist

## Replace placeholders

- [ ] `REPLACE_WITH_PUBLISHER_NAME`
- [ ] `REPLACE_WITH_SUPPORT_EMAIL`
- [ ] `REPLACE_WITH_REPOSITORY_URL`
- [ ] `REPLACE_WITH_HOMEPAGE_URL`
- [ ] `REPLACE_WITH_PRIVACY_POLICY_URL`

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

- [ ] Confirm extension name is Zero Tab
- [ ] Confirm manifest version is higher than the previous upload
- [ ] Run automated tests
- [ ] Load the release package locally and test all features
- [ ] Confirm ZIP root contains `manifest.json`
- [ ] Confirm ZIP does not contain `.pem`, `.git`, tests, personal config, or `.DS_Store`
- [ ] Keep `dist/zero-tab.pem` private and never upload it

## Store listing

- [ ] Upload 128×128 store icon
- [ ] Upload at least one 1280×800 screenshot
- [ ] Upload required 440×280 small promo tile
- [ ] Add English listing
- [ ] Add Simplified Chinese localization
- [ ] Set category to Productivity
- [ ] Add support email
- [ ] Add homepage URL
- [ ] Add privacy policy URL

## Privacy practices

- [ ] Declare the extension's single purpose
- [ ] Explain local handling of tab URLs and titles
- [ ] Explain Saved for later storage
- [ ] Disclose optional GitHub feed requests
- [ ] State that no browsing data is included in feed requests
- [ ] Certify Limited Use compliance
- [ ] Confirm no analytics, advertising, or data sale

## Distribution and review

- [ ] Select target countries
- [ ] Select public/unlisted/private visibility
- [ ] Add reviewer test instructions
- [ ] Add permission and remote-data review notes
- [ ] Choose automatic or deferred publishing
- [ ] Submit for review
- [ ] Monitor the publisher email for review questions

## Known publication decision

The first release includes AI Builder Daily Report. Its listing and review notes position it as part of one developer-focused new-tab workspace. The Follow Builders data source currently lacks a repository-level license; obtain written permission for public feed display before final publication.
