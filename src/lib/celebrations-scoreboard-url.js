/**
 * Normalize the celebrations `scoreboardUrl` option into the address of the iframe.
 * - `/proxy/...` is used as-is
 * - `/path?query` (OWLCMS path) is framed through the tracker proxy as `/proxy/path?query`
 * - a full http(s) URL is used as before
 * Anything else yields an empty string.
 */
export function normalizeScoreboardUrl(value) {
	const text = typeof value === 'string' ? value.trim() : '';
	if (!text) {
		return '';
	}

	if (text.startsWith('/')) {
		// "//host/..." is a protocol-relative URL, not an OWLCMS path
		if (text.startsWith('//')) {
			return '';
		}
		if (text === '/proxy' || text.startsWith('/proxy/') || text.startsWith('/proxy?')) {
			return text;
		}
		return `/proxy${text}`;
	}

	try {
		const source = new URL(text);
		if (source.protocol !== 'http:' && source.protocol !== 'https:') {
			return '';
		}
		return source.toString();
	} catch {
		return '';
	}
}
