/**
 * Timer Decision Helpers Shim - Re-exports tracker-core utils
 * 
 * This file is a shim to maintain backward compatibility with existing imports.
 * The actual implementation lives in @owlcms/tracker-core/utils.
 */

export { 
  extractTimers, 
  computeDisplayMode,
  extractDecisionState, 
  extractDecisionDisplayDefaults,
  extractTimerAndDecisionState 
} from '@owlcms/tracker-core/utils';
