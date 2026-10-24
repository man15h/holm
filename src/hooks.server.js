import { accessSync, existsSync, mkdirSync, constants } from 'fs';
import { dirname, join } from 'path';
import { getConfig, getIntegrationsConfig, getAppsConfig } from '$lib/server/config.js';
import { healthSource } from '$lib/server/health/config.js';
import { healthFor } from '$lib/server/health/index.js';
import { getMasterKey } from '$lib/server/secrets.js';
import { resolveDbPath } from '$lib/server/db.js';
import { parseFrameAncestors, allowFraming } from '$lib/server/framing.js';
import { clickActionWarnings } from '$lib/apps.js';

// Runs once at startup. Any problem here stops Holm with the reason, rather
// than serving with sign-in off or an encryption key nobody chose.
export function init() {
	const config = getConfig();
	// The data dir holds the DB and, without HOLM_SECRET_KEY, the key file
	// that encrypts integration tokens and signs sessions.
	const dbOn = config.database?.enabled !== false;
	const file = resolveDbPath();
	const dir = dirname(file);
	const needsKeyFile = !process.env.HOLM_SECRET_KEY && !existsSync(join(dir, '.integrations-key'));
	if (dbOn || needsKeyFile) {
		try {
			mkdirSync(dir, { recursive: true });
			accessSync(dir, constants.W_OK);
			if (dbOn && existsSync(file)) accessSync(file, constants.W_OK);
		} catch {
			throw new Error(
				`${dir} is not writable by this process (uid ${process.getuid?.()}). ` +
					'The image runs as the node user (uid 1000): chown -R 1000:1000 the data volume' +
					(dbOn ? '.' : ', or set HOLM_SECRET_KEY (openssl rand -hex 32).')
			);
		}
	}
	getMasterKey();

	// Without default_url, each user picks the server URL, and Holm fetches
	// it from inside your network.
	for (const [id, entry] of Object.entries(getIntegrationsConfig())) {
		if (entry && typeof entry === 'object' && entry.enabled !== false && !entry.default_url) {
			console.warn(`[holm] config: integrations.${id} has no default_url, so users can point it at any http(s) host Holm can reach`);
		}
	}
	for (const entry of parseFrameAncestors(config.security?.frame_ancestors).invalid) {
		console.warn(`[holm] config: security.frame_ancestors entry ${JSON.stringify(entry)} is not an origin like https://dash.example.com, so it is ignored`);
	}
	for (const warning of clickActionWarnings(config.apps)) {
		console.warn(`[holm] config: ${warning}`);
	}
	// The first health checks start now, so an app whose monitor can't be
	// found is named in the log at startup rather than on the first visit.
	healthFor(getAppsConfig(), healthSource(config));
}

// Response headers for every request. The Content-Security-Policy itself is
// in svelte.config.js, where SvelteKit can add per-page nonces to it; only
// its frame-ancestors is changed here, when the operator allows framing.
const SECURITY_HEADERS = {
	'x-frame-options': 'DENY',
	'x-content-type-options': 'nosniff',
	'referrer-policy': 'strict-origin-when-cross-origin'
};

export async function handle({ event, resolve }) {
	let response = await resolve(event);
	try {
		addHeaders(response.headers);
	} catch {
		// A response passed straight through from fetch() has immutable headers.
		response = new Response(response.body, response);
		addHeaders(response.headers);
	}
	return response;
}

function addHeaders(headers) {
	for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
		if (!headers.has(name)) headers.set(name, value);
	}
	allowFraming(headers, parseFrameAncestors(getConfig().security?.frame_ancestors).allowed);
}
