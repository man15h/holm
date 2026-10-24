// Claude integration adapter: AI answers in search, with the user's own
// Anthropic API key. By default Holm's server makes the call, so the key never
// reaches the browser; with `calls: browser` the browser keeps the key and
// calls Anthropic itself (src/lib/aiCalls.js).
//
// Surfaces:
//   - answers — a streamed answer to a search, and a conversation from it

import { PROVIDERS, DEFAULT_MODELS } from './ai.js';

/** @type {import('./_types.js').IntegrationAdapter} */
const adapter = {
	id: 'claude',
	name: 'Claude',
	icon: 'di:claude-ai',
	description: 'AI answers in search, with your own Anthropic API key',

	configSchema: [
		{
			key: 'key',
			type: 'secret',
			label: 'API key',
			required: true,
			placeholder: 'sk-ant-…',
			help: '1. Open **API Keys** in the Claude Console\n2. Click **Create Key** and copy it\n\nAn API key is billed per use by Anthropic; a Claude Pro or Max subscription doesn’t cover it.',
			helpUrl: { url: 'https://console.anthropic.com/settings/keys', label: 'Open the Claude Console' }
		},
		{
			key: 'model',
			type: 'text',
			label: 'Model',
			default: DEFAULT_MODELS.claude,
			advanced: true,
			help: 'Haiku is the fastest. Any model id from Anthropic’s models list works.'
		}
	],

	// The calls themselves are shared with the browser, for `calls: browser`.
	browserCalls: true,

	test: (ctx) => PROVIDERS.claude.test(ctx),

	answers: {
		stream: (ctx) => PROVIDERS.claude.stream(ctx),
		modelName: (ctx) => PROVIDERS.claude.modelName(ctx)
	}
};

export default adapter;
