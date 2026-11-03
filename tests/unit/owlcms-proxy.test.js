import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import net from 'node:net';
import { WebSocketServer, WebSocket } from 'ws';
import {
	createOwlcmsProxyMiddleware,
	isAllowedProxyRequest,
	setOwlcmsTarget,
	getOwlcmsTarget,
	resolveOwlcmsTarget,
	updateOwlcmsTargetFromConnection
} from '../../src/lib/server/owlcms-proxy.js';
import { normalizeScoreboardUrl } from '../../src/lib/celebrations-scoreboard-url.js';

const req = (headers) => ({ headers });

describe('OWLCMS connection target', () => {
	it('uses the authenticated connection address with the advertised port', () => {
		expect(resolveOwlcmsTarget({ remoteAddress: '::ffff:192.0.2.10', port: 8081, scheme: 'http' }))
			.toBe('http://192.0.2.10:8081');
	});

	it('brackets IPv6 addresses', () => {
		expect(resolveOwlcmsTarget({ remoteAddress: '2001:db8::10', port: 8443, scheme: 'https' }))
			.toBe('https://[2001:db8::10]:8443');
	});

	it('defaults legacy connections to HTTP port 8080', () => {
		expect(resolveOwlcmsTarget({ remoteAddress: '127.0.0.1' })).toBe('http://127.0.0.1:8080');
	});

	it('rejects missing addresses, invalid ports and unsupported schemes', () => {
		expect(resolveOwlcmsTarget({ port: 8080 })).toBeNull();
		expect(resolveOwlcmsTarget({ remoteAddress: '127.0.0.1', port: 0 })).toBeNull();
		expect(resolveOwlcmsTarget({ remoteAddress: '127.0.0.1', scheme: 'file' })).toBeNull();
	});

	it('updates the proxy target from a connection', () => {
		const savedTarget = getOwlcmsTarget();
		try {
			expect(updateOwlcmsTargetFromConnection({ remoteAddress: '::ffff:127.0.0.1', port: 8082 }))
				.toBe('http://127.0.0.1:8082');
			expect(getOwlcmsTarget()).toBe('http://127.0.0.1:8082');
		} finally {
			setOwlcmsTarget(savedTarget);
		}
	});
});

function listen(server) {
	return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
}

function get(port, path, headers = {}) {
	return new Promise((resolve, reject) => {
		http
			.get({ host: '127.0.0.1', port, path, headers }, (res) => {
				let body = '';
				res.on('data', (chunk) => (body += chunk));
				res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
			})
			.on('error', reject);
	});
}

describe('isAllowedProxyRequest (HTTP)', () => {
	const cases = [
		['same-origin iframe', { 'sec-fetch-site': 'same-origin', 'sec-fetch-dest': 'iframe' }, true],
		['same-origin script', { 'sec-fetch-site': 'same-origin', 'sec-fetch-dest': 'script' }, true],
		['same-origin empty (fetch/XHR)', { 'sec-fetch-site': 'same-origin', 'sec-fetch-dest': 'empty' }, true],
		['same-origin without dest', { 'sec-fetch-site': 'same-origin' }, true],
		['same-origin document', { 'sec-fetch-site': 'same-origin', 'sec-fetch-dest': 'document' }, false],
		['none (address bar)', { 'sec-fetch-site': 'none', 'sec-fetch-dest': 'document' }, false],
		['cross-site iframe', { 'sec-fetch-site': 'cross-site', 'sec-fetch-dest': 'iframe' }, false],
		['same-site iframe', { 'sec-fetch-site': 'same-site', 'sec-fetch-dest': 'iframe' }, false],
		['no headers', {}, false]
	];
	for (const [name, headers, expected] of cases) {
		it(`${expected ? 'accepts' : 'refuses'} ${name}`, () => {
			expect(isAllowedProxyRequest(req(headers))).toBe(expected);
		});
	}
});

