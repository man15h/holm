<script>
	import { dialog } from '$lib/actions/dialog.js';
	import { portal } from '$lib/actions/portal.js';
	import { getContext } from 'svelte';
	import { prefs } from '$lib/stores/prefs.js';
	import { buildAppsFromConfig, resolveIcon } from '$lib/apps.js';
	import IntegrationsPanel from '$lib/components/IntegrationsPanel.svelte';
	import AppIcon from '$lib/components/AppIcon.svelte';
	import { integrations as integrationsStore } from '$lib/stores/integrations.js';
	import { getWallpaperThumbUrl } from '$lib/wallpaper.js';
	import { browser } from '$app/environment';
	import { confirmDiscardUnsaved } from '$lib/unsaved.js';
	import { DEFAULT_TIME_FORMAT, DEFAULT_TEMP_UNIT, TIME_FORMATS, TEMP_UNITS } from '$lib/units.js';
	import UnitPicker from '$lib/components/UnitPicker.svelte';
	import { SEARCH_ON_FOCUS, searchOnFocus } from '$lib/searchOnFocus.js';
	import { SEARCH_TRANSPARENCY, SEARCH_HINTS, searchTransparency, searchHints } from '$lib/searchLook.js';

	const siteConfig = getContext('config');
	const version = siteConfig?.version || '';
	// The version is Holm's whatever the branding says, and links to its repo.
	// A newer release, when update_check found one and lets this user see it.
	const update = siteConfig?.update || null;
	const REPO_URL = 'https://github.com/man15h/holm';
	// Off when database.enabled is false: credentials would have nowhere to live.
	const integrationsEnabled = siteConfig?.integrations?.enabled !== false;
	const { apps: catalogApps } = buildAppsFromConfig(siteConfig?.apps);
	const defaultAppIds = catalogApps.filter((a) => a.default !== false).map((a) => a.id);

	let { open = $bindable(false) } = $props();

	let activeTab = $state('appearance');
	let visibleSet = $state(new Set($prefs.visibleApps || defaultAppIds));
	let iconStyle = $state($prefs.iconStyle || 'colored');
	let theme = $state($prefs.theme || 'auto');
	let wallpaperEnabled = $state($prefs.wallpaperEnabled !== false);
	let wallpaperId = $state($prefs.wallpaperId || null);
	let openInNewTab = $state($prefs.openInNewTab ?? true);
	let wallpaperPage = $state(0);
	let enabledWidgets = $state(new Set($prefs.enabledWidgets || ['weather', 'search']));
	const WALLPAPERS_PER_PAGE = 12;
	const wallpaperCount = siteConfig?.wallpapers?.count || 0;
	const totalPages = Math.max(1, Math.ceil(wallpaperCount / WALLPAPERS_PER_PAGE));

	let prevOpen = false;

	function loadFromPrefs() {
		visibleSet = new Set($prefs.visibleApps || defaultAppIds);
		iconStyle = $prefs.iconStyle || 'colored';
		theme = $prefs.theme || 'auto';
		wallpaperEnabled = $prefs.wallpaperEnabled !== false;
		wallpaperId = $prefs.wallpaperId || null;
		openInNewTab = $prefs.openInNewTab ?? true;
		wallpaperPage = wallpaperId ? Math.floor((wallpaperId - 1) / WALLPAPERS_PER_PAGE) : 0;
		enabledWidgets = new Set($prefs.enabledWidgets || ['weather', 'search']);
		healthDots = $prefs.healthDots !== false;
	}
	$effect(() => {
		if (open && !prevOpen) {
			activeTab = 'appearance';
			loadFromPrefs();
		}
		prevOpen = open;
	});

	// Every close path goes through here so unsaved integration edits
	// (marked data-unsaved by IntegrationCard) aren't dropped silently.
	function requestClose() {
		if (!confirmDiscardUnsaved()) return;
		open = false;
	}

	// Switching tabs unmounts the integrations panel, so it asks too.
	function selectTab(id) {
		if (id !== activeTab && !confirmDiscardUnsaved()) return;
		activeTab = id;
	}

	// Close on Escape while the modal is open
	$effect(() => {
		if (!browser || !open) return;
		function onKey(e) {
			if (e.key === 'Escape') {
				e.preventDefault();
				requestClose();
			}
		}
		window.addEventListener('keydown', onKey);
		return () => window.removeEventListener('keydown', onKey);
	});


	function toggle(appId) {
		const next = new Set(visibleSet);
		if (next.has(appId)) next.delete(appId);
		else next.add(appId);
		visibleSet = next;
		prefs.update(p => ({ ...p, visibleApps: [...next] }));
	}

	function setIconStyle(style) {
		iconStyle = style;
		prefs.update(p => ({ ...p, iconStyle: style }));
	}

	function setTheme(t) {
		theme = t;
		prefs.update(p => ({ ...p, theme: t }));
	}

	function toggleWallpaper() {
		wallpaperEnabled = !wallpaperEnabled;
		prefs.update(p => ({ ...p, wallpaperEnabled }));
	}

	function toggleOpenInNewTab() {
		openInNewTab = !openInNewTab;
		prefs.update(p => ({ ...p, openInNewTab }));
	}

	// App status is on unless switched off, so it has its own pref rather than
	// a place in enabledWidgets (which lists what's on).
	let healthDots = $state($prefs.healthDots !== false);
	function toggleHealthDots() {
		healthDots = !healthDots;
		prefs.update(p => ({ ...p, healthDots }));
	}

	function toggleWidget(id) {
		const next = new Set(enabledWidgets);
		if (next.has(id)) next.delete(id);
		else next.add(id);
		enabledWidgets = next;
		prefs.update(p => ({ ...p, enabledWidgets: [...next] }));
	}

	// Connected integrations that bring widgets (Calendar, Music) get a row
	// here too, flipping the same switch as their card under Integrations.
	const integrationWidgets = $derived(
		integrationsEnabled
			? $integrationsStore.integrations.filter(
					(it) => it.userState?.connected && (it.availableSurfaces || []).includes('widgets') && it.widgets?.length > 0
				)
			: []
	);
	let widgetSaveError = $state('');
	// Integration id → the value being saved: the row flips at once, like the
	// card, and ignores clicks until the save lands.
	let widgetPending = $state({});

	$effect(() => {
		if (open && activeTab === 'widgets' && integrationsEnabled) integrationsStore.load();
	});

	async function toggleIntegrationWidgets(it) {
		if (it.id in widgetPending) return;
		const widgets = it.userState.surfaces?.widgets !== true;
		widgetPending = { ...widgetPending, [it.id]: widgets };
		widgetSaveError = '';
		try {
			await integrationsStore.save(it.id, {
				config: it.userState.config,
				surfaces: { ...it.userState.surfaces, widgets }
			});
		} catch (err) {
			widgetSaveError = err.message || 'Failed to update widgets';
		} finally {
			const { [it.id]: _, ...rest } = widgetPending;
			widgetPending = rest;
		}
	}

	function selectWallpaper(id) {
		wallpaperId = id;
		prefs.update(p => ({ ...p, wallpaperId: id }));
	}

	// Reset is appearance-only: bookmarks (customApps) and the tile layout are
	// left alone. The button offers Undo for a few seconds afterwards.
	const RESET_KEYS = ['visibleApps', 'iconStyle', 'theme', 'glass', 'wallpaperEnabled', 'wallpaperId', 'openInNewTab'];
	let resetUndo = $state(null);
	let resetUndoTimer;

	function resetDefaults() {
		resetUndo = Object.fromEntries(RESET_KEYS.map((k) => [k, $prefs[k]]));
		clearTimeout(resetUndoTimer);
		resetUndoTimer = setTimeout(() => (resetUndo = null), 8000);
		prefs.update(p => ({ ...p, visibleApps: null, iconStyle: 'colored', theme: 'auto', glass: 'frosted', wallpaperEnabled: true, wallpaperId: null, openInNewTab: true }));
		loadFromPrefs();
	}

	function undoResetDefaults() {
		const snapshot = resetUndo;
		resetUndo = null;
		clearTimeout(resetUndoTimer);
		if (!snapshot) return;
		prefs.update(p => ({ ...p, ...snapshot }));
		loadFromPrefs();
	}

	const iconStyles = [
		{ id: 'colored', label: 'Colored' },
		{ id: 'white', label: 'White' },
		{ id: 'grayed', label: 'Grayed' }
	];

	const glassLevels = [
		{ id: 'clear', label: 'Clear' },
		{ id: 'frosted', label: 'Frosted' },
		{ id: 'solid', label: 'Solid' }
	];

	const themes = [
		{ id: 'auto', label: 'Dynamic' },
		{ id: 'dark', label: 'Dark' },
		{ id: 'light', label: 'Light' }
	];
