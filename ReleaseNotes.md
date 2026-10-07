# OWLCMS Tracker Release Notes
<!-- markdownlint-disable -->

> #### ⚠ It is recommended to update OWLCMS to the latest stable version when updating Tracker.

## 2.22

- 2.22.3: Results book: session protocols show medals for the registration category only, not the athlete's other participations (requires tracker-core 1.17.3).
- 2.22.3: Results book: sessions are ordered by start time, then platform. ISO session times were previously ignored, which sorted sessions alphabetically.
- 2.22.3: Results and start books: records broken during the meet are identified by the competition dates, as in OWLCMS, so they still appear after the competition is renamed.
- 2.22.3: Medal count, referee assignments, and jury replays: session dates and times sent as ISO strings are now displayed and sorted correctly.
- 2.22.3: Open-ended categories are consistently displayed as `+110`, whether OWLCMS sends `>110` or `110+`.
- 2.22.0: Additiona documents plugin to compute the number of medals needed before a meet.

## 2.21

- 2.21.3: Fix lazy loading of gamx tables
- 2.21.2: `npm run zip`: `--timestamp` is now required to add a timestamp to the semver metadata.
- 2.21.1: Documentation and scripts update.
- 2.21.1: Fetch logos even if database is empty.
- 2.21.0: Added a Celebrations plugin to show an OWLCMS scoreboard and videos on good, bad, and record lifts.
- 2.21.0: Helper texts shown under the fields.

## 2.20

- 2.20.3: Correctly use case-sensitive asset URLs (e.g. for flags).
- 2.20.2: Team rankings can now be limited to top N teams and can be forced to show only total points.
- 2.20.1: Countdown timers resync correctly on reload during a break by anchoring to the server's absolute end time instead of a cached remaining-time snapshot.
- 2.20.0: Use improved tracker-core for initial resource load and spurious connection handling.

## 2.19

- 2.19.6: Fixes for vertical layout and more robust scoreboard timers.
- 2.19.5: Show snatch and clean-and-jerk ranks for three-medal events; fix the leader-from-previous-sessions header.
- 2.19.4: Hide the record block on scoreboards during breaks, ceremonies, and done states when there is no current athlete.
- 2.19.3: Fix behavior and use translations when the announcer goes to "No Session" and starts a new one.
- 2.19.3: Handle record attempts and new records on scoreboards.
- 2.19.2: Handle the before-intro, intro, and before-snatch transitions correctly in scoreboards.
- 2.19.1: Fix scoreboard timer behavior between stop and decision.
- 2.19.0: Scoreboards correctly track closed tabs and log the number of connected users.

## 2.18

- 2.18.12: Idle scoreboard tabs now release their server SSE stream after a five-minute hidden grace period. A hidden or quiet tab flushes everything else about the session after 30 minutes and prompts the user to reload.
- 2.18.11: Authentication fixes; keys are systematically compared. An empty Tracker key disables authentication.
- 2.18.10: Logging cleanup to show at-a-glance status of a simulation feeding Tracker.
- 2.18.9: Standard scoreboards now behave correctly with large sessions and on smaller devices such as phones; also includes portrait-mode fixes.
- 2.18.9: Scoreboards in the default bundle no longer hide the down signal too early.
- 2.18.8: Use the more general label "Open" for opening a plugin from the Options page.
- 2.18.7: Removed an unfinished partial implementation of plugins that would run on server startup. This will be redone with better use cases.
- 2.18.6: Plugin option defaults can now be saved from the options modal using a built-in "Save as Defaults" button. Overrides are persisted as `config-override.json5` with comments and trailing commas. The legacy `config-override.js` format is no longer loaded; re-save defaults from the modal to migrate.
- 2.18.6: Fix a bug where comma-separated string defaults (e.g. `'S,J,U,V'`) were truncated when handling defaults.
- 2.18.5: Move plugin-specific unit tests into their plugin or submodule.
- 2.18.4: Stale provisional records that do not match the current event are no longer included in the results book.
- 2.18.3: Map flag files for countries and North American provinces, states, and territories from the full name to the two-letter jurisdiction or three-letter IOC code. For example, Ontario can be found under `ON.svg` and Australia under `AUS.svg`.
- 2.18.2: Packaged plugins can now provide editable `config-override.js` files for runtime option defaults.
  - Custom zip packaging copies hand-authored override files and generates missing ones for selected plugins with options.
  - OBS packages include override files for install-specific host, path, platform, and scene defaults.
