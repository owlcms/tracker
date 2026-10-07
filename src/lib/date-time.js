function dateTimeParts(value) {
	if (Array.isArray(value) && value.length >= 3) {
		const parts = value.slice(0, 5).map(Number);
		return parts.slice(0, 3).every(Number.isFinite) ? parts : null;
	}

	if (typeof value === 'string') {
		const match = value.trim().match(
			/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{1,2}))?/
		);
		if (match) {
			return match.slice(1).map((part) => part === undefined ? undefined : Number(part));
		}
	}

	return null;
}

export function compareDateTimes(left, right) {
	const leftParts = dateTimeParts(left);
	const rightParts = dateTimeParts(right);

	if (!leftParts) return rightParts ? 1 : 0;
	if (!rightParts) return -1;

	for (let index = 0; index < 5; index += 1) {
		const difference = (leftParts[index] ?? 0) - (rightParts[index] ?? 0);
		if (difference !== 0) return difference;
	}
	return 0;
}

export function formatDateISO(value) {
	const parts = dateTimeParts(value);
	if (!parts) return '';
	return `${parts[0]}-${String(parts[1]).padStart(2, '0')}-${String(parts[2]).padStart(2, '0')}`;
}

export function formatTime(value) {
	const parts = dateTimeParts(value);
	if (!parts || parts[3] === undefined || parts[4] === undefined) return '';
	return `${String(parts[3]).padStart(2, '0')}:${String(parts[4]).padStart(2, '0')}`;
}
