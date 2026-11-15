# Replays Plugin

This plugin opens the latest replay from a replays server in a dedicated browser player.

## Current behavior

- Loads the latest replay from cameras 1 to 4 using square camera buttons beside the slider.
- Uses the replays server URL configured on the tracker landing page.
- Displays the replay in a full-page video area with a custom seek slider.
- Shows the live replays-server status centered above the slider, including the current athlete when the replays server publishes it on `/ws`.

## Configuration

- `replaysBaseUrl`: base URL of the replays web application, for example `http://localhost:8091`
- `replayToken`: viewer token generated in Video, if access tokens are enabled.
  Enter it in the **Replays token** field in the plugin options. It is sent to
  the Video API, WebSocket and replay URLs. An existing `?token=<token>` in
  `replaysBaseUrl` still works; a nonempty `replayToken` takes precedence.
- The separate token is passed to the replay tab in session storage, not in
  its address, and survives a reload of that tab. **Save as Defaults** stores
  it encrypted (AES-256-GCM) with the key in `~/.owlcms/tracker.aes`, created on
  first use. A saved token cannot be decrypted on another computer and must be
  entered again there. A token embedded in `replaysBaseUrl` remains visible in
  the page URL.
- `enableSlowMotion`: when `true`, shows a `50%` playback button in the timeline popover. Default: `false`

The plugin appends `/replay/{camera}` automatically when you provide the base server URL.

## URL example

`/replays?replaysBaseUrl=http://192.168.1.50:8091`