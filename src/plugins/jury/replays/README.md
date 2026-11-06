# Replays Plugin

This plugin opens the latest replay from a replays server in a dedicated browser player.

## Current behavior

- Loads the latest replay from cameras 1 to 4 using square camera buttons beside the slider.
- Uses the replays server URL configured on the tracker landing page.
- Displays the replay in a full-page video area with a custom seek slider.
- Shows the live replays-server status centered above the slider, including the current athlete when the replays server publishes it on `/ws`.

## Configuration

- `replaysBaseUrl`: base URL of the replays web application, for example `http://localhost:8091`
- If the Video server requires a viewer token, use
  `http://localhost:8091/?token=<token>` as `replaysBaseUrl`. The token is sent
  to the Video API, WebSocket and replay URLs. Treat this URL as a password.
- `enableSlowMotion`: when `true`, shows a `50%` playback button in the timeline popover. Default: `false`

The plugin appends `/replay/{camera}` automatically when you provide the base server URL.

## URL example

`/replays?replaysBaseUrl=http://192.168.1.50:8091`