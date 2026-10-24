// The browser side of AI answers in search: streaming an answer from
// POST /api/ai, and turning its Markdown into safe HTML.

import { marked } from 'marked';

// The server takes up to 20 turns (MAX_MESSAGES in server/integrations/ai.js).
export const MAX_CHAT_MESSAGES = 20;

/**
 * Streams the answer to `messages` (alternating user and assistant, ending
 * with the user), calling `onText` with each piece as it arrives, and
 * `onCutOff` if it stopped at the length limit, `onModel` with the
 * model's name for the byline, and `onUsage` with its { input, output }
 * tokens when the API reports them. Resolves
 * when the answer is whole; throws with the server's message otherwise.
 */
export async function streamAnswer({ messages, integration, signal, onText, onCutOff = () => {}, onModel = () => {}, onUsage = () => {} }) {
	const res = await fetch('/api/ai', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ messages, ...(integration ? { integration } : {}) }),
		signal
	});
	if (!res.ok) {
		const err = await res.json().catch(() => ({}));
		throw new Error(err.error || `HTTP ${res.status}`);
	}
	const reader = res.body.getReader();
	const decoder = new TextDecoder();
	let buffer = '';
	while (true) {
		const { done, value } = await reader.read();
		buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
		const lines = buffer.split('\n');
		buffer = done ? '' : lines.pop();
		for (const line of lines) {
			if (!line.trim()) continue;
			const msg = JSON.parse(line);
			if (msg.error) throw new Error(msg.error);
			if (msg.done) return;
			if (typeof msg.text === 'string') onText(msg.text);
			if (msg.cutOff) onCutOff();
			if (typeof msg.model === 'string') onModel(msg.model);
			if (msg.usage) onUsage(msg.usage);
		}
		if (done) throw new Error('The answer stopped before it was finished');
	}
}

/**
 * The turns to send for a follow-up: every answered exchange, then the new
 * question. An exchange whose answer failed with nothing in it is left out,
 * so the turns still alternate.
 */
export function followUpMessages(history, question) {
	const out = [];
	for (let i = 0; i + 1 < history.length; i += 2) {
		const [q, a] = [history[i], history[i + 1]];
		if (q?.role === 'user' && a?.role === 'assistant' && a.content.trim()) out.push({ role: 'user', content: q.content }, { role: 'assistant', content: a.content });
	}
	out.push({ role: 'user', content: question });
	return out;
}

// DOMPurify loads on first use, in the browser only: the server never renders
// an answer, and its build of DOMPurify brings jsdom.
let purify = null;
let purifyLoading = null;

export function loadPurify() {
	purifyLoading ??= import('isomorphic-dompurify').then(({ default: DOMPurify }) => {
		// Links in an answer open in a new tab, never in place of Holm.
		DOMPurify.addHook('afterSanitizeAttributes', (node) => {
			if (node.tagName === 'A') {
				node.setAttribute('target', '_blank');
				node.setAttribute('rel', 'noopener noreferrer');
			}
		});
		purify = DOMPurify;
		return DOMPurify;
	});
	return purifyLoading;
}

/** Sanitised HTML for an answer's Markdown, or null until DOMPurify is loaded. */
export function answerHtml(markdown) {
	if (!purify) return null;
	return purify.sanitize(marked.parse(markdown || '', { gfm: true, breaks: false }), {
		FORBID_TAGS: ['img', 'style', 'form', 'input', 'button', 'iframe'],
		FORBID_ATTR: ['style']
	});
}