- 2.18.1: Add timestamps to packaged ZIPs because the version number shown is that of Tracker, not the included plugins.
- 2.18.0: Include a marker file indicating that a non-standard build was created using `npm run zip`.
  - The file includes the plugins included, to provide correct warnings or errors when updating/importing.
- 2.18.0: Review the `npm run zip` command options for packaging a custom Tracker.
  - `--standard` includes only the built-in plugins from the default checkout.
  - `--include` adds plugins or extensions by display name.
  - `--include-category` and `--include-categories` add plugins or extensions by the category declared in `config.js`.
  - `--submodule` and `--submodules` add whole submodules.
  - Use commas to separate listed items.
  - Selection is additive.
  - Extensions must be selected explicitly with `--include` or `--include-type`.
  - Selecting an extension automatically pulls in its base plugin.
  - Zip filenames created with `npm run zip` use a stable asset name by default, for example `owlcms-tracker_2.18.0.zip`; pass `--timestamp` to append timestamp metadata.
  - `--name <metadata>` appends control-panel-preserved package metadata before the timestamp, for example `owlcms-tracker_2.18.0+documents.2026-05-12.14h37.zip`.

## 2.17

- 2.17.2: Improve the jury plugin's recording and trimming status display. Requires Replays 2.3.4.
- 2.17.1: Adding plugins requires restarting the server to avoid running `initialize()` too often.
- 2.17.0: Tracker now receives the mapping between country names and IOC country codes.
- 2.17.0: If a team name is a country name and the flag is not available under that name, the flag is looked up using the IOC code.

## 2.16

- 2.16.0: Added the Jury Replays user-interface plugin. Requires Replays 2.2.2.
- 2.16.0: Category ordering can now be overridden and extended. See the top-level `README.md`.

## 2.15

- 2.15.0: Changed the entry-page cards to use a tabbed look and responsive one- or two-column layout.
- 2.15.0: Team scoreboards now allow overriding the SMHF Sinclair and Age Factor options.
- 2.15.0: Tracker now uses Sinclair 2028 if selected in OWLCMS; SMHF retains its own specific options.
- 2.15.0: The Tracker title on the entry page switches to the competition name as soon as it is available.

## 2.14

- 2.14.2: The team-scoreboard toggle between fixed team order and ranking order now works.
- 2.14.1: Team-scoreboard result exports now include membership and body weight.
- 2.14.0: Remove hard-coded timer values and obey directives from OWLCMS.

## 2.13

- 2.13.2: Fix the on-demand database refresh issue.
- 2.13.2: Verify that Championship entities work correctly.
- 2.13.1: Fix a Linux race condition that prevented entry-page cards from showing the full language list.
- 2.13.0: The referee-assignment document plugin now requests a database refresh so it matches master-database changes.

## 2.12

- 2.12.0: Fix packaging of combined plugins with shared content.

## 2.9

- 2.9.0: Remove large unnecessary dependencies specific to some plugins; Puppeteer is no longer included by default.
- 2.9.0: Plugins and extensions can specify additional dependencies that are not part of the base build.
- 2.9.0: Additional dependencies listed by plugins and extensions are included in ZIP distributions.

## 2.8

- 2.8.3: Extensions now inherit the base scoreboard's default values.
- 2.8.3: Refactor the team-scoreboard extension mechanism.
- 2.8.2: Share attempt-bar presentation and backend for unified translations on all scoreboards.
- 2.8.2: Add a thin border to scoreboard flags when the flags contain black.
- 2.8.1: Fix flags for team and standard scoreboards.
- 2.8.0: Support team-scoreboard extensions for additional scoring formulas.

## 2.7

- 2.7: Improve contrast and add visual cues for bad lifts on scoreboards.
- 2.7: Scoreboard translations come from OWLCMS without fallbacks.
- 2.7: Reorganize plugins into subfolders to facilitate connecting submodules with additional plugins, such as IWF Books.
  - Plugins are still shown on entry page based on the category in config.js.
