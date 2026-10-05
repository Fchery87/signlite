import { useSyncExternalStore } from 'react';
import { getRuntimeState, retryRuntime, subscribeRuntime } from '../pdf/runtime';

/** Observes the signing runtime's readiness. Intake stays disabled until this
 *  reports ready, so a user cannot start work the app cannot finish offline. */
export function useRuntimeReadiness() {
  const state = useSyncExternalStore(subscribeRuntime, getRuntimeState);
  return { state, retry: retryRuntime };
}
