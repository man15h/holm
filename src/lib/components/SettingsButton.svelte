<script>
	import { getContext } from 'svelte';
	import { prefs } from '$lib/stores/prefs.js';
	import { clearAllLocal } from '$lib/aiCalls.js';
	import { browser } from '$app/environment';

	const siteConfig = getContext('config');
	const passwordChangeUrl = siteConfig?.auth?.password_change_url;

	let { open = $bindable(false), onmanageapps = null, showAuth = true } = $props();

	let name = $derived($prefs.name || '');
	let initial = $derived(name ? name.charAt(0).toUpperCase() : '');
	// Show gear icon when no auth (no user initial to display)
	let buttonLabel = $derived(initial || '⚙');

	function handleLogout() {
		prefs.reset();
		clearAllLocal();
		window.location.href = '/auth/logout';
	}

	// The menu item unmounts with the menu, so hand focus to the trigger first;
	// the Configure dialog then returns focus there when it closes.
	function openManageApps(e) {
		e.currentTarget.closest('.user-menu')?.querySelector('button')?.focus();
		open = false;
		onmanageapps();
	}

	function handleClickOutside(e) {
		if (!e.target.closest('.user-menu')) open = false;
	}

	$effect(() => {
		if (!browser) return;
		if (open) {
			document.addEventListener('click', handleClickOutside);
			return () => document.removeEventListener('click', handleClickOutside);
		}
	});
</script>

<!-- Desktop: top-right icon button with popup below -->
<div class="user-menu hidden md:block fixed top-6 right-6 z-[60]">
	<button
		class="w-9 h-9 rounded-[10px] glass-card text-content text-[0.8rem] font-semibold flex items-center justify-center cursor-pointer transition-all duration-200 hover:text-content shadow-theme"
		title={name || 'Settings'}
		onclick={() => open = !open}
	>
		{buttonLabel}
	</button>

	{#if open}
		<div class="absolute top-12 right-0 glass-card menu-surface rounded-xl overflow-hidden min-w-[180px] animate-menu-up shadow-theme">
			{#if showAuth && name}
				<div class="px-4 py-2.5 text-[0.7rem] text-content-muted font-mono uppercase tracking-[0.12em] border-b border-border-card">{name}</div>
			{/if}
			{#if showAuth && passwordChangeUrl}
			<a
				href={passwordChangeUrl}
				target="_blank"
				rel="noopener noreferrer"
				class="flex items-center gap-2.5 w-full px-4 py-2.5 text-left text-[0.8rem] text-content-muted font-mono bg-transparent border-none no-underline cursor-pointer hover:bg-surface-card-hover transition-colors duration-150"
			>
				<svg class="w-4 h-4 text-content-dim" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
				Change password
			</a>
			{/if}
			{#if onmanageapps}
			<button
				class="flex items-center gap-2.5 w-full px-4 py-2.5 text-left text-[0.8rem] text-content-muted font-mono bg-transparent border-none cursor-pointer hover:bg-surface-card-hover transition-colors duration-150"
				onclick={openManageApps}
			>
				<svg class="w-4 h-4 text-content-dim" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/></svg>
				Configure
			</button>
			{/if}
			{#if showAuth}
			<button
				class="flex items-center gap-2.5 w-full px-4 py-2.5 text-left text-[0.8rem] text-content-muted font-mono bg-transparent border-none cursor-pointer hover:bg-surface-card-hover transition-colors duration-150"
				onclick={handleLogout}
			>
				<svg class="w-4 h-4 text-content-dim" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
				Log out
			</button>
			{/if}
		</div>
	{/if}
</div>

<!-- Mobile: bottom-right FAB + bottom sheet -->
<div class="user-menu dock-account md:hidden fixed z-[60]">
	<button
		class="w-[50px] h-[50px] rounded-[16px] glass-card text-content text-[0.8rem] font-semibold flex items-center justify-center cursor-pointer transition-all duration-200 hover:text-content shadow-theme relative"
		title={name || 'Settings'}
		onclick={() => open = !open}
	>
		{buttonLabel}
	</button>

	{#if open}
		<div class="fixed inset-0 z-[70]">
			<button class="absolute inset-0 w-full bg-surface-overlay border-none cursor-default" tabindex="-1" aria-label="Close menu" onclick={() => open = false}></button>
			<div class="absolute bottom-0 left-0 right-0 glass-card menu-surface rounded-t-2xl animate-slide-up pb-[env(safe-area-inset-bottom,0px)]">
				<div class="w-10 h-1 bg-content-dim/30 rounded-full mx-auto mt-3 mb-2"></div>
				{#if showAuth && name}
					<div class="px-5 py-2 text-[0.75rem] text-content-muted font-mono uppercase tracking-[0.12em]">{name}</div>
				{/if}
				{#if showAuth && passwordChangeUrl}
				<a
					href={passwordChangeUrl}
					target="_blank"
					rel="noopener noreferrer"
					class="flex items-center gap-3 w-full px-5 py-3 text-left text-[0.9rem] text-content-muted font-mono bg-transparent border-none no-underline cursor-pointer hover:bg-surface-card-hover"
				>
					<svg class="w-5 h-5 text-content-dim" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
					Change password
				</a>
				{/if}
				{#if onmanageapps}
				<button
					class="flex items-center gap-3 w-full px-5 py-3 text-left text-[0.9rem] text-content-muted font-mono bg-transparent border-none cursor-pointer hover:bg-surface-card-hover"
					onclick={openManageApps}
				>
					<svg class="w-5 h-5 text-content-dim" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/></svg>
					Configure
				</button>
				{/if}
				{#if showAuth}
				<button
					class="flex items-center gap-3 w-full px-5 py-3 text-left text-[0.9rem] text-content-muted font-mono bg-transparent border-none cursor-pointer hover:bg-surface-card-hover"
					onclick={handleLogout}
				>
					<svg class="w-5 h-5 text-content-dim" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
					Log out
				</button>
				{/if}
				<div class="h-3"></div>
			</div>
		</div>
	{/if}
</div>
