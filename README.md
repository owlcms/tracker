<!-- markdownlint-disable -->
# OWLCMS Tracker

## Description

A Node.js SvelteKit application that receives real-time competition updates from OWLCMS and displays them through multiple scoreboard types.

## Requirements

This version of the tracker requires **OWLCMS 69** or later. Earlier OWLCMS versions (66, 67, 68) use an older WebSocket protocol (64.0.0) and are refused with a "Protocol Version Mismatch" message.

## Goals

This project aims at giving users of owlcms the capability to create their own scoreboards, TV graphics, and documents.  The program receives the database from owlcms and all lifting order, decisions and timer updates.

Scoreboards can be created using AI agents like ChatGPT, Claude, etc.  The examples in this repository have been built in this way.  The author provided screen shots of existing scoreboards to start the process, and spelled out the required modifications.

## Examples

Since the tracker has the full database available and the current session, it can do team scoreboards.  In this example, the AI assistant was asked to implement grouping by teams, filtering by gender, score totals based on top athletes per team, and even next attempt predictions.  The teams are reordered based on the team score.  There was no actual programming used.  The translation strings are provided by owlcms as part of the initialization.

![example](https://github.com/user-attachments/assets/cccf32f8-3ec9-450b-90ab-f4a76f2f244e)

In this other example, a customized attempt board was created by cloning.  owlcms-tracker includes a replica of the standard attempt board. It was cloned and modified using an AI agent to meet the needs of the federation.

<img width="1896" height="1062" alt="image" src="https://github.com/user-attachments/assets/fb408431-221c-45f6-8802-1d1cf71e5c35" />

Because owlcms-tracker can generate arbitrarily sophisticated HTML and CSS, it is even possible to generate printable documents that
are printed as PDF.  A full IWF-style results book with participants, medals, team points, category rankings, session protocols and records was built this
way.  A sample page follows:

<img width="1284" height="906" alt="image" src="https://github.com/user-attachments/assets/266fda07-a758-4ecf-a6fd-d1926ce84335" />


## Features

- **Multiple Scoreboard Types** - Lifting order, results, team rankings, and more  
- **Multi-FOP Support** - All fields of play from the competition are selectable
- **Simple OWLCMS Setup** - One URL configuration, no code changes to OWLCMS
- **AI-Assisted Development** - Create new scoreboards with AI help  
- **URL-Based Options** - Configure each scoreboard via query parameters  
- **Real-Time SSE Updates** - Instant display of decisions and timer events  
- **Server-Side Processing** - Process once, serve hundreds of browsers

## Documentation

- **For installation, running, and OWLCMS configuration, see [ReleaseNotes.md](./ReleaseNotes.md).**

- **[CREATE_YOUR_OWN.md](./CREATE_YOUR_OWN.md)** - Create custom scoreboards (step-by-step guide)
- **[docs/README.md](./docs/README.md)** - Documentation index and navigation

## Landing Page Categories

The tracker entry page ships with a built-in default category order. You can override it with external JSON without modifying source code.

Override lookup order:
- `categories.json` at the tracker root. This is the simplest option for a local customization, and it is now copied into the packaged zip when present. If you are working from a fork and don't want this file accidentally committed or pushed, mark it as local-only:
  ```bash
  git update-index --skip-worktree categories.json
  ```
- `extensions/landing-page/categories.json`. This is the zip-friendly location for a custom runtime extension when you build a custom zip with additional plugins.

If neither file exists, the built-in default is used.

Supported JSON shape (example):

```json
{
	"categories": [
		"standard",
		"jury",
		{ "category": "documents", "title": "Documents" },
		{ "category": "video-overlay", "hidden": true }
	]
}
```

String entries use the built-in title for known categories. Object entries let you override the section title and set `hidden: true` to suppress a category.

If a plugin declares a category that is not part of the built-in set and not listed in your override, tracker appends it automatically after the configured categories using a title-cased label.

Restart the tracker process after changing either override file.



