import { describe, expect, it } from 'vitest';

import { compareDateTimes, formatDateISO, formatTime } from '$lib/date-time.js';

describe('date-time helpers', () => {
	it('handles array and ISO string timestamps consistently', () => {
		expect(formatDateISO([2026, 8, 26, 11, 0])).toBe('2026-08-26');
		expect(formatDateISO('2026-08-26T11:00:00')).toBe('2026-08-26');
		expect(formatTime([2026, 8, 26, 11, 0])).toBe('11:00');
		expect(formatTime('2026-08-26T11:00:00')).toBe('11:00');
	});

	it('orders mixed timestamp representations and puts missing values last', () => {
		expect(compareDateTimes('2026-08-26T11:00:00', [2026, 8, 27, 9, 0])).toBeLessThan(0);
		expect(compareDateTimes([2026, 8, 26, 11, 0], '2026-08-26 11:00')).toBe(0);
		expect(compareDateTimes(null, '2026-08-26T11:00:00')).toBeGreaterThan(0);
	});
});
