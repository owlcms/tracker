<!--
  Checkpoints: settings, folder picker, Start/Stop and status.
  Everything runs on the tracker server; this page only calls the plugin's actions.
-->
<script>
	import { onDestroy, onMount } from 'svelte';

	export let data = {};

	const PLUGIN = data.scoreboardType || 'checkpoints';

	let status = data.checkpoints || null;
	let owlcmsUrl = status?.settings?.owlcmsUrl || '';
	let secret = '';
	let folder = status?.settings?.folder || '';
	let intervalMinutes = status?.settings?.intervalMinutes || 5;
	let message = '';
	let messageIsError = false;
	let busy = false;

	let browserDialog;
	let browsePath = '';
	let browseParent = null;
	let browseFolders = [];
	let newFolderName = '';
	let browseMessage = '';

	let pollTimer = null;

	$: started = status?.started === true;

	async function act(action, params = {}) {
		const query = new URLSearchParams({ plugin: PLUGIN, action });
		for (const [key, value] of Object.entries(params)) {
			if (value !== undefined && value !== null) query.set(key, String(value));
		}
		const response = await fetch(`/api/plugin-action?${query}`, { method: 'POST' });
		return response.json();
	}

	function show(result, okMessage = '') {
		messageIsError = !result?.success;
		message = result?.success ? okMessage : result?.message || 'The action failed.';
		if (result?.success && result.settings) status = result;
	}

	async function refresh() {
		const result = await act('status').catch(() => null);
		if (result?.success) status = result;
	}

	async function saveSettings() {
		const result = await act('save', { owlcmsUrl, secret, folder, intervalMinutes });
		if (result?.success) secret = '';
		return result;
	}

	async function start() {
		busy = true;
		try {
			const saved = await saveSettings();
			if (!saved?.success) return show(saved);
			const newest = saved.folder?.newest;
			show(await act('start'), newest ? `Started, continuing after ${newest}.` : 'Started, beginning with a full checkpoint.');
		} finally {
			busy = false;
		}
	}

	async function checkpointNow() {
		busy = true;
		message = 'Taking a checkpoint…';
		messageIsError = false;
		try {
			if (!started) {
				const saved = await saveSettings();
				if (!saved?.success) return show(saved);
			}
			const result = await act('checkpoint');
			show(result, result?.success ? `Checkpoint ${result.name} stored.` : '');
		} finally {
			busy = false;
		}
	}

	async function stop() {
		busy = true;
		try {
			show(await act('stop'), 'Stopped.');
		} finally {
			busy = false;
		}
	}

	async function browse(path) {
		browseMessage = '';
		const result = await act('browse', path ? { path } : {});
		if (!result?.success) {
			browseMessage = result?.message || 'Cannot list the folder.';
			return;
		}
		if (!browserDialog.open) browserDialog.showModal();
		browsePath = result.path;
		browseParent = result.parent;
		browseFolders = result.folders;
	}

	async function makeFolder() {
		browseMessage = '';
		const result = await act('mkdir', { parent: browsePath, name: newFolderName.trim() });
		if (!result?.success) {
			browseMessage = result?.message || 'Cannot create the folder.';
			return;
		}
		newFolderName = '';
		await browse(result.created);
	}

	function choose() {
		folder = browsePath;
		browserDialog.close();
	}

	function joinPath(parent, name) {
		const separator = parent.includes('\\') && !parent.includes('/') ? '\\' : '/';
		return parent.endsWith(separator) ? parent + name : parent + separator + name;
	}

	function formatTime(millis) {
		return millis ? new Date(millis).toLocaleTimeString() : '—';
	}

	onMount(() => {
		refresh();
		pollTimer = setInterval(refresh, 3000);
	});

	onDestroy(() => clearInterval(pollTimer));
</script>

