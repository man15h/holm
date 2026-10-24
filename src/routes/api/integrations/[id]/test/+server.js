import { json } from '@sveltejs/kit';
import { getSessionUser } from '$lib/server/session.js';
import { getAdapter, getOperatorDefaults } from '$lib/server/integrations/index.js';
import { checkUrls, urlOriginChanged, withoutSecrets } from '$lib/server/integrations/urlPolicy.js';
import { getConnection } from '$lib/server/integrations/store.js';
import { isRedacted } from '$lib/server/integrations/serialize.js';
import { withDeadline, describeFetchError } from '$lib/server/integrations/deadline.js';
import { otherAccounts } from '$lib/server/integrations/accounts.js';
import { providerFetch, callsInBrowser } from '$lib/server/integrations/ai.js';

const TEST_TIMEOUT_MS = 8000;

// POST /api/integrations/:id/test   body: { config, account? }
// Runs the adapter's test() against the submitted config WITHOUT persisting
// it. Lets the user verify credentials before clicking Save. Secret fields
// that come back as the redacted bullet string are merged from the stored
// row so users can re-test without re-pasting their API key.

export async function POST({ cookies, url, request, params, fetch }) {
	const user = getSessionUser(cookies, url);
	if (!user) return json({ error: 'Unauthorized' }, { status: 401 });

	const adapter = getAdapter(params.id);
	if (!adapter) return json({ error: 'Unknown integration' }, { status: 404 });

	// With `calls: browser` the browser tests the key itself.
	if (callsInBrowser(adapter, getOperatorDefaults(adapter.id))) {
		return json({ error: 'This integration runs in your browser, and its key stays on your device' }, { status: 409 });
	}

	let body;
	try {
		const text = await request.text();
		if (text.length > 16384) return json({ error: 'Payload too large' }, { status: 413 });
		body = JSON.parse(text);
	} catch {
		return json({ error: 'Invalid JSON' }, { status: 400 });
	}

	const submitted = body?.config || {};
	const existing = await getConnection(user.username, adapter.id);
	// `account` names another account of a Calendar: test against its stored
	// fields, or none for a new one. Without it, the first account.
	const { accounts: _accounts, ...main } = existing?.config || {};
	const account = typeof body?.account === 'string' ? body.account : null;
	const stored = account ? otherAccounts(adapter, existing?.config).find((a) => a.id === account) || {} : main;
	const operator = getOperatorDefaults(adapter.id);
	let checked = checkUrls(adapter, operator, mergeForTest(adapter, stored, submitted));
	if (!checked.ok) return json({ ok: false, message: checked.message });
	// Testing another server never borrows the stored credentials.
	if (urlOriginChanged(adapter, stored, checked.config)) {
		checked = checkUrls(adapter, operator, mergeForTest(adapter, withoutSecrets(adapter, stored), submitted));
	}
	const merged = checked.config;

	try {
		const result = await adapter.test({
			config: merged,
			// The AI providers get a fetch that doesn't send Holm's Origin (ai.js).
			fetch: adapter.answers ? providerFetch(TEST_TIMEOUT_MS) : withDeadline(fetch, TEST_TIMEOUT_MS)
		});
		return json({
			ok: !!result?.ok,
			message: result?.message || (result?.ok ? 'Connection OK' : 'Connection failed')
		});
	} catch (err) {
		return json({ ok: false, message: `Adapter error: ${describeFetchError(err, TEST_TIMEOUT_MS)}` });
	}
}

function mergeForTest(adapter, existing, submitted) {
	const merged = { ...existing };
	for (const field of adapter.configSchema || []) {
		const v = submitted[field.key];
		if (v == null) continue;
		if (field.type === 'secret' && isRedacted(v)) continue;
		merged[field.key] = typeof v === 'string' && field.trim !== false ? v.trim() : v;
	}
	return merged;
}
