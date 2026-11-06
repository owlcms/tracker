<script>
  import { browser, dev } from '$app/environment';
  import { invalidateAll } from '$app/navigation';
  import { onMount } from 'svelte';
  export let data;
  
  // Store option selections per scoreboard type AND per FOP
  let scoreboardOptions = {};
  
  // Modal state
  let showModal = false;
  let modalScoreboard = null;
  let modalFop = null;
  let activeOptionTab = null;
  
  // Collapse state for categories (accordion behavior - only one open at a time)
  let expandedCategory = null; // Start folded

  // Language name translations (from OWLCMS via Tracker.LocaleName)
  // These are dynamically loaded from the server and refreshed when data arrives
  $: languageNames = data.languageNames || {};
  $: availableLocales = data.availableLocales || [];

  const AUDIO_INPUT_KIND_NAMES = {
    auto: 'Auto-detect from OBS host',
    wasapi_input_capture: 'Windows (WASAPI)',
    coreaudio_input_capture: 'macOS (CoreAudio)',
    pulse_input_capture: 'Linux (PulseAudio / PipeWire-Pulse)',
    pipewire_audio_input_capture: 'Linux (PipeWire)',
    alsa_input_capture: 'Linux (ALSA)'
  };

  // Select choices supplied at runtime by a plugin action (e.g. the mic list
  // OBS reports): { [pluginType]: { [fop]: { [optionKey]: [{value,label}] } } }
  let runtimeOptionChoices = {};
  let refreshingOptionKeys = new Set();

  function mergeOptionChoices(pluginType, fop, choices) {
    if (!choices || typeof choices !== 'object') return;
    const byType = runtimeOptionChoices[pluginType] || {};
    const byFop = byType[fop] || {};
    runtimeOptionChoices = {
      ...runtimeOptionChoices,
      [pluginType]: { ...byType, [fop]: { ...byFop, ...choices } }
    };
  }

  function getOptionChoices(option) {
    const runtime = runtimeOptionChoices[modalScoreboard?.type]?.[modalFop]?.[option.key];
    if (Array.isArray(runtime) && runtime.length) {
      const current = scoreboardOptions[modalScoreboard.type]?.[modalFop]?.[option.key];
      const hasGroupedChoices = runtime.some((choice) => choice && typeof choice === 'object' && Array.isArray(choice.options));

      if (hasGroupedChoices) {
        const normalized = runtime.map((group) => ({
          group: group.group || 'Options',
          options: Array.isArray(group.options) ? group.options.map((choice) => ({
            value: choice.value,
            label: choice.label || choice.value
          })) : []
        }));

        if (current && !normalized.some((group) => group.options.some((choice) => choice.value === current))) {
          normalized.push({
            group: 'Selected value',
            options: [{ value: current, label: `${current} (not detected)` }]
          });
        }
        return normalized;
      }

      // Keep a value configured elsewhere selectable even if this host lacks it.
      if (current && !runtime.some((choice) => choice.value === current)) {
        return [...runtime, { value: current, label: `${current} (not detected)` }];
      }
      return runtime;
    }
    return (option.options || []).map((opt) => ({ value: opt, label: getDisplayName(opt, option.key) }));
  }

  async function refreshOptionChoices(option) {
    if (!modalScoreboard || !option?.refreshAction) return;
    refreshingOptionKeys = new Set(refreshingOptionKeys).add(option.key);
    try {
      await callPluginAction(modalScoreboard.type, option.refreshAction, modalFop, { silent: true });
    } finally {
      const next = new Set(refreshingOptionKeys);
      next.delete(option.key);
      refreshingOptionKeys = next;
    }
  }

  function getDisplayName(option, optionKey) {
    // If this is a language option, use the language name translations
    if (optionKey === 'language' && languageNames[option]) {
      return languageNames[option];
    }
    // Scene template: show filename or "None" for empty
    if (optionKey === 'sceneTemplate') {
      return option === '' ? 'None (manual OBS configuration)' : option;
    }
    if (optionKey === 'audioInputKind') {
      return AUDIO_INPUT_KIND_NAMES[option] || option;
    }
    return option;
  }

  function sortScoreboards(a, b) {
    return (a.order || 999) - (b.order || 999);
  }
  
  // Server-side defaults can be overridden by external JSON configuration.
  $: configuredCategoryOrder = Array.isArray(data.landingPageCategories) ? data.landingPageCategories : [];

  // Filter out hidden plugins (order === -1), then group by configured landing-page categories.
  $: visibleScoreboards = data.scoreboards.filter((scoreboard) => scoreboard.order !== -1);

  $: scoreboardsByCategory = visibleScoreboards.reduce((groups, scoreboard) => {
    const category = scoreboard?.category || '';
    if (!groups[category]) {
      groups[category] = [];
    }
    groups[category].push(scoreboard);
    return groups;
  }, {});

  $: categorySections = configuredCategoryOrder
    .map((section) => ({
      ...section,
      scoreboards: [...(scoreboardsByCategory[section.category] || [])].sort(sortScoreboards)
    }))
    .filter((section) => section.scoreboards.length > 0);

  function getCategoryIndex(category) {
    return configuredCategoryOrder.findIndex((section) => section.category === category);
  }
  
  // Compute CSS order for each category: expanded one gets order 0, others keep default order
  $: categoryOrder = (cat) => {
    const index = getCategoryIndex(cat);
    if (!expandedCategory) return index;
    if (cat === expandedCategory) return -1;  // Expanded goes first
    return index;
  };
  
  // Toggle function for accordion behavior
  function toggleCategory(category) {
    expandedCategory = expandedCategory === category ? null : category;
  }

  function getOptionDefaults(scoreboard) {
    const optionDefaults = {};
    scoreboard?.options?.forEach((opt) => {
      optionDefaults[opt.key] = opt.default;
    });
    return optionDefaults;
  }

  function getOptionContextKey(fop = '') {
    return fop ?? '';
  }

  function isCompetitionWideScoreboard(scoreboard) {
    return scoreboard?.fopRequired === false;
  }

  function getSingleLauncherLabel(scoreboard) {
    return scoreboard?.standalone ? 'Open' : 'All Platforms';
  }

  function getOptionsButtonTitle(scoreboard, fop = '') {
    if (scoreboard?.standalone) {
      return 'Configure options';
    }

    if (!fop || scoreboard?.fopRequired === false) {
      return scoreboard?.category === 'documents'
        ? 'Configure document options'
        : 'Configure competition-wide options';
    }

    return scoreboard?.category === 'documents'
      ? `Configure document options for Platform ${fop}`
      : `Configure options for Platform ${fop}`;
  }

  function getModalContextLabel(scoreboard, fop = '') {
    if (scoreboard?.type === 'iwf-results') {
      return 'Extract';
    }

    if (scoreboard?.standalone) {
      return 'Options';
    }

    if (!fop || scoreboard?.fopRequired === false) {
      return 'All Platforms';
    }

    return `Platform ${fop}`;
  }
  
  // Initialize default options for each scoreboard once the data is available
  let defaultsInitialized = false;
  $: if (!defaultsInitialized && data.scoreboards?.length) {
    const initialOptions = {};

    data.scoreboards.forEach((scoreboard) => {
      initialOptions[scoreboard.type] = {};

      if (isCompetitionWideScoreboard(scoreboard) || scoreboard.standalone) {
        initialOptions[scoreboard.type][''] = getOptionDefaults(scoreboard);
      }

      data.fops?.forEach((fop) => {
        initialOptions[scoreboard.type][fop] = getOptionDefaults(scoreboard);
      });
    });

    scoreboardOptions = initialOptions;
    defaultsInitialized = true;
  }
  
  function openOptionsModal(scoreboard, fop) {
    const optionKey = fop ?? '';

    // Ensure scoreboardOptions is initialized for this type and FOP
    if (!scoreboardOptions[scoreboard.type]) {
      scoreboardOptions[scoreboard.type] = {};
    }
    if (!scoreboardOptions[scoreboard.type][optionKey]) {
      scoreboardOptions[scoreboard.type][optionKey] = getOptionDefaults(scoreboard);
    }
    
    modalScoreboard = scoreboard;
    modalFop = optionKey;
    const optionTabs = getOptionTabs(scoreboard);
    activeOptionTab = optionTabs[0]?.groupName || null;
    showModal = true;

    for (const option of scoreboard.options || []) {
      if (option.refreshAction) refreshOptionChoices(option);
    }
  }
  
  function closeModal() {
    showModal = false;
    modalScoreboard = null;
    modalFop = null;
    activeOptionTab = null;
  }

  function getOptionTabs(scoreboard) {
    const options = scoreboard?.options || [];
    const groupNames = [...new Set(options.filter((option) => option.group).map((option) => option.group))];

    if (groupNames.length === 0) {
      return options.length > 0
        ? [{
            groupName: 'options',
            groupLabel: 'options',
            options
          }]
        : [];
    }

    const groupLabels = Object.fromEntries(
      options
        .filter((option) => option.group && option.groupLabel)
        .map((option) => [option.group, option.groupLabel])
    );
    const ungrouped = options.filter((option) => !option.group);

    // Ungrouped options get their own "General" tab, placed first
    const tabs = [];
    if (ungrouped.length > 0) {
      tabs.push({
        groupName: 'options',
        groupLabel: 'general',
        options: ungrouped
      });
    }

    groupNames.forEach((groupName) => {
      tabs.push({
        groupName,
        groupLabel: groupLabels[groupName] || groupName || 'Options',
        options: options.filter((option) => option.group === groupName)
      });
    });

    return tabs.filter((tab) => tab.options.length > 0);
  }

  function getTabPanelClass(groupName) {
    return groupName === 'options'
      ? 'options-tab-panel options-tab-panel-two-column options-tab-panel-generic'
      : 'options-tab-panel options-tab-panel-two-column';
  }

  function getModalText(scoreboard, key, fallback) {
    const customText = scoreboard?.config?.modalLabels?.[key];
    return typeof customText === 'string' && customText.trim() !== '' ? customText : fallback;
  }

  function formatTabLabel(label) {
    const text = String(label || '').trim();
    if (!text) {
      return '';
    }

    if (text === text.toUpperCase()) {
      return text;
    }

    return text.replace(/(^|[\s/-])(\S)/g, (match, prefix, char) => `${prefix}${char.toUpperCase()}`);
  }
  
  async function openScoreboard(type, fop, withOptions = false) {
    const optionKey = getOptionContextKey(fop);
    const options = scoreboardOptions[type]?.[optionKey] || {};
    const params = new URLSearchParams();
    
    // Find the scoreboard config to get default values
    const scoreboard = data.scoreboards.find(s => s.type === type);
    
    // Only add FOP if it's required or optional (not for fopRequired: false)
    if (fop && scoreboard?.fopRequired !== false) {
      params.append('fop', fop);
    }
    
    // Add configured options to URL (only if different from default)
    Object.entries(options).forEach(([key, value]) => {
      // Find the option config to get its default value
      const optionConfig = scoreboard?.options?.find(opt => opt.key === key);
      const defaultValue = optionConfig?.default;
      
      // Only include in URL if value is different from default and not empty
      if (value !== defaultValue && value !== undefined && value !== null && value !== '') {
        params.append(key, value);
      }
    });
    
    const url = `/${type}?${params.toString()}`;
    window.open(url, '_blank', 'noopener,noreferrer');

    if (withOptions) {
      closeModal();
    }
  }

  let confirmedFops = data.hasConfirmedFops ?? false;
  let protocolError = null;
  const defaultPageTitle = 'OWLCMS Tracker';
  $: pageTitle = confirmedFops && data.competitionName && data.competitionName !== 'OWLCMS Competition'
    ? data.competitionName
    : defaultPageTitle;

  // Quiet build-time version stamp (generated by scripts/generate-version.js).
  $: versionInfo = data.versionInfo || {};
  $: versionLabel = versionInfo.trackerVersion
    ? `v${versionInfo.trackerVersion} · ${versionInfo.trackerCommit || 'unknown'} · core ${versionInfo.trackerCoreVersion || 'unknown'}`
    : '';
  $: versionTitle = versionInfo.trackerVersion
    ? `tracker ${versionInfo.trackerVersion} (${versionInfo.trackerCommit || 'unknown'})\n`
      + `tracker-core ${versionInfo.trackerCoreVersion || 'unknown'} (${versionInfo.trackerCoreCommit || 'unknown'})\n`
      + `built ${versionInfo.builtAt || 'unknown'}`
    : '';

  /**
   * Open an export page (e.g., team-export) in a new tab with current options
   * @param {string} type - The scoreboard type (e.g., 'team-scoreboard')
   * @param {string} fop - The FOP name
   */
  function openExportPage(type, fop) {
    const optionKey = getOptionContextKey(fop);
    const options = scoreboardOptions[type]?.[optionKey] || {};
    const params = new URLSearchParams();
    
    // Find the scoreboard config
    const scoreboard = data.scoreboards.find(s => s.type === type);
    
    // Find the export page key from config.pages
    const exportPageKey = scoreboard?.config?.pages?.find(p => p.component === 'page-export.svelte')?.key;
    if (!exportPageKey) {
      alert('Export page not configured for this scoreboard');
      return;
    }
    
    // Add FOP parameter
    if (fop && scoreboard?.fopRequired !== false) {
      params.append('fop', fop);
    }
    
    // Add all configured options to URL
    Object.entries(options).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') {
        params.append(key, value);
      }
    });
    
    const url = `/${exportPageKey}?${params.toString()}`;
    window.open(url, '_blank', 'noopener,noreferrer');
    closeModal();
  }

  onMount(() => {
    if (!browser) return;
    const eventSource = new EventSource('/api/client-stream');
    const markConfirmed = () => {
      confirmedFops = true;
      // Invalidate page data to refresh locales from server
      invalidateAll();
    };

    const handleMessage = (event) => {
      try {
        const msg = JSON.parse(event.data || '{}');

        // Handle protocol errors
        if (msg?.type === 'protocol_error') {
          protocolError = {
            reason: msg.reason || 'Protocol version mismatch',
            received: msg.received || null,
            minimum: msg.minimum || null
          };
          return;
        }

        // Clear protocol error on protocol_ok
        if (msg?.type === 'protocol_ok') {
          protocolError = null;
          return;
        }

        // Normalize the message body - the hub sometimes uses `data`, sometimes `payload`.
        const body = msg?.data || msg?.payload || msg || {};

        // Accept several event types that indicate competition data is available.
        // OWLCMS/hub may send 'state_update', 'competition_initialized', 'init', or 'fop_update'.
        const okTypes = ['state_update', 'competition_initialized', 'init', 'fop_update', 'hub_ready'];

        const hasFops = Array.isArray(body?.fops) && body.fops.length > 0;
        const hasCompetition = !!body?.competition;

        if (okTypes.includes(msg?.type) && (hasFops || hasCompetition || msg?.type === 'fop_update' || msg?.type === 'hub_ready')) {
          // We are receiving valid hub data; clear any previously shown protocol error.
          protocolError = null;
          markConfirmed();
        }
        // If the hub explicitly sent a 'waiting' message, ensure we reflect that
        // by marking `confirmedFops` false so the UI returns to the Waiting state.
        // Also clear any stale protocol banner while disconnected.
        if (msg?.type === 'waiting' || body?.message?.toLowerCase?.().includes('waiting')) {
          protocolError = null;
          confirmedFops = false;
        }
      } catch (error) {
        console.warn('[Landing Page] Unable to parse SSE payload', error);
      }
    };

    eventSource.addEventListener('message', handleMessage);

    return () => {
      eventSource.removeEventListener('message', handleMessage);
      eventSource.close();
    };
  });

  function getScoreboardUrl(type, fop) {
    const optionKey = getOptionContextKey(fop);
    const options = scoreboardOptions[type]?.[optionKey] || {};
    const params = new URLSearchParams();
    
    // Find the scoreboard config to get default values
    const scoreboard = data.scoreboards.find(s => s.type === type);
    
    // Only add FOP if it's required or optional (not for fopRequired: false)
    if (fop && scoreboard?.fopRequired !== false) {
      params.append('fop', fop);
    }
    
    // Add configured options to URL (only if different from default)
    Object.entries(options).forEach(([key, value]) => {
      // Find the option config to get its default value
      const optionConfig = scoreboard?.options?.find(opt => opt.key === key);
      const defaultValue = optionConfig?.default;
      
      // Only include in URL if value is different from default and not empty
      if (value !== defaultValue && value !== undefined && value !== null && value !== '') {
        params.append(key, value);
      }
    });
    
    return `/${type}?${params.toString()}`;
  }

  function isOptionDisabled(option, currentOptions) {
    // 'allAthletes' can disable other fields
    if (option.disabledBy === 'allAthletes') {
       return !!currentOptions?.allAthletes;
    }
    // Generic: 'disabledBy: <otherOptionKey>' disables when that option is falsy
    if (option.disabledBy) {
      return !currentOptions?.[option.disabledBy];
    }
    return false;
  }

  // When a boolean option is disabled by a (falsy) controlling option, show the
  // value that will effectively apply instead of the stored override value.
  function effectiveBooleanValue(option, currentOptions) {
    const stored = currentOptions?.[option.key];
    if (option.disabledBy && !currentOptions?.[option.disabledBy] && option.effectiveWhenDisabled !== undefined) {
      const effective = option.effectiveWhenDisabled;
      if (typeof effective === 'boolean') return effective;
      if (effective?.competitionSetting) {
        return !!data.competitionSettings?.[effective.competitionSetting];
      }
    }
    return stored;
  }

  let showPdfModal = false;

  function handlePdfClick(event, scoreboardType) {
    if (dev) {
      event.preventDefault();
      showPdfModal = true;
    } else {
      // Production mode: show "please be patient" alert
      alert("Please be patient, PDF generation can take over a minute.");
    }
  }

  function closePdfModal() {
    showPdfModal = false;
  }

  function getModalActions(scoreboard) {
    return scoreboard?.config?.modalActions || [];
  }

  function canPersistOptions(scoreboard) {
    if (!scoreboard) return false;
    if (scoreboard.config?.persistOptions === false) return false;
    return Array.isArray(scoreboard.options) && scoreboard.options.length > 0;
  }

  async function saveOptionDefaults() {
    if (!modalScoreboard) return;
    const optionSnapshot = { ...(scoreboardOptions[modalScoreboard.type]?.[modalFop] || {}) };
    const result = await callPluginAction(modalScoreboard.type, 'saveOptions', modalFop, {
      optionValues: optionSnapshot
    });
    if (result?.success) {
      await invalidateAll();
      defaultsInitialized = false;
    }
  }

  /**
   * Call a plugin action (e.g., configureOBS)
   * @param {string} pluginType - The plugin type (e.g., 'streaming', 'ledwall')
   * @param {string} action - The action to call (e.g., 'configureOBS')
   * @param {string} fop - The FOP name
   */
  async function callPluginAction(pluginType, action, fop, { download = false, silent = false, optionValues = null } = {}) {
    const optionKey = getOptionContextKey(fop);
    const options = optionValues || scoreboardOptions[pluginType]?.[optionKey] || {};
    const params = new URLSearchParams();
    
    params.append('plugin', pluginType);
    params.append('action', action);
    
    // Add all configured options
    Object.entries(options).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') {
        params.append(key, value);
      }
    });
    
    // Add platform from the FOP parameter
    if (fop) {
      params.append('platform', fop);
    }
    
    try {
      const response = await fetch(`/api/plugin-action?${params.toString()}`);

      // If this is a download action and the server returned a file, trigger browser download
      const contentDisposition = response.headers.get('Content-Disposition');
      if (download && contentDisposition && contentDisposition.includes('attachment')) {
        const blob = await response.blob();
        const filenameMatch = contentDisposition.match(/filename="?([^"]+)"?/);
        const filename = filenameMatch ? filenameMatch[1] : 'download.json';
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.click();
        URL.revokeObjectURL(url);
        return { success: true, message: 'Download started' };
      }

      const result = await response.json();

      mergeOptionChoices(pluginType, optionKey, result.optionChoices);

      if (silent) {
        if (!result.success) {
          console.warn(`[Options] ${pluginType}.${action} failed: ${result.message || result.error || 'unknown error'}`);
        }
        return result;
      }

      if (result.success) {
        alert(`✅ ${result.message || 'Action completed successfully'}`);
      } else {
        alert(`❌ ${result.message || 'Action failed'}`);
      }
      return result;
    } catch (error) {
      if (!silent) alert(`❌ Error: ${error.message}`);
      return { success: false, message: error.message };
    }
  }

  async function runModalAction(actionDef) {
    if (!modalScoreboard || !actionDef?.action) return;

    const result = await callPluginAction(modalScoreboard.type, actionDef.action, modalFop, {
      download: actionDef.download === true
    });
    if (result?.success && (actionDef.refreshDataOnSuccess || result.refreshData)) {
      await invalidateAll();
      defaultsInitialized = false;
    }
    if (result?.success && actionDef.closeModalOnSuccess) {
      closeModal();
    }
  }
