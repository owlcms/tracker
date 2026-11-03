export default {
	name: 'Celebrations',
	description: 'Embeds an OWLCMS Vaadin scoreboard and overlays a result video when its referee decision becomes visible.',
	category: 'celebrations',
	order: 100,
	requiresPictures: false,
	options: [
		{
			key: 'scoreboardUrl',
			label: 'OWLCMS Scoreboard URL',
			type: 'text',
			default: '',
			description: 'Required. OWLCMS Vaadin scoreboard to embed in the full-frame iframe: a path such as /displays/scoreboard?fop=A&token=... (shown through the tracker proxy, recommended) or a full http(s) URL.'
		},
		{
			key: 'localVideoDirectory',
			label: 'Local Celebration Video Directory',
			type: 'text',
			default: '',
			description: 'Optional absolute directory on the Tracker host containing goodLift.mp4, noLift.mp4, and newRecord.mp4. When set, it overrides the separate video URLs.'
		},
		{
			key: 'videoGoodLiftUrl',
			label: 'Good Lift Video URL',
			type: 'text',
			default: '',
			description: 'HTTP(S) video shown for a visible good-lift decision when no local video directory is configured.'
		},
		{
			key: 'videoNoLiftUrl',
			label: 'No Lift Video URL',
			type: 'text',
			default: '',
			description: 'HTTP(S) video shown for a visible no-lift decision when no local video directory is configured.'
		},
		{
			key: 'videoNewRecordUrl',
			label: 'New Record Video URL',
			type: 'text',
			default: '',
			description: 'HTTP(S) video shown for a visible new-record decision when no local video directory is configured.'
		},
		{
			key: 'videoMuted',
			label: 'Mute Celebration Videos',
			type: 'boolean',
			default: true,
			description: 'Muted autoplay is reliable in browser scoreboards. Disable only where browser autoplay policy permits audio.'
		}
	]
};