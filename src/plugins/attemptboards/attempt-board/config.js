/**
 * Attempt Board - Full screen display for current athlete
 * 
 * Matches the OWLCMS Attempt Board layout:
 * - Athlete name (last name, first name)
 * - Team name
 * - Start number in colored box
 * - Category
 * - Weight in kg (large, cyan)
 * - Barbell/plates visualization
 * - Attempt info (e.g., "C. & J. #2")
 * - Timer countdown (large, yellow/green)
 * - Decision lights (down signal or referee decisions), jury votes and review votes
 * - Jury Good Lift / No Lift card
 */

export default {
	name: 'Attempt Board',
	description: 'Full-screen display showing current athlete with weight, barbell plates visualization, timer, and decisions. Matches OWLCMS Attempt Board layout.',
	category: 'attempt-board',
	order: 30,
	requiresPictures: false,
	
	options: [
		{
			key: 'showPlates',
			label: 'Show Plates',
			type: 'boolean',
			default: true,
			description: 'Show barbell plate visualization'
		},
		{
			key: 'showTimer',
			label: 'Show Timer',
			type: 'boolean',
			default: true,
			description: 'Show countdown timer'
		},
		{
			key: 'showDecisions',
			label: 'Show Decisions',
			type: 'boolean',
			default: true,
			description: 'Show referee decision lights'
		},
		{
			key: 'showJuryVotes',
			label: 'Show Jury Votes',
			type: 'select',
			options: ['auto', 'true', 'false'],
			default: 'auto',
			description: 'Show the jury circles under the referee lights. auto follows the OWLCMS "jury decisions on attempt board" setting'
		},
		{
			key: 'juryCardSeconds',
			label: 'Jury Card Duration (seconds)',
			type: 'number',
			default: 5,
			min: 0,
			description: 'How long the jury Good Lift / No Lift card stays on screen. 0 turns the card off'
		}
	]
};