</script>

<svelte:head>
  <title>{pageTitle}</title>
</svelte:head>

<div class="container">
  <header class="header">
    <h1><img src="/left.png" alt="OWLCMS" class="header-logo" /> {pageTitle}</h1>
  </header>

  {#if protocolError}
    <div class="protocol-error">
      <div class="protocol-error-content">
        <h2>⚠️ Protocol Version Mismatch</h2>
        <p class="error-reason">{protocolError.reason}</p>
        {#if protocolError.received || protocolError.minimum}
          <p class="error-details">
            {#if protocolError.received}Received: <strong>{protocolError.received}</strong>{/if}
            {#if protocolError.received && protocolError.minimum} | {/if}
            {#if protocolError.minimum}Required: <strong>{protocolError.minimum}+</strong>{/if}
          </p>
        {/if}
      </div>
    </div>
  {:else if !confirmedFops}
    <div class="waiting">
      <div class="waiting-content">
        <h2>⏳ Waiting for Competition Data</h2>
        <p class="waiting-note">This page will automatically update when data arrives.</p>
      </div>
    </div>
  {/if}

    <main class="main">
      {#each categorySections as section}
        <section
          class="scoreboard-category collapsible"
          class:documents-section={section.category === 'documents'}
          style:order={categoryOrder(section.category)}
        >
          <!-- svelte-ignore a11y-click-events-have-key-events -->
          <!-- svelte-ignore a11y-no-noninteractive-element-interactions -->
          <h2 class="category-title clickable" on:click={() => toggleCategory(section.category)}>
            <span class="toggle-icon">{expandedCategory === section.category ? '▼' : '▶'}</span>
            {section.title}
          </h2>
          {#if expandedCategory === section.category}
            <div class="scoreboards-grid">
              {#each section.scoreboards as scoreboard}
                {#if section.category === 'documents'}
                  <div class="scoreboard-card document-card">
                    <h3>{scoreboard.name}</h3>
                    <p class="description">
                      {@html scoreboard.description}
                    </p>
                    <div class="fop-links">
                      {#if confirmedFops}
                        {#if scoreboard.fopRequired === false}
                          <div class="fop-list">
                            <div class="fop-row">
                              <a 
                                href={getScoreboardUrl(scoreboard.type, null)}
                                class="fop-link"
                                target="_blank"
                                rel="noopener noreferrer"
                              >
                                Generate
                              </a>
                              {#if scoreboard.additionalDependencies?.includes('puppeteer-core')}
                              <div class="pdf-btn-container">
                                <a 
                                  href="/api/generate-pdf?type={scoreboard.type}"
                                  class="pdf-btn"
                                  class:disabled={dev}
                                  title={dev 
                                    ? "In dev mode, you have to use the browser print. Automated generation requires a build version, click for details" 
                                    : "Please be patient, PDF generation can take a minute"}
                                  on:click={(e) => handlePdfClick(e, scoreboard.type)}
                                >
                                  📄 PDF
                                </a>
                                {#if dev}
                                  <span class="pdf-tooltip">In dev mode, you have to use the browser print<br/>Automated generation requires a build version, click for details</span>
                                {/if}
                              </div>
                              {/if}
                              {#if scoreboard.options && scoreboard.options.length > 0}
                                <button
                                  class="options-btn"
                                  on:click={() => openOptionsModal(scoreboard, '')}
                                  title={getOptionsButtonTitle(scoreboard)}
                                >
                                  ⚙️ Options
                                </button>
                              {/if}
                            </div>
                          </div>
                        {:else if scoreboard.fopRequired === 'optional'}
                          <h4>Document Views:</h4>
                          <div class="fop-list">
                            {#each data.fops as fop}
                              <div class="fop-row">
                                <a 
                                  href={getScoreboardUrl(scoreboard.type, fop)}
                                  class="fop-link"
                                  target="_blank"
                                  rel="noopener noreferrer"
                                >
                                  Platform {fop}
                                </a>
                                {#if scoreboard.options && scoreboard.options.length > 0}
                                  <button
                                    class="options-btn"
                                    on:click={() => openOptionsModal(scoreboard, fop)}
                                    title={getOptionsButtonTitle(scoreboard, fop)}
                                  >
                                    ⚙️ Options
                                  </button>
                                {/if}
                              </div>
                            {/each}
                            <div class="fop-row">
                              <a 
                                href={getScoreboardUrl(scoreboard.type, null)}
                                class="fop-link all-platforms"
                                target="_blank"
                                rel="noopener noreferrer"
                              >
                                All Platforms
                              </a>
                            </div>
                          </div>
                        {:else}
                          <h4>Document Views:</h4>
                          <div class="fop-list">
                            {#each data.fops as fop}
                              <div class="fop-row">
                                <a 
                                  href={getScoreboardUrl(scoreboard.type, fop)}
                                  class="fop-link"
                                  target="_blank"
                                  rel="noopener noreferrer"
                                >
                                  Platform {fop}
                                </a>
                                {#if scoreboard.options && scoreboard.options.length > 0}
                                  <button
                                    class="options-btn"
                                    on:click={() => openOptionsModal(scoreboard, fop)}
                                    title={getOptionsButtonTitle(scoreboard, fop)}
                                  >
                                    ⚙️ Options
                                  </button>
                                {/if}
                              </div>
                            {/each}
                          </div>
                        {/if}
                      {:else}
                        <div class="fop-list">
                          <div class="fop-link disabled">
                            <span class="fop-wait">Awaiting OWLCMS connection...</span>
                          </div>
                        </div>
                      {/if}
                    </div>
                  </div>
                {:else}
                  <div class="scoreboard-card">
                    <h3>{scoreboard.name}</h3>
                    <p class="description">{@html scoreboard.description}</p>
                    
                    <div class="fop-links">
                      {#if scoreboard.standalone || isCompetitionWideScoreboard(scoreboard)}
                        <div class="fop-list">
                          <div class="fop-row">
                            <a 
                              href={getScoreboardUrl(scoreboard.type, '')}
                              class="fop-link"
                              target="_blank"
                              rel="noopener noreferrer"
                            >
                              {getSingleLauncherLabel(scoreboard)}
                            </a>
                            {#if scoreboard.options && scoreboard.options.length > 0}
                              <button
                                class="options-btn"
                                on:click={() => openOptionsModal(scoreboard, '')}
                                title={getOptionsButtonTitle(scoreboard)}
                              >
                                ⚙️ Options
                              </button>
                            {/if}
                          </div>
                        </div>
                      {:else if confirmedFops}
                        <h4>Select Platform:</h4>
                        <div class="fop-list">
                          {#each data.fops as fop}
                            <div class="fop-row">
                              <a 
                                href={getScoreboardUrl(scoreboard.type, fop)}
                                class="fop-link"
                                target="_blank"
                                rel="noopener noreferrer"
                              >
                                Platform {fop}
                              </a>
                              {#if scoreboard.options && scoreboard.options.length > 0}
                                <button
                                  class="options-btn"
                                  on:click={() => openOptionsModal(scoreboard, fop)}
                                  title={getOptionsButtonTitle(scoreboard, fop)}
                                >
                                  ⚙️ Options
                                </button>
                              {/if}
                            </div>
                          {/each}
                        </div>
                      {:else}
                        <div class="fop-list">
                          <div class="fop-link disabled">
                            <span class="fop-wait">Awaiting OWLCMS connection...</span>
                          </div>
                        </div>
                      {/if}
                    </div>
                  </div>
                {/if}
              {/each}
            </div>
          {/if}
        </section>
      {/each}
    </main>
    {#if versionLabel}
      <div class="build-version" title={versionTitle}>{versionLabel}</div>
    {/if}
</div>

<!-- Options Modal -->
{#if showModal && modalScoreboard}
  <!-- svelte-ignore a11y-click-events-have-key-events -->
  <!-- svelte-ignore a11y-no-static-element-interactions -->
  <div class="modal-overlay" on:click={closeModal}>
    <!-- svelte-ignore a11y-click-events-have-key-events -->
    <!-- svelte-ignore a11y-no-static-element-interactions -->
    <div class="modal-content" on:click|stopPropagation>
      <div class="modal-header">
        <h3>{modalScoreboard.name} - {getModalContextLabel(modalScoreboard, modalFop)}</h3>
        <button class="close-btn" on:click={closeModal}>×</button>
      </div>
      
      <div class="modal-body">
        {#if modalScoreboard.options && modalScoreboard.options.length > 0}
          {@const optionTabs = getOptionTabs(modalScoreboard)}
          {@const activeTab = optionTabs.find((tab) => tab.groupName === activeOptionTab) || optionTabs[0]}
          <div class="options-tabs" role="tablist" aria-label="Configuration option groups">
            {#each optionTabs as tab}
              <button
                type="button"
                class:active-tab={activeTab?.groupName === tab.groupName}
                class="option-tab"
                role="tab"
                aria-selected={activeTab?.groupName === tab.groupName}
                on:click={() => activeOptionTab = tab.groupName}
              >
                {formatTabLabel(tab.groupLabel)}
              </button>
            {/each}
          </div>
          {#if activeTab}
            <div class={getTabPanelClass(activeTab.groupName)} role="tabpanel">
              {#each activeTab.options as option}
                {#if !option.hidden}
                <div class="option-field" class:disabled-option={isOptionDisabled(option, scoreboardOptions[modalScoreboard.type][modalFop])}>
                  <label for="{modalScoreboard.type}-{modalFop}-{option.key}">
                    {option.label}
                  </label>

                  {#if option.type === 'select'}
                    <div class="select-row" class:with-refresh={option.refreshAction}>
                      <select
                        id="{modalScoreboard.type}-{modalFop}-{option.key}"
                        bind:value={scoreboardOptions[modalScoreboard.type][modalFop][option.key]}
                        disabled={isOptionDisabled(option, scoreboardOptions[modalScoreboard.type][modalFop])}
                      >
                        {#each getOptionChoices(option) as choice}
                          {#if choice && typeof choice === 'object' && Array.isArray(choice.options)}
                            <optgroup label={choice.group || 'Options'}>
                              {#each choice.options as nested}
                                <option value={nested.value}>{nested.label}</option>
                              {/each}
                            </optgroup>
                          {:else}
                            <option value={choice.value}>{choice.label}</option>
                          {/if}
                        {/each}
                      </select>
                      {#if option.refreshAction}
                        <button
                          type="button"
                          class="refresh-option-btn"
                          title="Re-read the list from OBS"
                          disabled={refreshingOptionKeys.has(option.key)}
                          on:click={() => refreshOptionChoices(option)}
                        >
                          {refreshingOptionKeys.has(option.key) ? '…' : '⟳'}
                        </button>
                      {/if}
                    </div>
                  {:else if option.type === 'hidden'}
                    <input
                      type="hidden"
                      id="{modalScoreboard.type}-{modalFop}-{option.key}"
                      bind:value={scoreboardOptions[modalScoreboard.type][modalFop][option.key]}
                    />
                  {:else if option.type === 'boolean'}
                    {@const opts = scoreboardOptions[modalScoreboard.type][modalFop]}
                    {@const isDisabled = isOptionDisabled(option, opts)}
                    {@const boolValue = effectiveBooleanValue(option, opts)}
                    <div class="checkbox-wrapper">
                      {#if isDisabled}
                        <input 
                          type="checkbox" 
                          id="{modalScoreboard.type}-{modalFop}-{option.key}"
                          checked={boolValue}
                          disabled
                        />
                      {:else}
                        <input 
                          type="checkbox" 
                          id="{modalScoreboard.type}-{modalFop}-{option.key}"
                          bind:checked={scoreboardOptions[modalScoreboard.type][modalFop][option.key]}
                        />
                      {/if}
                      <label for="{modalScoreboard.type}-{modalFop}-{option.key}" class="checkbox-label">
                          {boolValue
                            ? getModalText(modalScoreboard, 'booleanTrue', 'Yes')
                            : getModalText(modalScoreboard, 'booleanFalse', 'No')}
                      </label>
                    </div>
                  {:else if option.type === 'number'}
                    <input 
                      type="number" 
                      id="{modalScoreboard.type}-{modalFop}-{option.key}"
                      bind:value={scoreboardOptions[modalScoreboard.type][modalFop][option.key]}
                      min={option.min}
                      max={option.max}
                      disabled={isOptionDisabled(option, scoreboardOptions[modalScoreboard.type][modalFop])}
                    />
                  {:else}
                    <input 
                      type={option.type === 'password' ? 'password' : 'text'}
                      id="{modalScoreboard.type}-{modalFop}-{option.key}"
                      bind:value={scoreboardOptions[modalScoreboard.type][modalFop][option.key]}
                      disabled={isOptionDisabled(option, scoreboardOptions[modalScoreboard.type][modalFop])}
                    />
                  {/if}

                  {#if option.description}
                    <p class="option-description">{option.description}</p>
                  {/if}
                </div>
                {/if}
              {/each}
            </div>
          {/if}
        {/if}
      </div>
      
      <div class="modal-footer">
        {#if canPersistOptions(modalScoreboard)}
          <button
            class="action-btn"
            on:click={saveOptionDefaults}
            title={getModalText(modalScoreboard, 'saveDefaultsTitle', 'Save the current values as defaults for this plugin (applies to all FOPs).')}
          >
            💾 {getModalText(modalScoreboard, 'saveDefaults', 'Save as Defaults')}
          </button>
        {/if}
        {#each getModalActions(modalScoreboard) as actionDef}
          <button
            class="action-btn"
            on:click={() => runModalAction(actionDef)}
            title={actionDef.title || actionDef.label}
          >
            {#if actionDef.icon}{actionDef.icon} {/if}{actionDef.label}
          </button>
        {/each}
        {#if modalScoreboard?.config?.pages?.length > 0}
          <button 
            class="action-btn" 
            on:click={() => openExportPage(modalScoreboard.type, modalFop)}
            title="Export team results to Excel"
          >
            📊 {getModalText(modalScoreboard, 'exportResults', 'Export Results')}
          </button>
        {/if}
        <button class="btn-secondary" on:click={closeModal}>{getModalText(modalScoreboard, 'cancel', 'Cancel')}</button>
        <button class="btn-primary" on:click={() => openScoreboard(modalScoreboard.type, modalFop, true)}>
          {getModalText(modalScoreboard, 'openScoreboard', 'Open')}
        </button>
      </div>
    </div>
  </div>
{/if}

{#if showPdfModal}
  <div class="modal-overlay" role="dialog" tabindex="0" on:click={closePdfModal} on:keydown={(e) => e.key === 'Escape' && closePdfModal()}>
    <div class="modal-content" role="none" on:click|stopPropagation>
      <div class="modal-header">
        <h3>PDF Generation (dev mode)</h3>
        <button class="close-btn" on:click={closePdfModal}>×</button>
      </div>
      <div class="modal-body">
        <p><strong>In dev mode, you have to use the browser print.</strong><br/>Open the document in your browser and use <strong>Print → Save as PDF</strong>.</p>
        <p>Automated generation requires a build version. To generate PDFs automatically:</p>
        <ol>
          <li>Build the app: <code>npm run build</code></li>
          <li>Run production: <code>node start-with-ws.js</code></li>
          <li>Then use the PDF generation</li>
        </ol>
      </div>
      <div class="modal-footer">
        <button class="btn-primary" on:click={closePdfModal}>OK</button>
      </div>
    </div>
  </div>
{/if}

<style>
  :global(body) {
    margin: 0;
    padding: 0;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
    background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
    color: #ffffff;
    min-height: 100vh;
  }
  
  .container {
    max-width: 1600px;
    margin: 0 auto;
    padding: 2rem;
    min-height: 100vh;
    display: flex;
    flex-direction: column;
  }
  
  .header {
    text-align: center;
    margin-bottom: 1rem;
    padding: 2rem 0;
  }
  
  .header h1 {
    font-size: 3rem;
    margin: 0 0 1rem 0;
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    background-clip: text;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
  }
  
  .header-logo {
    height: 2.5rem;
    width: auto;
  }
  
  .main {
    flex: 1;
    display: flex;
    flex-direction: column;
  }
  
  .build-version {
    position: fixed;
    right: 0.9rem;
    bottom: 0.7rem;
    text-align: right;
    font-size: 0.65rem;
    line-height: 1;
    color: #ffffff;
    opacity: 0.55;
    user-select: none;
    cursor: default;
    z-index: 5;
  }
  
  .description {
    color: #a0aec0;
    font-size: 0.95rem;
  }
  
  .scoreboard-category {
    margin-bottom: 1.5rem;
  }
  
  .category-title {
    font-size: 1.4rem;
    margin-bottom: 0.5rem;
    color: #e2e8f0;
    padding-bottom: 0.25rem;
    border-bottom: 2px solid rgba(102, 126, 234, 0.3);
  }
  
  .category-title.clickable {
    cursor: pointer;
    user-select: none;
    display: flex;
    align-items: center;
    gap: 0.75rem;
    transition: color 0.2s;
  }
  
  .category-title.clickable:hover {
    color: #667eea;
  }
  
  .toggle-icon {
    font-size: 1rem;
    transition: transform 0.3s;
  }
  
  .scoreboards-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
    gap: 1rem;
    margin-top: 0.75rem;
  }
  
  .documents-section .scoreboards-grid {
    grid-template-columns: repeat(auto-fit, minmax(280px, max-content));
    margin-top: 0.75rem;
  }

  .scoreboard-card {
    background: rgba(255, 255, 255, 0.05);
    border-radius: 8px;
    padding: 1rem;
    border: 1px solid rgba(255, 255, 255, 0.1);
    transition: transform 0.2s, box-shadow 0.2s;
  }
  
  .scoreboard-card:hover {
    transform: translateY(-4px);
    box-shadow: 0 12px 24px rgba(0, 0, 0, 0.3);
    border-color: rgba(102, 126, 234, 0.5);
  }
  
  .scoreboard-card h3 {
    font-size: 1.5rem;
    margin: 0 0 0.5rem 0;
    color: #667eea;
  }
  
  .scoreboard-card .description {
    font-size: 0.95rem;
    margin-bottom: 1.5rem;
    min-height: 3em;
  }

  .document-card {
    background: rgba(255, 255, 255, 0.08);
    border-color: rgba(255, 255, 255, 0.2);
  }

  .document-card .fop-link {
    flex: 0 0 auto;
  }

  .document-card .description {
    max-width: 280px;
  }
  
  .fop-list {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }
  
  .fop-row {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .fop-link {
    flex: 1;
    min-width: 0;
    display: block;
    padding: 0.75rem 1.5rem;
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    color: white;
    text-decoration: none;
    border-radius: 8px;
    font-weight: 600;
    transition: transform 0.2s, box-shadow 0.2s;
    font-size: 0.95rem;
    text-align: center;
  }
  
  .fop-link:hover {
    transform: scale(1.02);
    box-shadow: 0 4px 12px rgba(102, 126, 234, 0.4);
  }

  .fop-link.disabled {
    background: rgba(255, 255, 255, 0.15);
    cursor: not-allowed;
    pointer-events: none;
    opacity: 0.65;
  }

  .fop-wait {
    display: block;
    margin-top: 0.35rem;
    font-size: 0.75rem;
    color: #cbd5e0;
    font-weight: 400;
  }
  
  .options-btn {
    width: auto;
    height: 2.5rem;
    padding: 0 1rem;
    background: rgba(255, 255, 255, 0.1);
    border: 1px solid rgba(255, 255, 255, 0.2);
    border-radius: 8px;
    color: white;
    font-size: 0.95rem;
    cursor: pointer;
    transition: all 0.2s;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
  }
  
  .options-btn:hover {
    background: rgba(102, 126, 234, 0.3);
    border-color: #667eea;
    transform: scale(1.05);
  }
  
  .action-btn {
    width: auto;
    height: 2.5rem;
    padding: 0 1rem;
    background: rgba(102, 234, 126, 0.2);
    border: 1px solid rgba(102, 234, 126, 0.4);
    border-radius: 8px;
    color: white;
    font-size: 0.95rem;
    cursor: pointer;
    transition: all 0.2s;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
  }
  
  .action-btn:hover {
    background: rgba(102, 234, 126, 0.4);
    border-color: #66ea7e;
    transform: scale(1.05);
  }
  
  .pdf-btn {
    width: auto;
    height: 2.5rem;
    padding: 0 1rem;
    background: rgba(234, 102, 102, 0.2);
    border: 1px solid rgba(234, 102, 102, 0.4);
    border-radius: 8px;
    color: white;
    font-size: 0.95rem;
    cursor: pointer;
    transition: all 0.2s;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
    text-decoration: none;
  }
  
  .pdf-btn:hover {
    background: rgba(234, 102, 102, 0.4);
    border-color: #ea6666;
    transform: scale(1.05);
  }

  .pdf-btn.disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  .pdf-btn-container {
    position: relative;
    display: inline-block;
  }

  .pdf-tooltip {
    position: absolute;
    top: calc(100% + 6px);
    left: 50%;
    transform: translateX(-50%);
    background: #000;
    color: #fff;
    padding: 6px 8px;
    border-radius: 6px;
    font-size: 0.8rem;
    white-space: nowrap;
    opacity: 0;
    pointer-events: none;
    transition: opacity 0.15s ease;
    z-index: 5;
    box-shadow: 0 2px 6px rgba(0,0,0,0.3);
  }

  .pdf-btn-container:hover .pdf-tooltip {
    opacity: 1;
  }

  /* Modal Styles */
  .modal-overlay {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0, 0, 0, 0.7);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
    backdrop-filter: blur(4px);
  }
  
  .modal-content {
    background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
    border-radius: 12px;
    border: 1px solid rgba(255, 255, 255, 0.2);
    width: min(96vw, 1240px);
    height: min(88vh, 820px);
    min-height: min(88vh, 820px);
    max-height: 95vh;
    display: flex;
    flex-direction: column;
    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
    /* Ensure native form controls (selects, inputs) render in dark mode */
    color-scheme: dark;
  }
  
  .modal-header {
    padding: 1.5rem;
    border-bottom: 1px solid rgba(255, 255, 255, 0.1);
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  
  .modal-header h3 {
    margin: 0;
    color: #667eea;
    font-size: 1.3rem;
  }
  
  .close-btn {
    background: none;
    border: none;
    color: #a0aec0;
    font-size: 2rem;
    cursor: pointer;
    padding: 0;
    width: 2rem;
    height: 2rem;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 4px;
    transition: all 0.2s;
  }
  
  .close-btn:hover {
    background: rgba(255, 255, 255, 0.1);
    color: white;
  }
  
  .modal-body {
    padding: 1.5rem;
    overflow-y: auto;
    flex: 1;
    min-height: 0;
    color: #e2e8f0;
  }

  .modal-body ol {
    padding-left: 1.5rem;
    margin: 0.5rem 0 1rem;
  }

  .modal-body code {
    background: rgba(255, 255, 255, 0.08);
    padding: 2px 6px;
    border-radius: 4px;
    color: #fbd38d;
  }
  
  .modal-footer {
    padding: 1.5rem;
    border-top: 1px solid rgba(255, 255, 255, 0.1);
    display: flex;
    justify-content: flex-end;
    gap: 1rem;
  }
  
  .btn-primary,
  .btn-secondary {
    padding: 0.75rem 1.5rem;
    border: none;
    border-radius: 8px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.2s;
    font-size: 0.95rem;
  }
  
  .btn-primary {
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    color: white;
  }
  
  .btn-primary:hover {
    transform: scale(1.05);
    box-shadow: 0 4px 12px rgba(102, 126, 234, 0.4);
  }
  
  .btn-secondary {
    background: rgba(255, 255, 255, 0.05);
    color: #a0aec0;
    border: 1px solid rgba(255, 255, 255, 0.2);
  }
  
  .btn-secondary:hover {
    background: rgba(255, 255, 255, 0.1);
    color: white;
  }
  
  .options-grid {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  .options-tabs {
    display: flex;
    flex-wrap: wrap;
    gap: 0;
    margin-bottom: 1.25rem;
    padding-bottom: 0;
    border-bottom: 1px solid rgba(255, 255, 255, 0.1);
  }

  .option-tab {
    border: none;
    border-bottom: 3px solid transparent;
    background: transparent;
    color: #94a3b8;
    padding: 0.9rem 1.15rem 0.8rem;
    margin-bottom: -1px;
    cursor: pointer;
    font-size: 0.95rem;
    font-weight: 600;
    transition: all 0.2s ease;
  }

  .option-tab:hover {
    color: #e2e8f0;
    background: rgba(255, 255, 255, 0.04);
  }

  .option-tab.active-tab {
    color: #ffffff;
    border-bottom-color: #7c9cff;
    background: linear-gradient(180deg, rgba(124, 156, 255, 0.14) 0%, rgba(124, 156, 255, 0.02) 100%);
  }

  .options-tab-panel {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: 1rem 1.25rem;
    align-content: start;
    justify-content: start;
  }

  .options-tab-panel-two-column {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    align-items: start;
  }
  
  .options-columns {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
    gap: 2rem;
  }
  
  .options-column {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }
  
  .column-title {
    font-size: 0.95rem;
    color: #667eea;
    margin: 0 0 0.5rem 0;
    padding-bottom: 0.5rem;
    border-bottom: 1px solid rgba(102, 126, 234, 0.3);
    font-weight: 600;
  }
  
  .disabled-option {
    opacity: 0.5;
    pointer-events: none;
  }
  
  .disabled-option input,
  .disabled-option select {
    background: #2a2a3a;
    cursor: not-allowed;
  }
  
  @media (max-width: 900px) {
    .modal-content {
      width: min(96vw, 1100px);
      height: min(90vh, 760px);
      min-height: min(90vh, 760px);
    }

    .options-tab-panel-two-column {
      grid-template-columns: 1fr;
    }

    .options-columns {
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 1.5rem;
    }
  }

  @media (max-width: 600px) {
    .modal-content {
      width: 100vw;
      height: 100vh;
      min-height: 100vh;
      max-height: 100vh;
      border-radius: 0;
      border-left: none;
      border-right: none;
    }

    .options-tabs {
      flex-wrap: nowrap;
      overflow-x: auto;
      scrollbar-width: thin;
    }

    .option-tab {
      flex: 1 0 auto;
      text-align: center;
      padding-left: 0.9rem;
      padding-right: 0.9rem;
    }

    .options-columns {
      grid-template-columns: 1fr;
      gap: 1.25rem;
    }
  }
  
  .option-field {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    width: min(100%, 34rem);
  }
  
  .option-field > label {
    font-size: 0.9rem;
    color: #cbd5e0;
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-weight: 500;
  }
  
  .option-description {
    margin: -0.15rem 0 0;
    color: #cbd5e0;
    font-size: 0.8rem;
    line-height: 1.35;
  }
  
  .option-field select,
  .option-field input[type="text"],
  .option-field input[type="password"],
  .option-field input[type="number"] {
    padding: 0.75rem;
    background: rgba(255, 255, 255, 0.05);
    border: 1px solid rgba(255, 255, 255, 0.2);
    border-radius: 8px;
    color: white;
    font-size: 0.95rem;
  }

  /* Fix: readable dropdown list items in dark modal (Windows/Chromium/Firefox) */
  .option-field select option {
    background-color: #0f172a; /* slate-900 */
    color: #e5e7eb;            /* slate-200 */
  }
  .option-field select option:checked {
    background-color: #4f46e5; /* indigo-600 */
    color: #ffffff;
  }
  
  .option-field select:focus,
  .option-field input:focus {
    outline: none;
    border-color: #667eea;
    background: rgba(255, 255, 255, 0.1);
  }

  .select-row {
    display: flex;
    align-items: stretch;
    gap: 0.5rem;
  }

  .select-row select {
    flex: 1;
    min-width: 0;
  }

  .refresh-option-btn {
    padding: 0 0.85rem;
    background: rgba(255, 255, 255, 0.05);
    border: 1px solid rgba(255, 255, 255, 0.2);
    border-radius: 8px;
    color: #e5e7eb;
    font-size: 1rem;
    cursor: pointer;
  }

  .refresh-option-btn:hover:not(:disabled) {
    background: rgba(255, 255, 255, 0.12);
    border-color: #667eea;
  }

  .refresh-option-btn:disabled {
    opacity: 0.5;
    cursor: default;
  }
  
  .checkbox-wrapper {
    display: flex;
    align-items: center;
    gap: 0.75rem;
  }
  
  .option-field input[type="checkbox"] {
    width: 1.5rem;
    height: 1.5rem;
    cursor: pointer;
  }
  
  .checkbox-label {
    font-size: 0.9rem;
    color: #a0aec0;
  }
  
  .fop-links h4 {
    font-size: 0.9rem;
    color: #a0aec0;
    margin: 0 0 0.75rem 0;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }
  
  .protocol-error {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0 0 2rem 0;
    width: 100%;
  }
  
  .protocol-error-content {
    max-width: 700px;
    text-align: center;
    background: rgba(127, 29, 29, 0.3);
    padding: 3rem;
    border-radius: 12px;
    border: 2px solid #7f1d1d;
    color: #fecaca;
  }
  
  .protocol-error-content h2 {
    font-size: 2rem;
    margin-bottom: 1rem;
    color: #fecaca;
  }
  
  .error-reason {
    font-size: 1.2rem;
    margin: 1rem 0;
    font-weight: 500;
  }
  
  .error-details {
    font-size: 1rem;
    margin: 1rem 0;
    color: #fca5a5;
  }
  
  .waiting {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0 0 2rem 0;
    width: 100%;
  }
  
  .waiting-content {
    max-width: 600px;
    text-align: center;
    background: rgba(255, 255, 255, 0.05);
    padding: 3rem;
    border-radius: 12px;
    border: 1px solid rgba(255, 255, 255, 0.1);
    color: #e2e8f0;
  }
  
  .waiting-content h2 {
    font-size: 2rem;
    margin-bottom: 1rem;
    color: #e2e8f0;
  }
  
  .waiting-note {
    margin-top: 1.5rem;
    font-size: 1.1rem;
    color: #a0aec0;
    font-style: italic;
  }
  
  @media (max-width: 768px) {
    .container {
      padding: 1rem;
    }
    .header h1 {
      font-size: 2rem;
    }
    .scoreboards-grid {
      grid-template-columns: 1fr;
    }
    .waiting-content {
      padding: 2rem 1.5rem;
    }
  }
</style>