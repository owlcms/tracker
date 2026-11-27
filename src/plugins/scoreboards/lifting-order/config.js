/**
 * Scoreboard Configuration
 * 
 * Metadata for the "Lifting Order" scoreboard
 */

export default {
	// Display name
	name: 'Lifting Order',
	
	// Description for AI assistants 
	description: 'Shows athletes in the expected lifting order',
	
	// Category for grouping in the UI
	category: 'standard',
	
	// on the home page, sort order within the category
	order: 200,

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
			key: 'showKgLeader',
			label: 'Show kg to Lead',
			type: 'boolean',
			default: true,
			description: 'Display kilograms needed to reach the category leader'
		},
		{
			key: 'showKgDelta',
			label: 'Show kg Up',
			type: 'boolean',
			default: true,
			description: 'Display kilograms needed to move up one medal rank'
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
