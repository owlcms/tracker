/**
 * Scoreboard Configuration
 * 
 * Metadata for the "Standard Scoreboard" scoreboard
 */

export default {
	// Display name
	name: 'Standard Scoreboard',
	
	// Description for AI assistants
	description: 'Shows all athletes in session sorted by start number order',
	
	// Category for grouping in the UI
	category: 'standard',
	
	// on the home page, sort order within the category
	order: 100,

	// Whether this scoreboard requires athlete pictures
	requiresPictures: false,
	
	// User-configurable options
	options: [
		{
			key: 'showLeaders',
			label: 'Show Leaders Section',
			type: 'boolean',
			default: true,
			description: 'Display the leaders section on the grid'
		},
		{
			key: 'showRecords',
			label: 'Show Records',
			type: 'boolean',
			default: true,
			description: 'Display competition records'
		},
		{
			key: 'showDecisionSection',
			label: 'Show Decision Section',
			type: 'boolean',
			default: true,
			description: 'Display the bottom decision block line with referee decisions and jury outcomes'
		}
	]
};
