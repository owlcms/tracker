<script>
	import { onMount, tick } from 'svelte';
	import { normalizeScoreboardUrl } from '$lib/celebrations-scoreboard-url.js';
	import { resolveCelebrationVideoUrl, resolveVisibleDecisionVideo } from '$lib/celebrations-video-urls.js';

	export let data = {};

	let videoElement;
	let activeVideoUrl = '';
	let activeVideoKind = null;
	let lastDecisionToken = null;
	let lastDecisionTraceSignature = null;
	let videoVisible = false;

	function videoUrlFor(kind) {
		return resolveCelebrationVideoUrl(kind, data.options, data.videoUrls);
	}

	function decisionTokenFor(decision) {
		if (decision?.visible !== true || decision?.type !== 'FULL_DECISION') {
			return null;
		}

		return [
			decision.athleteName || '',
			decision.attemptNumber || '',
			decision.type || '',
			decision.recordKind || '',
			decision.ref1 || '',
			decision.ref2 || '',
			decision.ref3 || ''
		].join('|');
	}

	function mediaDetails(details = {}) {
		const overlay = videoElement?.parentElement;
		const overlayStyle = overlay ? getComputedStyle(overlay) : null;
		const mediaError = videoElement?.error;

		return {
			clipKind: activeVideoKind || '',
			fopState: data.fopUpdate?.fopState || '',
			decisionType: data.decision?.type || '',
			decisionVisible: data.decision?.visible === true,
			replayUrl: activeVideoUrl || '',
			currentSrc: videoElement?.currentSrc || '',
			readyState: videoElement?.readyState ?? null,
			networkState: videoElement?.networkState ?? null,
			paused: videoElement?.paused ?? null,
			ended: videoElement?.ended ?? null,
			currentTime: videoElement?.currentTime ?? null,
			duration: videoElement?.duration ?? null,
			muted: videoElement?.muted ?? null,
			mediaErrorCode: mediaError?.code ?? null,
			overlayVisibility: overlayStyle?.visibility || '',
			overlayZIndex: overlayStyle?.zIndex || '',
			videoVisible,
			...details
		};
	}

	function reportTrace(message, details = {}) {
		if (typeof window === 'undefined') return;

		const payload = {
			source: 'celebrations',
			category: 'video.overlay',
			message,
			details: mediaDetails(details)
		};
		console.warn('[Celebrations]', message, payload.details);
		void fetch('/api/client-log', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(payload),
			keepalive: true
		}).catch((error) => console.warn('[Celebrations] Could not report trace:', error));
	}

	async function playDecisionVideo(kind) {
		const videoUrl = videoUrlFor(kind);
		if (!videoUrl) {
			reportTrace('Skipped playback because no video URL was resolved.', { action: 'playback_skipped' });
			return;
		}
		if (!videoElement) {
			reportTrace('Skipped playback because the video element is not mounted.', { action: 'playback_skipped' });
			return;
		}

		activeVideoKind = kind;
		activeVideoUrl = videoUrl;
		videoVisible = true;
		reportTrace('Preparing visible video overlay.', { action: 'playback_prepare' });
		videoElement.pause();
		videoElement.src = videoUrl;
		videoElement.load();
		await tick();
		reportTrace('Requesting video playback.', { action: 'playback_request' });
		try {
			await videoElement.play();
			reportTrace('Video playback promise resolved.', { action: 'playback_resolved' });
		} catch (error) {
			reportTrace('Video playback promise rejected.', {
				action: 'playback_rejected',
				playErrorName: error?.name || 'UnknownError',
				playErrorMessage: error?.message || String(error)
			});
		}
	}

	function hideVideo(reason = 'hide') {
		reportTrace('Hiding video overlay.', { action: reason });
		videoElement?.pause();
		if (videoElement) videoElement.currentTime = 0;
		videoVisible = false;
		activeVideoKind = null;
	}

	function traceVideoEvent(event) {
		reportTrace(`Video event: ${event.type}.`, { action: `video_${event.type}` });
	}

	function handleVideoError() {
		reportTrace('Video media error.', { action: 'video_error' });
		hideVideo('video_error_hide');
	}

	$: iframeUrl = normalizeScoreboardUrl(data.options?.scoreboardUrl || '');
	$: visibleDecisionVideo = resolveVisibleDecisionVideo(data.displayMode, data.decision);
	$: visibleDecisionToken = decisionTokenFor(data.decision);
	$: decisionTraceSignature = JSON.stringify([
		data.fopUpdate?.fopState || '',
		data.decision?.type || '',
		data.decision?.visible === true,
		data.decision?.recordKind || '',
		data.decision?.ref1 || '',
		data.decision?.ref2 || '',
		data.decision?.ref3 || '',
		visibleDecisionVideo || ''
	]);
	$: if (decisionTraceSignature !== lastDecisionTraceSignature) {
		lastDecisionTraceSignature = decisionTraceSignature;
		reportTrace('Evaluated decision for celebration playback.', {
			action: 'decision_evaluated',
			statusMessage: `resolvedClip=${visibleDecisionVideo || 'none'}`
		});
	}
	$: if (visibleDecisionVideo && visibleDecisionToken && visibleDecisionToken !== lastDecisionToken) {
		lastDecisionToken = visibleDecisionToken;
		void playDecisionVideo(visibleDecisionVideo);
	} else if (!visibleDecisionVideo) {
		lastDecisionToken = null;
	}

	onMount(() => {
		if (visibleDecisionVideo) {
			void playDecisionVideo(visibleDecisionVideo);
		}
	});
</script>

{#if iframeUrl}
	<iframe class="scoreboard-frame" src={iframeUrl} title="OWLCMS scoreboard"></iframe>
{:else}
	<div class="configuration-error">Enter a valid HTTP or HTTPS OWLCMS scoreboard URL.</div>
{/if}

<div class:visible={videoVisible} class="video-overlay" aria-live="polite" aria-hidden={!videoVisible}>
	<video
		bind:this={videoElement}
		playsinline
		muted={data.options?.videoMuted !== false}
		on:loadstart={traceVideoEvent}
		on:loadedmetadata={traceVideoEvent}
		on:canplay={traceVideoEvent}
		on:playing={traceVideoEvent}
		on:ended={() => hideVideo('video_ended')}
		on:error={handleVideoError}
	></video>
</div>

<style>
	:global(html),
	:global(body) {
		margin: 0;
		width: 100%;
		height: 100%;
		overflow: hidden;
		background: #000;
	}

	.scoreboard-frame,
	.video-overlay,
	.configuration-error {
		position: fixed;
		inset: 0;
		width: 100%;
		height: 100%;
	}

	.scoreboard-frame {
		border: 0;
		background: #000;
	}

	.video-overlay {
		z-index: 1;
		background: #000;
		visibility: hidden;
	}

	.video-overlay.visible {
		visibility: visible;
	}

	.video-overlay video {
		width: 100%;
		height: 100%;
		object-fit: contain;
		background: #000;
	}

	.configuration-error {
		display: grid;
		place-items: center;
		box-sizing: border-box;
		padding: 2rem;
		background: #151515;
		color: #fff;
		font: 600 1.25rem/1.4 ui-sans-serif, sans-serif;
		text-align: center;
	}
</style>