<script>
	import { onMount } from 'svelte';
	import { answerHtml, loadPurify } from '$lib/aiAnswer.js';

	// One AI answer as sanitised Markdown. Until DOMPurify has loaded (the
	// first answer only), the text shows as it came, unformatted. While
	// nothing has arrived yet, a "Thinking" line stands in: a local model can
	// take a while to load before its first word.
	let { content = '', streaming = false } = $props();

	let ready = $state(false);
	onMount(() => {
		loadPurify().then(() => (ready = true));
	});
	const html = $derived(ready ? answerHtml(content) : null);
</script>

{#if !content && streaming}
	<div class="ai-thinking" role="status">
		<span class="ai-thinking-dots" aria-hidden="true"><span></span><span></span><span></span></span>
		Thinking…
	</div>
{:else if html != null}
	<!-- A click on a link opens it, and doesn't also act on the card. -->
	<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
	<div class="ai-markdown" class:is-streaming={streaming} onclick={(e) => { if (e.target.closest('a')) e.stopPropagation(); }}>{@html html}</div>
{:else}
	<div class="ai-markdown is-plain" class:is-streaming={streaming}>{content}</div>
{/if}
