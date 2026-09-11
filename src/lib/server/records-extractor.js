/**
 * Extract records from OWLCMS UPDATE messages.
 * Records come as a JSON string in `fopUpdate.records`
 * Format: {"recordNames":["PanAm"],"recordCategories":["JR 86","SR 86"],"recordTable":[...]}
 * Returns: Array of objects grouped by federation with categories and lift values.
 */
export function extractRecordsFromUpdate(fopUpdate) {
	if (!fopUpdate?.records) {
		return { records: [], personalRecords: null };
	}

	try {
		const recordsData = typeof fopUpdate.records === 'string'
			? JSON.parse(fopUpdate.records)
			: fopUpdate.records;

		// Two possible formats observed from OWLCMS:
		// 1) Index-based flat table (old): recordTable entries with catindex/fedindex/index/value/highlight
		// 2) Block-based table (newer): recordTable is array of blocks { cat, records: [ {SNATCH, CLEANJERK, TOTAL, ...}, ... ] }
		if (!recordsData) return { records: [], personalRecords: null };

		const isBlockFormat = Array.isArray(recordsData.recordTable) && recordsData.recordTable.length > 0 && !!recordsData.recordTable[0]?.records;

		// A numeric record value of 0 is a real standard (challengeable and highlightable),
		// not an absent record. OWLCMS sends a blank string (" ") for a missing record.
		// Only null/undefined and blank strings count as empty.
		const isEmpty = (val) => val === null || val === undefined || (typeof val === 'string' && val.trim() === '');

		if (isBlockFormat) {
			// Normalize block format -> federation -> categories map
			const federations = Array.isArray(recordsData.recordNames) ? recordsData.recordNames : [];
			const recordsByFederation = {}; // { fed: { category: { displayName, S, CJ, T } }}
			let personalRecords = null;

			for (const fed of federations) {
				recordsByFederation[fed] = {};
			}

			for (const block of recordsData.recordTable) {
				const category = block.cat || block.category || '';
				if (!category) continue;

				const blockRecords = Array.isArray(block.records) ? block.records : [];
				if (block.recordClass === 'recordBoxPersonal') {
					const personal = blockRecords[0] || {};
					personalRecords = {
						title: category,
						S: { value: isEmpty(personal.SNATCH) ? '-' : personal.SNATCH, highlight: !!personal.snatchHighlight },
						CJ: { value: isEmpty(personal.CLEANJERK) ? '-' : personal.CLEANJERK, highlight: !!personal.cjHighlight },
						T: { value: isEmpty(personal.TOTAL) ? '-' : personal.TOTAL, highlight: !!personal.totalHighlight }
					};
					continue;
				}

				for (let fedIndex = 0; fedIndex < federations.length; fedIndex++) {
					const fedName = federations[fedIndex];
					const rec = blockRecords[fedIndex] || {};
					if (!recordsByFederation[fedName][category]) {
						recordsByFederation[fedName][category] = { displayName: category, S: { value: '-', highlight: false }, CJ: { value: '-', highlight: false }, T: { value: '-', highlight: false } };
					}

					if (!isEmpty(rec.SNATCH)) {
						recordsByFederation[fedName][category].S = { value: rec.SNATCH, highlight: !!rec.snatchHighlight };
					}
					if (!isEmpty(rec.CLEANJERK)) {
						recordsByFederation[fedName][category].CJ = { value: rec.CLEANJERK, highlight: !!rec.cjHighlight };
					}
					if (!isEmpty(rec.TOTAL)) {
						recordsByFederation[fedName][category].T = { value: rec.TOTAL, highlight: !!rec.totalHighlight };
					}
				}
			}

			// Convert to expected array format
			const records = Object.entries(recordsByFederation)
				.filter(([, data]) => Object.keys(data).length > 0)
				.map(([fedName, data]) => ({ federation: fedName, records: data }));

			return { records, personalRecords };
		}

		// Fallback: index-based flat table format
		if (!recordsData?.recordTable || !recordsData?.recordNames) {
			return { records: [], personalRecords: null };
		}

		const categorySet = new Set();
		const records = [];

		for (const entry of recordsData.recordTable) {
			const category = recordsData.recordCategories?.[entry.catindex];
			const federation = recordsData.recordNames?.[entry.fedindex];

			if (!category || !federation) continue;

			categorySet.add(category);

			const liftType = entry.index % 3 === 0 ? 'S' : entry.index % 3 === 1 ? 'CJ' : 'T';
			let value = entry.value ?? '';
			const highlight = entry.highlight === 1 || entry.highlight === true;

			records.push({
				federation,
				category,
				liftType,
				value: isEmpty(value) ? '-' : value,
				highlight
			});
		}

		const federations = [...new Set(records.map(r => r.federation))];
		const normalizedRecords = federations.map(fed => {
			const fedRecords = records.filter(r => r.federation === fed);
			const categories = [...new Set(fedRecords.map(r => r.category))];

			return {
				federation: fed,
				records: Object.fromEntries(categories.map(cat => {
					const catRecords = fedRecords.filter(r => r.category === cat);
					return [
						cat,
						{
							displayName: cat,
							S: catRecords.find(r => r.liftType === 'S') || { value: '-', highlight: false },
							CJ: catRecords.find(r => r.liftType === 'CJ') || { value: '-', highlight: false },
							T: catRecords.find(r => r.liftType === 'T') || { value: '-', highlight: false }
						}
					];
				}))
			};
		});

		return { records: normalizedRecords, personalRecords: null };
	} catch (error) {
		console.error('[RecordsExtractor] Failed to parse records:', error);
		return { records: [], personalRecords: null };
	}
}
