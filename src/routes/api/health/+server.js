import { json } from '@sveltejs/kit';
import { getSessionUser } from '$lib/server/session.js';
import { getConfig, getAppsConfig } from '$lib/server/config.js';
import { canSeeApp } from '$lib/server/appAccess.js';
import { healthSource } from '$lib/server/health/config.js';
import { healthFor } from '$lib/server/health/index.js';

// GET /api/health → { apps: { [id]: { state, since?, detail?, source } } }
// The last answer for each app this user can see that has a check. Asking
// never starts a check of its own beyond the one that is due for everyone.

export function GET({ cookies, url }) {
	const user = getSessionUser(cookies, url);
	if (!user) return json({ error: 'Unauthorized' }, { status: 401 });
	const apps = getAppsConfig().filter((app) => canSeeApp(app, user));
	return json({ apps: healthFor(apps, healthSource(getConfig())) }, { headers: { 'cache-control': 'no-store' } });
}
