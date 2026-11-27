/**
 * V1 Format Parser - Parses OWLCMS V1 (legacy) database format
 * 
 * V1 Format Features:
 * - No formatVersion field
 * - Uses numeric ID references
 * - String representations of numbers
 * - May have groupAthletes as string or object
 * - Categories referenced by numeric IDs
 */

/**
 * Parse V1 format database from OWLCMS
 * @param {Object} params - V1 database payload
 * @returns {Object} Normalized competition state
 */
export function parseV1Database(params) {
  console.log('[V1 Parser] Parsing V1 format database (legacy)');
  
  const providedChecksum = params?.databaseChecksum || params?.checksum || null;

  // If params has athletes array directly, it's already structured
  if (params.athletes && Array.isArray(params.athletes)) {
    console.log(`[V1 Parser] Received structured database with ${params.athletes.length} athletes`);
    console.log(`[V1 Parser] Database has ageGroups:`, !!params.ageGroups, 'count:', params.ageGroups?.length || 0);
    console.log(`[V1 Parser] Database has competition:`, !!params.competition);
    console.log(`[V1 Parser] Database has platforms:`, !!params.platforms, 'count:', params.platforms?.length || 0);
    
    // Return the entire database structure as-is with minimal processing
    return {
      ...params,
      initialized: true,
      lastUpdate: Date.now(),
      databaseChecksum: providedChecksum || params.databaseChecksum || null
    };
  }
  
  // Otherwise, parse from groupAthletes (legacy embedded format)
  console.log('[V1 Parser] Parsing from groupAthletes format (embedded)');
  const result = {};

  // Basic competition info
  result.competition = {
    name: params.competitionName || 'Competition',
    fop: params.fop || 'A',
    state: params.fopState || 'INACTIVE',
    currentSession: params.sessionName || 'A',
    date: new Date().toISOString().split('T')[0]
  };

  // Parse athletes data - expect nested objects from WebSocket
  if (params.groupAthletes && Array.isArray(params.groupAthletes)) {
    result.athletes = params.groupAthletes
      .filter(athlete => !athlete.isSpacer)
      .map(athlete => ({
        id: athlete.startNumber,
        startNumber: parseInt(athlete.startNumber),
        fullName: athlete.fullName,
        name: athlete.fullName,
        teamName: athlete.teamName,
        team: athlete.teamName,
        yearOfBirth: athlete.yearOfBirth,
        category: athlete.category,
        categoryName: athlete.category,
        group: athlete.group,
        
        // Snatch attempts (V1 uses string values)
        snatch1Weight: athlete.sattempts?.[0]?.stringValue ? parseInt(athlete.sattempts[0].stringValue) : null,
        snatch1Result: athlete.sattempts?.[0]?.liftStatus === 'good' ? 'good' : 
                      athlete.sattempts?.[0]?.liftStatus === 'fail' ? 'no' : null,
        snatch2Weight: athlete.sattempts?.[1]?.stringValue ? parseInt(athlete.sattempts[1].stringValue) : null,
        snatch2Result: athlete.sattempts?.[1]?.liftStatus === 'good' ? 'good' : 
                      athlete.sattempts?.[1]?.liftStatus === 'fail' ? 'no' : null,
        snatch3Weight: athlete.sattempts?.[2]?.stringValue ? parseInt(athlete.sattempts[2].stringValue) : null,
        snatch3Result: athlete.sattempts?.[2]?.liftStatus === 'good' ? 'good' : 
                      athlete.sattempts?.[2]?.liftStatus === 'fail' ? 'no' : null,
        
        // Clean & Jerk attempts (V1 uses string values)
        cleanJerk1Weight: athlete.cattempts?.[0]?.stringValue ? parseInt(athlete.cattempts[0].stringValue) : null,
        cleanJerk1Result: athlete.cattempts?.[0]?.liftStatus === 'good' ? 'good' : 
                         athlete.cattempts?.[0]?.liftStatus === 'fail' ? 'no' : null,
        cleanJerk2Weight: athlete.cattempts?.[1]?.stringValue ? parseInt(athlete.cattempts[1].stringValue) : null,
        cleanJerk2Result: athlete.cattempts?.[1]?.liftStatus === 'good' ? 'good' : 
                         athlete.cattempts?.[1]?.liftStatus === 'fail' ? 'no' : null,
        cleanJerk3Weight: athlete.cattempts?.[2]?.stringValue ? parseInt(athlete.cattempts[2].stringValue) : null,
        cleanJerk3Result: athlete.cattempts?.[2]?.liftStatus === 'good' ? 'good' : 
                         athlete.cattempts?.[2]?.liftStatus === 'fail' ? 'no' : null,
        
        // Computed totals (V1 uses string values with '-' for null)
        bestSnatch: athlete.bestSnatch !== '-' ? parseInt(athlete.bestSnatch) : 0,
        bestCleanJerk: athlete.bestCleanJerk !== '-' ? parseInt(athlete.bestCleanJerk) : 0,
        total: athlete.total !== '-' ? parseInt(athlete.total) : 0,
        sinclair: athlete.sinclair !== '-' ? parseFloat(athlete.sinclair) : 0,
        
        // Rankings (V1 uses string values with '-' for null)
        snatchRank: athlete.snatchRank !== '-' ? parseInt(athlete.snatchRank) : null,
        cleanJerkRank: athlete.cleanJerkRank !== '-' ? parseInt(athlete.cleanJerkRank) : null,
        totalRank: athlete.totalRank !== '-' ? parseInt(athlete.totalRank) : null,
        sinclairRank: athlete.sinclairRank !== '-' ? parseInt(athlete.sinclairRank) : null,
        
        // UI state
        classname: athlete.classname,
        isCurrent: athlete.classname?.includes('current'),
        isNext: athlete.classname?.includes('next')
      }));
    
    console.log(`[V1 Parser] Loaded ${result.athletes.length} athletes from groupAthletes`);
  } else if (params.athletes && Array.isArray(params.athletes)) {
    result.athletes = params.athletes;
    console.log(`[V1 Parser] Loaded ${result.athletes.length} athletes from athletes field`);
  } else {
    result.athletes = [];
  }

  // Parse lifting order if provided
  if (params.liftingOrderAthletes && Array.isArray(params.liftingOrderAthletes)) {
    result.liftingOrder = params.liftingOrderAthletes
      .filter(athlete => !athlete.isSpacer)
      .map((athlete, index) => ({
        athleteId: athlete.startNumber,
        athleteName: athlete.fullName,
        teamName: athlete.teamName,
        position: index + 1,
        weight: athlete.sattempts?.[0]?.stringValue ? parseInt(athlete.sattempts[0].stringValue) : null,
        lift: 'snatch',
        attemptNumber: 1,
        isCurrent: athlete.classname?.includes('current'),
        isNext: athlete.classname?.includes('next')
      }));
    
    console.log(`[V1 Parser] Loaded ${result.liftingOrder.length} athletes in lifting order`);
  } else if (params.liftingOrder && Array.isArray(params.liftingOrder)) {
    result.liftingOrder = params.liftingOrder;
  } else {
    result.liftingOrder = [];
  }

  // Current attempt info
  if (params.currentAthlete && typeof params.currentAthlete === 'object') {
    result.currentAttempt = params.currentAthlete;
  } else if (params.fullName) {
    result.currentAttempt = {
      athleteName: params.fullName,
      teamName: params.teamName,
      startNumber: params.startNumber ? parseInt(params.startNumber) : null,
      categoryName: params.categoryName,
      attempt: params.attempt,
      attemptNumber: params.attemptNumber ? parseInt(params.attemptNumber) : null,
      weight: params.weight ? parseInt(params.weight) : null
    };
  }

  // Timer state
  const duration = params.timeAllowed ? parseInt(params.timeAllowed) : 0;
  const initialWarningMillis = duration === 120000 ? 90000 : -1;
  const finalWarningMillis = (duration === 120000 || duration === 60000) ? 30000 : -1;
  result.timer = {
    state: params.timerRunning === 'true' ? 'running' : 'stopped',
    timeRemaining: params.timeRemaining ? parseInt(params.timeRemaining) : 0,
    duration,
    initialWarningMillis,
    finalWarningMillis,
    startTime: params.timerRunning === 'true' ? Date.now() : null
  };

  // Groups and categories
  if (params.groups && Array.isArray(params.groups)) {
    result.groups = params.groups;
  }

  if (params.categories && Array.isArray(params.categories)) {
    result.categories = params.categories;
  }

  // Display settings
  result.displaySettings = {
    showLiftRanks: params.showLiftRanks === 'true',
    showTotalRank: params.showTotalRank === 'true',  
    showSinclair: params.showSinclair === 'true',
    showSinclairRank: params.showSinclairRank === 'true',
    wideTeamNames: params.wideTeamNames === 'true',
    sinclairMeet: params.sinclairMeet === 'true',
    stylesDir: params.stylesDir,
    mode: params.mode
  };

  return {
    ...result,
    databaseChecksum: providedChecksum || null
  };
}
