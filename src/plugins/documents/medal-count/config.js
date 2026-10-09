/**
 * Scoreboard Configuration
 *
 * Metadata for the "Medal Count" document
 */

export default {
	// Display name
	name: 'Medal Count',

	// Description for AI assistants
	description: 'How many gold/silver/bronze medals are needed for each session.',

	// Category for grouping in the UI
	category: 'documents',

	// on the home page, sort order within the category
	order: 105,

	// FOP requirement: false = not used, true = required, 'optional' = show All button
	fopRequired: false,

	// Whether this scoreboard requires athlete pictures
	requiresPictures: false,

	// User-configurable options
	options: [
		{
			key: 'language',
			label: 'Language',
			type: 'select',
			options: 'dynamic:locales',
			default: 'en',
			group: 'general',
			groupLabel: 'General',
			description: 'Choose document text language'
		}
	],

	// This document aggregates the whole competition
	multiPlatform: true
};
