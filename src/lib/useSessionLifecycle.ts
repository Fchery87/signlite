import { useEffect, useRef, useState } from 'react';
import type { WorkSession } from '../db/schema';
import { createActiveSessionLifecycle, type DurabilityState } from './sessionLifecycle';

type LifecycleInput = {
  session: WorkSession;
  contentRevision: number;
  resetSession: () => void;
};

export function useSessionLifecycle({ session, contentRevision, resetSession }: LifecycleInput) {
  const lifecycleRef = useRef<ReturnType<typeof createActiveSessionLifecycle> | null>(null);
  if (!lifecycleRef.current) lifecycleRef.current = createActiveSessionLifecycle();
  const lifecycle = lifecycleRef.current;
  const [state, setState] = useState<DurabilityState>(lifecycle.getState());

  useEffect(() => {
    const unsubscribe = lifecycle.subscribe(setState);
    void lifecycle.startup();
    return () => {
      unsubscribe();
      lifecycle.dispose();
    };
  }, [lifecycle]);

  useEffect(() => {
    lifecycle.observeRevision(session, contentRevision);
  }, [contentRevision, lifecycle, session]);

  return {
    ...state,
    resumeSucceeded: () => lifecycle.dismissCandidate(),
    startFresh: () => {
      if (state.candidate) lifecycle.startFresh(state.candidate.id, resetSession);
    }
  };
}
