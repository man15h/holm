// OpenAI integration adapter: AI answers in search, with the user's own
// OpenAI API key. By default Holm's server makes the call, so the key never
// reaches the browser; with `calls: browser` the browser keeps the key and
// calls OpenAI itself (src/lib/aiCalls.js).
//
// Surfaces:
//   - answers — a streamed answer to a search, and a conversation from it

import { PROVIDERS, DEFAULT_MODELS } from './ai.js';

/** @type {import('./_types.js').IntegrationAdapter} */
const adapter = {
	id: 'openai',
	name: 'OpenAI',
	icon: 'di:openai',
	description: 'AI answers in search, with your own OpenAI API key',

	configSchema: [
		{
			key: 'key',
			type: 'secret',
			label: 'API key',
			required: true,
			placeholder: 'sk-…',
			help: '1. Open **API keys** in the OpenAI platform\n2. Click **Create new secret key** and copy it\n\nAn API key is billed per use by OpenAI; a ChatGPT Plus or Pro subscription doesn’t cover it.',
			helpUrl: { url: 'https://platform.openai.com/api-keys', label: 'Open the OpenAI platform' }
		},
		{
			key: 'model',
			type: 'text',
			label: 'Model',
			default: DEFAULT_MODELS.openai,
			advanced: true,
			help: 'A fast chat model answers best in search. Any model id your key can use works.'
		}
	],

	// The calls themselves are shared with the browser, for `calls: browser`.
	browserCalls: true,

	test: (ctx) => PROVIDERS.openai.test(ctx),

	answers: {
		stream: (ctx) => PROVIDERS.openai.stream(ctx),
		modelName: (ctx) => PROVIDERS.openai.modelName(ctx)
	}
};

export default adapter;
