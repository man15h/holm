import { prefs } from '$lib/stores/prefs.js';
import { clearAllLocal } from '$lib/aiCalls.js';

// The search bar's commands: run with !bang or found by name.
// Icon SVG strings are pre-rendered paths (fed into a <svg> wrapper in the row).
const ICONS = {
	settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>',
	theme: '<circle cx="12" cy="12" r="5"/><path d="M12 1v2m0 18v-2M4.22 4.22l1.42 1.42m12.72 12.72-1.42-1.42M1 12h2m18 0h-2M4.22 19.78l1.42-1.42M18.36 5.64l-1.42 1.42"/>',
	icon: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
	wall: '<rect width="18" height="18" x="3" y="3" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/>',
	logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>'
};

// wallpapers: how many there are, 0 when they're off.
export function buildActions({ wallpapers, onSettingsOpen }) {
	return [
		{ id: 'settings', bang: 'settings', label: 'Open Configure', keywords: ['settings', 'preferences', 'integrations', 'widgets'], icon: ICONS.settings, exec: onSettingsOpen },
		// manual: never auto-runs on the last keystroke; needs Enter or a click
		{ id: 'logout', bang: 'logout', label: 'Log out', keywords: ['sign out', 'logout'], icon: ICONS.logout, manual: true, exec: () => { clearAllLocal(); window.location.href = '/auth/logout'; } },
		// Wallpapers only show in the Dynamic theme, so switch to it; otherwise
		// the pick is saved under Light/Dark and nothing visibly changes.
		...(wallpapers ? [{
			id: 'wall', bang: 'wall', label: 'Pick a random wallpaper', keywords: ['wallpaper', 'background', 'shuffle'], icon: ICONS.wall,
			exec: () => {
				const next = Math.floor(Math.random() * wallpapers) + 1;
				prefs.update((p) => ({ ...p, wallpaperId: next, wallpaperEnabled: true, theme: 'auto' }));
			}
		}] : []),
		// 'auto' is the stored value; Configure calls it Dynamic, so both work.
		...[['dark', 'Dark'], ['light', 'Light'], ['auto', 'Dynamic']].map(([t, name]) => ({
			id: `theme-${t}`, bang: 'theme', arg: t, argAlias: name.toLowerCase(), label: `Theme: ${name}`, keywords: [t, name.toLowerCase(), `${t} mode`], icon: ICONS.theme,
			exec: () => prefs.update((p) => ({ ...p, theme: t }))
		})),
		...['colored', 'white', 'grayed'].map((s) => ({
			id: `icon-${s}`, bang: 'icon', arg: s, label: `Icon style: ${s[0].toUpperCase()}${s.slice(1)}`, keywords: [`${s} icons`], icon: ICONS.icon,
			exec: () => prefs.update((p) => ({ ...p, iconStyle: s }))
		}))
	];
}

// "!theme dark" → the commands with that bang, narrowed by the argument.
export function matchBang(actions, query) {
	const s = (query || '').trimStart();
	if (!s.startsWith('!')) return [];
	const m = s.match(/^!([a-zA-Z0-9_-]+)(?:\s+(.*))?$/);
	if (!m) return [];
	const bang = m[1].toLowerCase();
	const argFilter = (m[2] || '').trim().toLowerCase();
	const hits = actions.filter((a) => a.bang === bang);
	if (!hits.length) return [];
	if (!argFilter) return hits;
	return hits.filter((a) => !a.arg || a.arg.includes(argFilter) || a.argAlias?.includes(argFilter));
}
