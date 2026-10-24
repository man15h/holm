// Self-hosted AI adapter: AI answers in search from any server that speaks
// the OpenAI chat API (Ollama, LM Studio, vLLM, llama.cpp, LocalAI), so the
// question never leaves the user's network. The key is optional: Ollama and
// most local servers take none.
//
// Surfaces:
//   - answers — a streamed answer to a search, and a conversation from it

import { listOpenAiModels, streamOpenAiChat, stripTrailingSlash, MAX_OUTPUT_TOKENS } from './ai.js';

const NAME = 'The AI server';

/** @type {import('./_types.js').IntegrationAdapter} */
const adapter = {
	id: 'openai_compatible',
	name: 'Self-hosted AI',
	icon: 'di:ollama',
	description: 'AI answers in search from Ollama, LM Studio, vLLM or any OpenAI-compatible server',

	configSchema: [
		{
			key: 'url',
			type: 'url',
			label: 'API URL',
			required: true,
			placeholder: 'http://ollama:11434/v1',
			help: 'The server’s OpenAI-compatible API, ending in **/v1**. Ollama: `http://<host>:11434/v1`. LM Studio: `http://<host>:1234/v1`.',
			fromOperatorDefault: 'default_url'
		},
		{
			key: 'model',
			type: 'text',
			label: 'Model',
			required: true,
			placeholder: 'qwen3:8b',
			help: 'A model the server has, e.g. `qwen3:8b` or `llama3.2`. Press **Test** to list them.'
		},
		{
			key: 'key',
			type: 'secret',
			label: 'API key',
			advanced: true,
			help: 'Only if the server asks for one. Ollama doesn’t.'
		}
	],

	async test({ config, fetch }) {
		if (!config?.url) return { ok: false, message: 'The API URL is required' };
		const model = String(config.model || '').trim();
		try {
			const models = await listOpenAiModels({ base: stripTrailingSlash(config.url), key: config.key, fetch, name: NAME });
			if (!models.length) return { ok: false, message: 'Connected, but the server has no models yet' };
			const list = models.slice(0, 8).join(', ') + (models.length > 8 ? `, and ${models.length - 8} more` : '');
			if (!model) return { ok: false, message: `Connected. Pick a model: ${list}` };
			if (!models.includes(model)) return { ok: false, message: `The server has no model “${model}”. It has: ${list}` };
			return { ok: true, message: `Connected — answers come from ${model}` };
		} catch (err) {
			return { ok: false, message: `Connection failed: ${err.message}` };
		}
	},

	answers: {
		modelName: async ({ config }) => String(config.model || '').trim(),
		stream({ config, system, messages, fetch }) {
			return streamOpenAiChat({
				base: stripTrailingSlash(config.url),
				key: config.key,
				model: String(config.model || '').trim(),
				system,
				messages,
				fetch,
				name: NAME,
				extra: { max_tokens: MAX_OUTPUT_TOKENS }
			});
		}
	}
};

export default adapter;
