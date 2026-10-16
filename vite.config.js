import tailwindcss from '@tailwindcss/vite';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig, loadEnv } from 'vite';

// The launcher's emoji search loads Emojibase's data on demand. Keep only
// the fields it reads: skin-tone variants and ordering numbers are half
// the file, and the trimmed chunk stays under Vite's 500 kB warning.
function trimEmojiData() {
	return {
		name: 'trim-emoji-data',
		enforce: 'pre',
		transform(code, id) {
			if (!/emojibase-data\/en\/compact\.json$/.test(id)) return null;
			const trimmed = JSON.parse(code)
				.filter((e) => e.group !== undefined && e.group !== 2)
				.map(({ hexcode, label, unicode, group, tags }) => ({ hexcode, label, unicode, group, tags }));
			return { code: JSON.stringify(trimmed), map: null };
		}
	};
}

export default defineConfig(({ mode }) => {
	// Load all .env vars into process.env so server-side config.yml
	// ${VAR} substitution works in dev mode.
	const env = loadEnv(mode, process.cwd(), '');
	Object.assign(process.env, env);

	return {
		plugins: [trimEmojiData(), tailwindcss(), sveltekit()],
		server: {
			host: true,
			allowedHosts: true
		}
	};
});