</script>

{#snippet versionLinks()}
	<a class="version-link" href={REPO_URL} target="_blank" rel="noopener noreferrer" title="Holm on GitHub">Holm v{version}</a>
	{#if update}
		<a class="version-link update" href={update.url} target="_blank" rel="noopener noreferrer" title="What's in Holm v{update.latest}">v{update.latest} available</a>
	{/if}
{/snippet}

{#if open}
	<div
		use:portal
		use:dialog={{ label: 'Configure', onclose: requestClose }}
		class="fixed inset-0 modal-veil flex items-center justify-center z-[100] p-4"
	>
		<div
			class="glass-card rounded-2xl w-full max-w-[620px] h-[520px] max-md:max-w-full max-md:h-[75vh] max-md:rounded-xl overflow-hidden animate-modal-enter shadow-theme relative flex flex-col"
		>
			<!-- Header strip -->
			<div class="shrink-0 flex items-center justify-between px-4 py-3 border-b border-border-card">
				<span class="text-[0.8rem] font-semibold text-content">Configure</span>
				<button
					class="bg-transparent border-none text-content-dim text-2xl cursor-pointer leading-none hover:text-content w-6 h-6 flex items-center justify-center"
					onclick={requestClose}
					aria-label="Close"
				>&times;</button>
			</div>

			<!-- Mobile: horizontal tabs -->
			<div class="hidden max-md:flex shrink-0 px-3 pt-2 pb-1 gap-1 border-b border-border-card overflow-x-auto items-center">
				{#each [
					{ id: 'appearance', label: 'Appearance' },
					{ id: 'widgets', label: 'Widgets' },
					{ id: 'integrations', label: 'Integrations' }
				].filter((t) => t.id !== 'integrations' || integrationsEnabled) as tab}
					<button
						class="flex-1 min-w-fit px-2.5 py-2.5 rounded-lg border-none cursor-pointer text-center text-[0.75rem] font-medium transition-all duration-150 {activeTab === tab.id ? 'bg-surface-card-strong text-content' : 'bg-transparent text-content-dim'}"
						onclick={() => selectTab(tab.id)}
					>{tab.label}</button>
				{/each}
			</div>

			<!-- Tabbed layout: sidebar (desktop) + content -->
			<div class="flex flex-1 min-h-0">
				<!-- Sidebar — hidden on mobile -->
				<div class="w-[160px] shrink-0 px-2.5 pt-3 pb-3 flex flex-col max-md:hidden">
					<div class="flex flex-col gap-0.5">
						{#each [
							{ id: 'appearance', label: 'Appearance', svg: '<circle cx="12" cy="12" r="3"/><path d="M12 1v2m0 18v-2M4.22 4.22l1.42 1.42m12.72 12.72-1.42-1.42M1 12h2m18 0h-2M4.22 19.78l1.42-1.42M18.36 5.64l-1.42 1.42"/>' },
							{ id: 'widgets', label: 'Widgets', svg: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 21V9"/>' },
							{ id: 'integrations', label: 'Integrations', svg: '<path d="M9 2v6"/><path d="M15 2v6"/><path d="M12 17v5"/><path d="M5 8h14a2 2 0 0 1 2 2v3a5 5 0 0 1-5 5H8a5 5 0 0 1-5-5v-3a2 2 0 0 1 2-2z"/>' }
						].filter((t) => t.id !== 'integrations' || integrationsEnabled) as tab}
							<button
								class="flex items-center gap-2.5 w-full px-3 py-2 rounded-lg border-none cursor-pointer transition-all duration-150 text-left {activeTab === tab.id ? 'bg-surface-card-strong' : 'bg-transparent hover:bg-surface-card-hover'}"
								onclick={() => selectTab(tab.id)}
							>
								<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="w-4 h-4 shrink-0 {activeTab === tab.id ? 'text-content' : 'text-content-dim'}">{@html tab.svg}</svg>
								<span class="text-[0.78rem] font-medium {activeTab === tab.id ? 'text-content' : 'text-content-dim'}">{tab.label}</span>
							</button>
						{/each}
					</div>
					<div class="mt-auto pt-3">
						{#if resetUndo}
							<button
								class="text-[0.7rem] text-content bg-transparent border-none cursor-pointer underline underline-offset-2 font-mono px-3"
								onclick={undoResetDefaults}
							>Undo reset</button>
						{:else}
							<button
								class="text-[0.7rem] text-content-dim bg-transparent border-none cursor-pointer hover:text-content transition-colors font-mono px-3"
								onclick={resetDefaults}
							>Reset defaults</button>
						{/if}
						{#if version}
							<div class="version-line mt-1.5">{@render versionLinks()}</div>
						{/if}
					</div>
				</div>

				<!-- Tab content -->
				<div class="flex-1 max-md:border-l-0 border-l border-border-card px-5 max-md:px-4 pt-3 pb-4 overflow-y-auto">

				{#if activeTab === 'appearance'}
				<!-- ═══ APPEARANCE TAB ═══ -->
				<div class="mb-4">
					<div class="text-[0.85rem] font-semibold text-content">Appearance</div>
					<div class="text-[0.7rem] text-content-dim mt-0.5">Customize how your dashboard looks.</div>
				</div>

				<!-- Theme -->
				<div class="mb-5">
					<div class="text-[0.65rem] font-bold uppercase tracking-[0.2em] text-content-dim mb-2">Theme</div>
					<div class="segmented" role="radiogroup">
						{#each themes as t}
							<button
								role="radio"
								aria-checked={theme === t.id}
								class="segmented-item"
								onclick={() => setTheme(t.id)}
							>{t.label}</button>
						{/each}
					</div>
				</div>

				<!-- Glass: how much tint and blur the cards, menus and search take. -->
				<div class="mb-5">
					<UnitPicker key="glass" label="Glass" options={glassLevels} fallback="frosted" />
				</div>

				<!-- Icon style -->
				<div class="mb-5">
					<div class="text-[0.65rem] font-bold uppercase tracking-[0.2em] text-content-dim mb-2">Icon style</div>
					<div class="segmented" role="radiogroup">
						{#each iconStyles as style}
							<button
								role="radio"
								aria-checked={iconStyle === style.id}
								class="segmented-item"
								onclick={() => setIconStyle(style.id)}
							>{style.label}</button>
						{/each}
					</div>
				</div>

				<!-- Open apps in new tab -->
				<div class="mb-4">
					<div class="flex items-center justify-between">
						<span class="text-[0.8rem] text-content-muted">Open apps in new tab</span>
						<button class="bg-transparent border-none cursor-pointer p-0" role="switch" aria-checked={openInNewTab} aria-label="Open apps in new tab" onclick={toggleOpenInNewTab}>
							<div class="w-9 h-5 rounded-full transition-colors duration-200 relative shrink-0 {openInNewTab ? 'bg-surface-toggle-on' : 'bg-surface-toggle-off'}">
								<div class="absolute top-0.5 w-4 h-4 rounded-full bg-surface-toggle-knob shadow transition-transform duration-200 {openInNewTab ? 'translate-x-4' : 'translate-x-0.5'}"></div>
							</div>
						</button>
					</div>
				</div>

				<!-- Wallpaper — visible in all themes, disabled when not Dynamic -->
				<div class="mb-4 {theme !== 'auto' ? 'opacity-40 pointer-events-none' : ''}">
					<div class="flex items-center justify-between mb-3">
						<span class="text-[0.8rem] text-content-muted">Wallpaper {theme !== 'auto' ? '(Dynamic only)' : ''}</span>
						<button class="bg-transparent border-none cursor-pointer p-0" role="switch" aria-checked={wallpaperEnabled && theme === 'auto'} aria-label="Wallpaper" onclick={toggleWallpaper}>
							<div class="w-9 h-5 rounded-full transition-colors duration-200 relative shrink-0 {wallpaperEnabled && theme === 'auto' ? 'bg-surface-toggle-on' : 'bg-surface-toggle-off'}">
								<div class="absolute top-0.5 w-4 h-4 rounded-full bg-surface-toggle-knob shadow transition-transform duration-200 {wallpaperEnabled && theme === 'auto' ? 'translate-x-4' : 'translate-x-0.5'}"></div>
							</div>
						</button>
					</div>

					{#if wallpaperEnabled && theme === 'auto'}
						<!-- Daily rotation option -->
						<button
							class="flex items-center gap-2 w-full px-2 py-1.5 rounded-lg text-[0.75rem] font-mono cursor-pointer transition-all duration-150 mb-2 {!wallpaperId ? 'bg-surface-card-strong text-content border border-border-pill' : 'bg-transparent text-content-dim border border-border-card hover:bg-surface-card-hover'}"
							onclick={() => selectWallpaper(null)}
						>Daily rotation</button>

						<!-- Wallpaper grid — always visible -->
						<div class="grid grid-cols-3 max-md:grid-cols-2 gap-1.5">
							{#each Array.from({length: WALLPAPERS_PER_PAGE}, (_, i) => wallpaperPage * WALLPAPERS_PER_PAGE + i + 1).filter(id => id <= wallpaperCount) as id}
								<button
									class="relative aspect-video rounded-lg overflow-hidden cursor-pointer border-2 transition-all duration-150 bg-surface-card {wallpaperId == id ? 'border-white/60 shadow-lg' : 'border-transparent hover:border-border-pill'}"
									onclick={() => selectWallpaper(id)}
								>
									<div class="absolute inset-0 shimmer"></div>
									<img
										src={getWallpaperThumbUrl(id, siteConfig?.wallpapers)}
										alt="Wallpaper {id}"
										loading="lazy"
										class="absolute inset-0 w-full h-full object-cover transition-opacity duration-300 opacity-0"
										onload={(e) => e.target.classList.replace('opacity-0', 'opacity-100')}
									/>
									{#if wallpaperId == id}
										<div class="absolute inset-0 bg-white/10 flex items-center justify-center z-10">
											<span class="text-white text-xs font-bold drop-shadow">✓</span>
										</div>
									{/if}
								</button>
							{/each}
						</div>

						<!-- Pagination -->
						<div class="flex items-center justify-between mt-2 px-1">
							<button
								class="text-[0.7rem] text-content-dim bg-transparent border-none cursor-pointer hover:text-content transition-colors font-mono disabled:opacity-30 disabled:cursor-not-allowed"
								disabled={wallpaperPage === 0}
								onclick={() => wallpaperPage--}
							>← Prev</button>
							<span class="text-[0.7rem] text-content-dim font-mono">{wallpaperPage + 1} / {totalPages}</span>
							<button
								class="text-[0.7rem] text-content-dim bg-transparent border-none cursor-pointer hover:text-content transition-colors font-mono disabled:opacity-30 disabled:cursor-not-allowed"
								disabled={wallpaperPage >= totalPages - 1}
								onclick={() => wallpaperPage++}
							>Next →</button>
						</div>
					{/if}
				</div>

				{:else if activeTab === 'widgets'}
				<!-- ═══ WIDGETS TAB ═══ -->
				<div class="mb-4">
					<div class="text-[0.85rem] font-semibold text-content">Widgets</div>
					<div class="text-[0.7rem] text-content-dim mt-0.5">Turn parts of your page on or off. To add or move apps, use Edit on the dashboard.</div>
				</div>
				{@const widgets = [
					{ id: 'clock', name: 'Clock', desc: 'Time and date, top of page', icon: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 7v5l3 2', fixed: true,
						settings: [{ key: 'timeFormat', label: 'Time format', options: TIME_FORMATS, fallback: DEFAULT_TIME_FORMAT }] },
					{ id: 'weather', name: 'Weather', desc: 'Conditions where you are', icon: 'M12 3v2M12 19v2M5.6 5.6 7 7M17 17l1.4 1.4M3 12h2M19 12h2M5.6 18.4 7 17M17 7l1.4-1.4M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z',
						settings: [{ key: 'tempUnit', label: 'Temperature', options: TEMP_UNITS, fallback: DEFAULT_TEMP_UNIT }] },
					{ id: 'search', name: 'Search', desc: 'Apps and files, mid-page', icon: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-4-4',
						settings: [
							{ key: 'searchOnFocus', label: 'On focus', options: SEARCH_ON_FOCUS, fallback: searchOnFocus(undefined, siteConfig?.search?.on_focus) },
							{ key: 'searchTransparency', label: 'Transparency', options: SEARCH_TRANSPARENCY, fallback: searchTransparency(undefined, siteConfig?.search?.transparency) },
							{ key: 'searchHints', label: 'Hints', options: SEARCH_HINTS, fallback: searchHints(undefined, siteConfig?.search?.hints) }
						] },
					...(siteConfig?.health?.enabled ? [{ id: 'health', name: 'App status', desc: 'A dot on tiles whose app is down or slow', icon: 'M3 12h4l3-8 4 16 3-8h4', on: healthDots, toggle: toggleHealthDots }] : [])
				]}
				{#snippet toggle(on)}
					<div class="w-9 h-5 rounded-full transition-colors duration-200 relative shrink-0 {on ? 'bg-surface-toggle-on' : 'bg-surface-toggle-off'}">
						<div class="absolute top-0.5 w-4 h-4 rounded-full bg-surface-toggle-knob shadow transition-transform duration-200 {on ? 'translate-x-4' : 'translate-x-0.5'}"></div>
					</div>
				{/snippet}
				{#snippet cardHead(icon, name, desc)}
					<span class="w-8 h-8 rounded-lg bg-surface-input border border-border-card flex items-center justify-center shrink-0 text-content-muted">{@render icon()}</span>
					<div class="flex-1 min-w-0">
						<div class="text-[0.8rem] text-content font-medium">{name}</div>
						<div class="text-[0.7rem] text-content-dim truncate" title={desc}>{desc}</div>
					</div>
				{/snippet}
				<!-- One card per widget: the same head on every card, and each
				     setting it has as a row of the same height below. -->
				<div class="flex flex-col gap-2">
					{#each widgets as widget}
						{@const on = widget.fixed || (widget.toggle ? widget.on : enabledWidgets.has(widget.id))}
						{#snippet icon()}
							<svg viewBox="0 0 24 24" class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d={widget.icon} /></svg>
						{/snippet}
						<div class="widget-card">
							{#if widget.fixed}
								<div class="widget-head">{@render cardHead(icon, widget.name, widget.desc)}</div>
							{:else}
								<button class="widget-head" role="switch" aria-checked={on} onclick={() => (widget.toggle ? widget.toggle() : toggleWidget(widget.id))}>
									{@render cardHead(icon, widget.name, widget.desc)}
									{@render toggle(on)}
								</button>
							{/if}
							{#if widget.settings && on}
								{#each widget.settings as setting}
									<div class="widget-setting"><UnitPicker {...setting} inline /></div>
								{/each}
							{/if}
						</div>
					{/each}
					{#each integrationWidgets as it (it.id)}
						{@const on = widgetPending[it.id] ?? it.userState.surfaces?.widgets === true}
						{#snippet icon()}
							<AppIcon icon={resolveIcon(it.icon)} name={it.name} size="w-4 h-4" iconStyle="white" />
						{/snippet}
						<div class="widget-card">
							<button class="widget-head" role="switch" aria-checked={on} aria-busy={it.id in widgetPending} onclick={() => toggleIntegrationWidgets(it)}>
								{@render cardHead(icon, it.name, it.widgets.map((w) => w.label).join(', '))}
								{@render toggle(on)}
							</button>
						</div>
					{/each}
				</div>
				{#if widgetSaveError}
					<div class="px-2 pt-2 text-[0.7rem] text-red-400">{widgetSaveError}</div>
				{/if}

				{:else if activeTab === 'integrations'}
				<!-- ═══ INTEGRATIONS TAB ═══ -->
				<IntegrationsPanel {iconStyle} />

				{/if}
				<!-- On phones the sidebar is hidden: Reset defaults and the version sit
				     under the tab, flush with its content. -->
				<div class="hidden max-md:flex flex-col items-start gap-1.5 mt-6">
					{#if resetUndo}
						<button class="text-[0.7rem] text-content bg-transparent border-none cursor-pointer underline underline-offset-2 font-mono p-0" onclick={undoResetDefaults}>Undo reset</button>
					{:else}
						<button class="text-[0.7rem] text-content-dim bg-transparent border-none cursor-pointer hover:text-content transition-colors font-mono p-0" onclick={resetDefaults}>Reset defaults</button>
					{/if}
					{#if version}
						<div class="version-line flush">{@render versionLinks()}</div>
					{/if}
				</div>
				</div>
			</div>

		</div>
	</div>
{/if}

<style>
	.version-line {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 0.15rem;
		padding: 0 0.75rem;
	}
	.version-line.flush { padding: 0; }
	.widget-card {
		border: 1px solid var(--glass-border);
		border-radius: 12px;
		background: var(--input-bg);
		overflow: hidden;
	}
	.widget-head {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		width: 100%;
		min-height: 3.5rem;
		padding: 0.6rem 0.75rem;
		background: transparent;
		border: none;
		text-align: left;
		font-family: var(--font-mono);
	}
	button.widget-head { cursor: pointer; transition: background 0.15s; }
	button.widget-head:hover { background: var(--input-bg); }
	button.widget-head:focus-visible { outline: 2px solid var(--text-muted); outline-offset: -2px; border-radius: 12px; }
	.widget-setting {
		display: flex;
		align-items: center;
		min-height: 2.75rem;
		padding: 0.4rem 0.75rem 0.4rem 3.5rem;
		border-top: 1px solid var(--glass-border);
	}
	.widget-setting + .widget-setting { border-top: none; }
	.widget-setting > :global(*) { flex: 1; min-width: 0; }
	@media (max-width: 767px) {
		.widget-setting { padding-left: 0.75rem; }
	}
	.version-link {
		text-align: left;
		text-decoration: none;
		background: transparent;
		border: none;
		cursor: pointer;
		font-family: var(--font-mono, ui-monospace, monospace);
		font-size: 0.68rem;
		color: var(--color-content-dim);
		opacity: 0.7;
		transition: opacity 0.15s ease;
	}
	.version-link:hover, .version-link:focus-visible { opacity: 1; color: var(--color-content); }
	.version-link.update { color: var(--color-content); opacity: 0.9; }
</style>