describe('isAllowedProxyRequest (WebSocket upgrade)', () => {
	const upgrade = { upgrade: true };
	it('accepts same-origin', () => {
		expect(isAllowedProxyRequest(req({ 'sec-fetch-site': 'same-origin' }), upgrade)).toBe(true);
	});
	it('refuses cross-site even when Origin matches Host', () => {
		const headers = { 'sec-fetch-site': 'cross-site', origin: 'http://tracker.test', host: 'tracker.test' };
		expect(isAllowedProxyRequest(req(headers), upgrade)).toBe(false);
	});
	it('refuses none and same-site', () => {
		expect(isAllowedProxyRequest(req({ 'sec-fetch-site': 'none' }), upgrade)).toBe(false);
		expect(isAllowedProxyRequest(req({ 'sec-fetch-site': 'same-site' }), upgrade)).toBe(false);
	});
	it('without Sec-Fetch-Site, accepts Origin host equal to Host', () => {
		const headers = { origin: 'https://tracker.test:8096', host: 'tracker.test:8096' };
		expect(isAllowedProxyRequest(req(headers), upgrade)).toBe(true);
	});
	it('without Sec-Fetch-Site, refuses another Origin', () => {
		const headers = { origin: 'https://evil.test', host: 'tracker.test' };
		expect(isAllowedProxyRequest(req(headers), upgrade)).toBe(false);
	});
	it('without Sec-Fetch-Site, uses x-forwarded-host when present', () => {
		const headers = { origin: 'https://tracker.fly.dev', host: 'internal:8096', 'x-forwarded-host': 'tracker.fly.dev' };
		expect(isAllowedProxyRequest(req(headers), upgrade)).toBe(true);
	});
	it('refuses a missing or malformed Origin', () => {
		expect(isAllowedProxyRequest(req({ host: 'tracker.test' }), upgrade)).toBe(false);
		expect(isAllowedProxyRequest(req({ origin: 'not a url', host: 'tracker.test' }), upgrade)).toBe(false);
		expect(isAllowedProxyRequest(req({}), upgrade)).toBe(false);
	});
});

