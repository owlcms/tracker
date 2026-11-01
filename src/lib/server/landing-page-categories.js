import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';
import { logger } from '@owlcms/tracker-core';

export const DEFAULT_LANDING_PAGE_CATEGORIES = [
	{ category: 'standard', title: 'Standard Scoreboards' },
	{ category: 'jury', title: 'Jury' },
	{ category: 'team', title: 'Team Scoreboards' },
	{ category: 'attempt-board', title: 'Attempt Boards' },
	{ category: 'documents', title: 'Documents' },
	{ category: 'remote-control', title: 'Remote Control' },
	{ category: 'video-overlay', title: 'Video Overlays' },
	{ category: 'backup', title: 'Backup and Recovery' }
];

const CATEGORY_OVERRIDE_PATHS = [
	resolve(process.cwd(), 'categories.json'),
	resolve(process.cwd(), 'extensions', 'landing-page', 'categories.json')
];

const defaultTitleByCategory = new Map(
	DEFAULT_LANDING_PAGE_CATEGORIES.map((section) => [section.category, section.title])
);

let cachedConfiguredLandingPageCategories = null;

function cloneCategories(categories) {
	return categories.map((section) => ({ ...section }));
}

function titleCaseCategory(category) {
	return String(category || '')
		.split(/[-_]+/)
		.filter(Boolean)
		.map((part) => part.charAt(0).toUpperCase() + part.slice(1))
		.join(' ');
}

function getDefaultTitle(category) {
	return defaultTitleByCategory.get(category) || titleCaseCategory(category);
}

function toBooleanFlag(value) {
	return value === true;
}

function normalizeLandingPageCategories(rawConfig) {
	const rawCategories = Array.isArray(rawConfig?.categories)
		? rawConfig.categories
		: null;

	if (!rawCategories) {
		return [];
	}

	const seenCategories = new Set();
	const normalized = [];

	for (const entry of rawCategories) {
		let category = '';
		let title = '';
		let hidden = false;

		if (typeof entry === 'string') {
			category = entry.trim();
		} else if (entry && typeof entry === 'object') {
			category = String(entry.category || '').trim();
			title = String(entry.title || '').trim();
			hidden = toBooleanFlag(entry.hidden);
		}

		if (!category || seenCategories.has(category)) {
			continue;
		}

		seenCategories.add(category);
		normalized.push({
			category,
			title: title || getDefaultTitle(category),
			hidden
		});
	}

	return normalized;
}

function appendExtraCategories(categories, scoreboards = []) {
	const mergedCategories = cloneCategories(categories);
	const configuredCategories = new Set(mergedCategories.map((section) => section.category));

	for (const scoreboard of scoreboards) {
		const category = String(scoreboard?.category || '').trim();

		if (!category || configuredCategories.has(category) || defaultTitleByCategory.has(category)) {
			continue;
		}

		configuredCategories.add(category);
		mergedCategories.push({
			category,
			title: getDefaultTitle(category)
		});
	}

	return mergedCategories;
}

function getVisibleCategories(categories) {
	return categories
		.filter((section) => section?.hidden !== true)
		.map(({ hidden, ...section }) => ({ ...section }));
}

function loadLandingPageCategoriesFromDisk() {
	for (const filePath of CATEGORY_OVERRIDE_PATHS) {
		if (!existsSync(filePath)) {
			continue;
		}

		try {
			const parsed = JSON.parse(readFileSync(filePath, 'utf8'));
			const normalized = normalizeLandingPageCategories(parsed);

			if (normalized.length === 0) {
				logger.warn(`[LandingPage] Ignoring empty or invalid category override at ${filePath}`);
				continue;
			}

			logger.info(`[LandingPage] Loaded category override from ${filePath}`);
			return normalized;
		} catch (error) {
			logger.warn(`[LandingPage] Failed to load category override from ${filePath}: ${error.message}`);
		}
	}

	return cloneCategories(DEFAULT_LANDING_PAGE_CATEGORIES);
}

export function loadLandingPageCategories(scoreboards = []) {
	if (!cachedConfiguredLandingPageCategories) {
		cachedConfiguredLandingPageCategories = loadLandingPageCategoriesFromDisk();
	}

	return getVisibleCategories(appendExtraCategories(cachedConfiguredLandingPageCategories, scoreboards));
}