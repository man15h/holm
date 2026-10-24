import adapter from '@sveltejs/adapter-node';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	kit: {
		adapter: adapter(),
		// SvelteKit adds a nonce for its own inline scripts (and app.html's
		// theme script, via %sveltekit.nonce%). Images, fonts and stylesheets
		// stay open because operators point icons, wallpapers and fonts
		// anywhere; connect-src lists the only hosts the browser calls itself
		// (weather and place search, and Claude or OpenAI set to
		// `calls: browser`).
		csp: {
			mode: 'auto',
			directives: {
				'default-src': ['self'],
				'script-src': ['self'],
				'style-src': ['self', 'unsafe-inline', 'https:'],
				'font-src': ['self', 'https:', 'data:'],
				'img-src': ['self', 'https:', 'http:', 'data:', 'blob:'],
				'media-src': ['self', 'blob:'],
				'connect-src': [
					'self',
					'https://api.open-meteo.com',
					'https://geocoding-api.open-meteo.com',
					'https://nominatim.openstreetmap.org',
					'https://api.anthropic.com',
					'https://api.openai.com'
				],
				'object-src': ['none'],
				'base-uri': ['self'],
				'frame-ancestors': ['none']
			}
		}
	}
};

export default config;