<div class="checkpoints">
<div class="content">
	<header>
		<h1>Checkpoints</h1>
		<span class="badge" class:running={started} class:waiting={started && status?.waiting}>
			{#if !started}Stopped{:else if status?.waiting}Waiting for OWLCMS{:else}Started{/if}
		</span>
	</header>

	<section>
		<h2>OWLCMS</h2>
		<label>
			Address
			<input type="text" bind:value={owlcmsUrl} placeholder="http://owlcms.local:8080" disabled={started} />
		</label>
		<label>
			Secret
			<input
				type="password"
				bind:value={secret}
				placeholder={status?.settings?.hasSecret ? 'unchanged' : 'account token, or officials PIN'}
				disabled={started}
				autocomplete="off"
			/>
		</label>
		<label class="short">
			Interval (minutes)
			<input type="number" min="1" bind:value={intervalMinutes} disabled={started} />
		</label>
	</section>

	<section>
		<h2>Checkpoint folder</h2>
		<div class="row">
			<input type="text" class="path" bind:value={folder} placeholder="folder on the tracker machine" disabled={started} />
			<button on:click={() => browse(folder)} disabled={started}>Browse…</button>
		</div>
		{#if status?.folder}
			<p class="hint">
				{#if !status.settings?.folder}
					No folder chosen yet.
				{:else if !status.folder.exists}
					The saved folder does not exist.
				{:else if status.folder.zipCount === 0}
					No checkpoints yet: the first one will be complete.
				{:else}
					{status.folder.zipCount} checkpoint(s), newest {status.folder.newest}.
				{/if}
			</p>
		{/if}

	</section>

	<section class="controls">
		<button class:primary={!started} on:click={start} disabled={busy || started}>Start</button>
		<button class:primary={started} on:click={stop} disabled={busy || !started}>Stop</button>
		<button on:click={checkpointNow} disabled={busy || status?.pulling}>Checkpoint now</button>
		{#if message}<span class:error={messageIsError}>{message}</span>{/if}
	</section>

	<section>
		<h2>Status</h2>
		<dl>
			<dt>Last checkpoint</dt>
			<dd>{status?.lastCheckpoint || '—'} {status?.lastCheckpointAt ? `(${formatTime(status.lastCheckpointAt)})` : ''}</dd>
			<dt>Last attempt</dt>
			<dd>{formatTime(status?.lastAttemptAt)}</dd>
			<dt>Next pull</dt>
			<dd>{started ? formatTime(status?.nextPullAt) : '—'}</dd>
			<dt>Last error</dt>
			<dd class:error={!!status?.lastError}>{status?.lastError || '—'}</dd>
		</dl>
	</section>
</div>
</div>

<dialog
	class="browser"
	bind:this={browserDialog}
	on:close={() => (newFolderName = '')}
	on:keydown={(event) => event.key === 'Escape' && browserDialog.close()}
>
	<h2>Choose the checkpoint folder</h2>
	<p class="hint">Folders on the tracker machine.</p>
	<div class="row">
		<button on:click={() => browse(browseParent)} disabled={!browseParent}>Up</button>
		<code class="path">{browsePath}</code>
	</div>
	<ul>
		{#each browseFolders as name}
			<li><button class="link" on:click={() => browse(joinPath(browsePath, name))}>{name}</button></li>
		{:else}
			<li class="hint">No sub-folders.</li>
		{/each}
	</ul>
	<div class="row">
		<input type="text" bind:value={newFolderName} placeholder="new folder name" />
		<button on:click={makeFolder} disabled={!newFolderName.trim()}>New Folder</button>
	</div>
	{#if browseMessage}<p class="error">{browseMessage}</p>{/if}
	<div class="row actions">
		<button on:click={() => browserDialog.close()}>Cancel</button>
		<button class="primary" on:click={choose}>Use this folder</button>
	</div>
</dialog>

<style>
	/* same palette as the tracker home page */
	.checkpoints {
		padding: 2rem;
		font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
		background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
		color: #ffffff;
		min-height: 100vh;
		box-sizing: border-box;
	}

	.content {
		max-width: 900px;
		margin: 0 auto;
	}

	header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		border-bottom: 2px solid rgba(102, 126, 234, 0.3);
		padding-bottom: 0.5rem;
		margin-bottom: 1.5rem;
	}

	h1 {
		font-size: 2rem;
		margin: 0;
		background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
		-webkit-background-clip: text;
		-webkit-text-fill-color: transparent;
		background-clip: text;
	}

	h2 {
		font-size: 1.2rem;
		color: #667eea;
		margin: 0 0 0.75rem;
	}

	section {
		background: rgba(255, 255, 255, 0.05);
		border: 1px solid rgba(255, 255, 255, 0.1);
		border-radius: 8px;
		padding: 1rem;
		margin-bottom: 1rem;
	}

	label {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		margin-bottom: 0.75rem;
		color: #e2e8f0;
		font-size: 0.9rem;
	}

	label.short input {
		max-width: 8rem;
	}

	input {
		background: rgba(0, 0, 0, 0.25);
		color: #ffffff;
		border: 1px solid rgba(255, 255, 255, 0.2);
		border-radius: 6px;
		padding: 0.5rem 0.6rem;
		font: inherit;
	}

	input:focus {
		outline: none;
		border-color: rgba(102, 126, 234, 0.8);
	}

	input:disabled {
		color: #a0aec0;
	}

	.row {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		margin-bottom: 0.5rem;
	}

	.path {
		flex: 1;
		overflow-wrap: anywhere;
	}

	button {
		background: rgba(255, 255, 255, 0.15);
		color: #ffffff;
		border: none;
		border-radius: 8px;
		padding: 0.55rem 1.2rem;
		font: inherit;
		font-weight: 600;
		cursor: pointer;
		transition: transform 0.2s, box-shadow 0.2s;
	}

	button:hover:not(:disabled) {
		transform: scale(1.02);
	}

	button:disabled {
		opacity: 0.5;
		cursor: default;
	}

	button.primary {
		background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
	}

	button.primary:hover:not(:disabled) {
		box-shadow: 0 4px 12px rgba(102, 126, 234, 0.4);
	}

	button.link {
		background: none;
		padding: 0.15rem 0;
		font-weight: 400;
		color: #a3b4f7;
	}

	.browser {
		width: min(640px, 90vw);
		border: 1px solid rgba(102, 126, 234, 0.5);
		border-radius: 8px;
		padding: 1.25rem;
		background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
		color: #ffffff;
		font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
		box-shadow: 0 12px 24px rgba(0, 0, 0, 0.5);
	}

	.browser::backdrop {
		background: rgba(0, 0, 0, 0.6);
	}

	.browser code {
		overflow-wrap: anywhere;
	}

	.actions {
		justify-content: flex-end;
		margin: 0.75rem 0 0;
	}

	.browser ul {
		list-style: none;
		margin: 0 0 0.75rem;
		padding: 0.25rem 0.5rem;
		height: 18rem;
		overflow-y: auto;
		border: 1px solid rgba(255, 255, 255, 0.1);
		border-radius: 6px;
		background: rgba(0, 0, 0, 0.2);
	}

	.controls {
		display: flex;
		align-items: center;
		gap: 0.75rem;
	}

	.badge {
		padding: 0.35rem 0.9rem;
		border-radius: 8px;
		border: 1px solid rgba(255, 255, 255, 0.2);
		color: #a0aec0;
	}

	.badge.running {
		border-color: #48bb78;
		color: #9ae6b4;
	}

	.badge.waiting {
		border-color: #ecc94b;
		color: #faf089;
	}

	dl {
		display: grid;
		grid-template-columns: max-content 1fr;
		gap: 0.35rem 1rem;
		margin: 0;
	}

	dt {
		color: #a0aec0;
	}

	dd {
		margin: 0;
	}

	.hint {
		color: #a0aec0;
		font-size: 0.9rem;
		margin: 0.25rem 0 0.5rem;
	}

	.error {
		color: #fc8181;
	}
</style>
