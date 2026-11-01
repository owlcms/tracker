/**
 * Checkpoints
 *
 * Pulls checkpoints (export + logs) from OWLCMS into a folder on the tracker machine. The folder can be used to start
 * OWLCMS on another machine. See OWLCMS compliance/150-SCHEDULED_CHECKPOINTS.md.
 */

export default {
	name: 'Checkpoints',

	description: 'Copy the competition and its logs from OWLCMS to a folder on this machine at regular intervals.',

	category: 'checkpoints',

	// on the home page, sort order within the category
	order: 10,

	// works on the whole competition, not on a platform
	fopRequired: false,

	// the page polls the plugin's status itself
	customSSE: true,

	// settings are edited and saved on the plugin page, not in the options dialog
	persistOptions: false,
	options: []
};
