/**
 * Recovery Checkpoints
 *
 * Pulls recovery checkpoints (export + logs) from OWLCMS into a folder on the tracker machine, so that OWLCMS can be
 * relaunched from that folder if its machine is lost. See OWLCMS compliance/150-SCHEDULED_CHECKPOINTS.md.
 */

export default {
	name: 'Recovery Checkpoints',

	description: 'Copy the competition and its logs from OWLCMS to this machine at regular intervals, ready to relaunch OWLCMS from them.',

	category: 'backup',

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
