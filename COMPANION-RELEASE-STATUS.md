# Companion release status

What is live in each store, next to what is merged and waiting. Update it when
a build reaches a store, so the gap between `main` and customers is written
down somewhere other than someone's memory.

Cutting a build: [apps/companion/STORE-RELEASE.md](./apps/companion/STORE-RELEASE.md).

## Live in the stores

|             | Version | Build | Notes                                                      |
| ----------- | ------- | ----- | ---------------------------------------------------------- |
| App Store   | 1.4.0   | —     | Confirm with `eas build:list --platform ios --limit 1`     |
| Google Play | 1.4.0   | —     | Confirm with `eas build:list --platform android --limit 1` |

Build numbers are deliberately blank rather than guessed: `eas.json` sets
`appVersionSource: "remote"`, so EAS holds them and the repo never sees them.
Fill them in from `eas build:list` when a build ships.

## In flight

**1.5.0 — cut, not yet submitted.**

Eight companion PRs merged since the 1.4.0 build (`0c85873e4`):

| PR    | What a customer gets                                                                       |
| ----- | ------------------------------------------------------------------------------------------ |
| #2934 | Connect the app to a private Shelf server, then sign in against it                         |
| #2944 | Scanner says what happened: cross-workspace jump, repeat scans, kit scans while fulfilling |
| #2953 | Undo a mis-scan during an audit                                                            |
| #2899 | Scans keep the asset's title and whether it was expected                                   |
| #2879 | Audit rows say where the asset is, and surface exceptions                                  |
| #2931 | Land in the workspace last chosen on that device                                           |
| #2942 | Bookings: personal workspace, past days, archive parity                                    |
| #2943 | Account URL, currency on amount fields, QR banner                                          |

Store text: [apps/companion/RELEASE-NOTES-1.5.0.md](./apps/companion/RELEASE-NOTES-1.5.0.md).

## Known gap between a release note and a build

The 1.4.0 notes announced that audit scan rows count notes and photos
separately. That change (#2879) landed two days before the 1.4.0 build was cut
but was not an ancestor of it, so it never shipped — customers were told about
a feature they did not get. It ships for real in 1.5.0, which is why the same
line appears in both files.

The lesson is cheap to apply: write the release notes from what is an ancestor
of the build commit, not from what was merged that week.