describe('proxy behaviour', () => {
	let owlcms, other, tracker, wss;
	let owlcmsPort, otherPort, trackerPort;
	let otherHits = 0;
	const sameOrigin = { 'sec-fetch-site': 'same-origin', 'sec-fetch-dest': 'iframe' };
	const savedTarget = getOwlcmsTarget();

	beforeAll(async () => {
		owlcms = http.createServer((request, response) => {
			response.setHeader('X-Frame-Options', 'SAMEORIGIN');
			response.setHeader('Content-Security-Policy', "frame-ancestors 'self'");
			response.setHeader('Content-Type', 'text/plain');
			response.end(`owlcms:${request.url}`);
		});
		wss = new WebSocketServer({ server: owlcms });
		wss.on('connection', (socket) => socket.send('hello from owlcms'));
		other = http.createServer((request, response) => {
			otherHits++;
			response.end('other');
		});
		owlcmsPort = await listen(owlcms);
		otherPort = await listen(other);

		setOwlcmsTarget(`http://127.0.0.1:${owlcmsPort}`);
		const proxy = createOwlcmsProxyMiddleware();
		tracker = http.createServer((request, response) => {
			if (request.url.startsWith('/proxy')) {
				return proxy(request, response, () => {
					response.statusCode = 404;
					response.end('tracker');
				});
			}
			response.end('tracker');
		});
		tracker.on('upgrade', (request, socket, head) => {
			if (request.url.startsWith('/proxy')) proxy.upgrade(request, socket, head);
		});
		trackerPort = await listen(tracker);
	});

	afterAll(async () => {
		setOwlcmsTarget(savedTarget);
		wss.close();
		for (const server of [tracker, owlcms, other]) {
			server.closeAllConnections?.();
			await new Promise((resolve) => server.close(resolve));
		}
	});

	it('forwards to the configured target and strips the /proxy prefix', async () => {
		const response = await get(trackerPort, '/proxy/displays/scoreboard?fop=A', sameOrigin);
		expect(response.status).toBe(200);
		expect(response.body).toBe('owlcms:/displays/scoreboard?fop=A');
	});

	it('ignores _target and never contacts another address', async () => {
		const path = `/proxy/secret?_target=http://127.0.0.1:${otherPort}`;
		const response = await get(trackerPort, path, sameOrigin);
		expect(response.status).toBe(200);
		expect(response.body).toContain('owlcms:/secret');
		expect(response.body).not.toBe('other');
		expect(otherHits).toBe(0);
	});

	it('passes OWLCMS X-Frame-Options and CSP through unchanged', async () => {
		const response = await get(trackerPort, '/proxy/lifting', sameOrigin);
		expect(response.headers['x-frame-options']).toBe('SAMEORIGIN');
		expect(response.headers['content-security-policy']).toBe("frame-ancestors 'self'");
	});

	it('refuses with 403 when Sec-Fetch headers are missing, document or cross-site', async () => {
		for (const headers of [
			{},
			{ 'sec-fetch-site': 'none', 'sec-fetch-dest': 'document' },
			{ 'sec-fetch-site': 'same-origin', 'sec-fetch-dest': 'document' },
			{ 'sec-fetch-site': 'cross-site', 'sec-fetch-dest': 'iframe' }
		]) {
			const response = await get(trackerPort, '/proxy/lifting/announcer', headers);
			expect(response.status).toBe(403);
			expect(response.body).toBe('Forbidden');
		}
	});

	it('proxies a same-origin WebSocket upgrade', async () => {
		const message = await new Promise((resolve, reject) => {
			const socket = new WebSocket(`ws://127.0.0.1:${trackerPort}/proxy/vaadinPush`, {
				headers: { 'sec-fetch-site': 'same-origin' }
			});
			socket.on('message', (data) => {
				resolve(data.toString());
				socket.close();
			});
			socket.on('error', reject);
		});
		expect(message).toBe('hello from owlcms');
	});

	it('proxies a WebSocket upgrade with a matching Origin when Sec-Fetch-Site is absent', async () => {
		const message = await new Promise((resolve, reject) => {
			const socket = new WebSocket(`ws://127.0.0.1:${trackerPort}/proxy/vaadinPush`, {
				headers: { origin: `http://127.0.0.1:${trackerPort}` }
			});
			socket.on('message', (data) => {
				resolve(data.toString());
				socket.close();
			});
			socket.on('error', reject);
		});
		expect(message).toBe('hello from owlcms');
	});

	it('refuses WebSocket upgrades from another origin or without headers with 403', async () => {
		for (const headers of [{ origin: 'http://evil.test' }, { 'sec-fetch-site': 'cross-site' }, {}]) {
			const status = await new Promise((resolve, reject) => {
				const socket = new WebSocket(`ws://127.0.0.1:${trackerPort}/proxy/vaadinPush`, { headers });
				socket.on('unexpected-response', (_request, response) => resolve(response.statusCode));
				socket.on('open', () => reject(new Error('upgrade should have been refused')));
				socket.on('error', () => {});
			});
			expect(status).toBe(403);
		}
	});

	it('does not let the server auto-subscription bypass the gate', async () => {
		const raw = await new Promise((resolve) => {
			const socket = net.connect(trackerPort, '127.0.0.1', () => {
				socket.write(
					'GET /proxy/vaadinPush HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n' +
						'Sec-WebSocket-Version: 13\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n\r\n'
				);
			});
			let data = '';
			socket.on('data', (chunk) => (data += chunk));
			socket.on('close', () => resolve(data));
		});
		expect(raw.startsWith('HTTP/1.1 403')).toBe(true);
	});
});

describe('normalizeScoreboardUrl', () => {
	it('frames an OWLCMS path through the proxy', () => {
		expect(normalizeScoreboardUrl('/displays/scoreboard?fop=A&token=abc')).toBe(
			'/proxy/displays/scoreboard?fop=A&token=abc'
		);
	});
	it('accepts /proxy paths as-is', () => {
		expect(normalizeScoreboardUrl('/proxy/displays/scoreboard?fop=A')).toBe('/proxy/displays/scoreboard?fop=A');
	});
	it('does not treat /proxyfoo as a proxy path', () => {
		expect(normalizeScoreboardUrl('/proxyfoo')).toBe('/proxy/proxyfoo');
	});
	it('keeps accepting full http(s) URLs', () => {
		expect(normalizeScoreboardUrl('http://localhost:8081/displays/resultsSimple')).toBe(
			'http://localhost:8081/displays/resultsSimple'
		);
		expect(normalizeScoreboardUrl('https://owlcms.example/displays/x?fop=A')).toBe(
			'https://owlcms.example/displays/x?fop=A'
		);
	});
	it('refuses empty values, protocol-relative URLs, other schemes and garbage', () => {
		for (const value of ['', '   ', undefined, null, '//evil.test/x', 'javascript:alert(1)', 'ftp://x/y', 'displays/scoreboard']) {
			expect(normalizeScoreboardUrl(value)).toBe('');
		}
	});
});
