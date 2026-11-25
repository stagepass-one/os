# Roadmap

What is planned for the open source packages `@stagepass/cli`, `@stagepass/loader` and `@stagepass/modules`. This is a plan, not a promise: dates are estimates and can move. Work is tracked in GitHub issues; released changes are in [CHANGELOG.md](CHANGELOG.md).

Last updated: 2026-11-25.

## Current releases

| Package | npm `latest` |
| --- | --- |
| `@stagepass/cli` | 2.6.0 |
| `@stagepass/loader` | 2.5.1 |
| `@stagepass/modules` | 2.2.2 |

Releases follow [RELEASING.md](RELEASING.md): stable versions go straight to the npm dist-tag `latest` after a maintainer's 2FA approval.

## Now (2026-11-30 to 2026-12-13)

- Loader 2.5.2: the flag resolves its base URL correctly for short CDN URLs instead of requesting `/flag.min.js` at the CDN root ([#161](https://github.com/stagepass-one/os/issues/161)).
- Default CDN embed: `loader@2` and `modules@2` without `data-stagepass-version`. A pinned version stays a documented option ([#162](https://github.com/stagepass-one/os/issues/162), [#163](https://github.com/stagepass-one/os/issues/163)).
- Modules read `sp.vars` without triggering the flag's public API warning ([#164](https://github.com/stagepass-one/os/issues/164)).
- CLI setup: extract the hostname from a pasted URL, drop the CDN choice prompt from `stagepass new`, fill the footer snippet with the production domain ([#168](https://github.com/stagepass-one/os/issues/168), [#169](https://github.com/stagepass-one/os/issues/169), [#170](https://github.com/stagepass-one/os/issues/170)).
- Upgrade regression: fixture matrix of 2.2.7, 2.3.0 and 2.4.0 projects as a Docker script, required before every CLI release ([#143](https://github.com/stagepass-one/os/issues/143)).
- Loader tests: kill the surviving mutants in the swap and session branches ([#142](https://github.com/stagepass-one/os/issues/142)).
- Small docs rest: author box and the cachebust example in the loader npm README ([#138](https://github.com/stagepass-one/os/issues/138)).
- CLI onboarding: recommend `stagepass build`, `watch` and `dev` before npm scripts ([#139](https://github.com/stagepass-one/os/issues/139)).

## Then (January to February 2027)

- **Modules 2.3, phase 1** ([#129](https://github.com/stagepass-one/os/issues/129)), delivered through `cdn.stagepass.one`:
  - `webflow`: run code when Webflow.js is ready, re-init interactions after loaded content, breakpoints as events, page scoping, never twice.
  - `params`: carry UTM parameters into forms without storing anything on the device.
  - `format`: CMS dates, numbers and currencies in the local format.
  - Housekeeping: cookie events, size budget in CI, one docs page per module.
- Public docs and hosting ([#131](https://github.com/stagepass-one/os/issues/131)), including Webflow Assets as `.js` hosting ([#32](https://github.com/stagepass-one/os/issues/32)).
- CLI package size review ([#140](https://github.com/stagepass-one/os/issues/140)).
- Broader CLI onboarding ([#130](https://github.com/stagepass-one/os/issues/130)).

## Later

- Modules 2.4, phase 2: motion (GSAP bridge), a11y, media, page ([#147](https://github.com/stagepass-one/os/issues/147)).
- Modules 2.5, phase 3: typed CMS lists, storage with expiry and consent category, light forms, an open path for community modules via `sp.use` ([#148](https://github.com/stagepass-one/os/issues/148)).
- Loader: optionally disable `?stagepass=` and start sessions from the console ([#33](https://github.com/stagepass-one/os/issues/33)).
- AI update for project guides ([#132](https://github.com/stagepass-one/os/issues/132)).
- Larger CLI packages tracked since 2.0: [#8](https://github.com/stagepass-one/os/issues/8), [#9](https://github.com/stagepass-one/os/issues/9), [#10](https://github.com/stagepass-one/os/issues/10), [#11](https://github.com/stagepass-one/os/issues/11).

## Module rules

- One file per module, no dependencies, at most 2.5 KB gzip, checked in CI.
- `all.min.js` keeps the current three modules.
- Not planned: CMS filter, sort or search, ready-made UI components, an own animation system.
