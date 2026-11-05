# Contributing

Thanks for helping make Holm better.

- **Setup:** `npm install`, then `CONFIG_PATH=config.demo.yml npm run dev`.
- **Tests:** `npm test` runs the unit tests; CI runs it and `npm run build` on every pull request. The Playwright specs in `tests/` expect a dev server on port 5173: run `npx playwright install chromium` once, start `npm run dev`, then run `npx playwright test`.
- **Branches:** open pull requests against `dev`. `main` is the release branch.
- **Changelog:** a pull request doesn't edit [CHANGELOG.md](CHANGELOG.md). If it changes something users will notice, its description carries the line instead, as `Changelog: **Fixed:** …`, written for the people using Holm, one line per change, in the format the changelog's header gives. The `[release]` pull request copies those lines under `## Unreleased`. Released sections are what their "What's new" dialog shows; `## Unreleased` never is.
- **Alphas:** merging a pull request into `dev` whose title contains `[release]` publishes the next `vX.Y.Z-alpha.N`, where `X.Y.Z` is `package.json` and `N` counts up from 1 per version: the git tag, images `:alpha` and `:X.Y.Z-alpha.N` for amd64 and arm64, and a GitHub pre-release listing the commits since the previous tag. Pushing such a tag on a `dev` commit by hand does the same. Other merges into `dev` publish nothing. That pull request changes only `CHANGELOG.md`, plus `package.json` for a version's first alpha: an alpha needs it raised past the latest release, and a test fails while a raised version has no `## Unreleased` section. Holm's update check reads only full releases, so nobody is offered an alpha.
- **Shipping:** a release is a pull request from `dev` into `main`. It must raise `package.json` past the latest `vX.Y.Z` tag and rename `## Unreleased` to `## X.Y.Z — YYYY-MM-DD`; CI refuses anything else, and a test fails if the package version has neither section. Merging it builds the images `:X.Y.Z`, `:latest` and `:stable`, tags `vX.Y.Z` and creates the GitHub release from that version's changelog section. The version is `package.json`'s and nothing else's.
- **Direction:** read [docs/vision.md](docs/vision.md) before a large change. Holm is a glance for everyone in the house, not a server console, so stats and container widgets are out of scope.
- **UI:** build from the tokens in [docs/design-system.md](docs/design-system.md) rather than one-off styles.

Keep pull requests to one change, describe what a user will notice, and include a screenshot for anything visual.
