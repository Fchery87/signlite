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
  const sessionRef = useRef(session);
  sessionRef.current = session;
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
    lifecycle.observeRevision(sessionRef.current, contentRevision);
  }, [contentRevision, lifecycle]);

  // Leave protection and flush-on-hide, registered only while work is
  // undurable. beforeunload only prevents navigation (browser-native
  // protection); an asynchronous save started during unload is not guaranteed
  // to complete, so none is attempted there.
  useEffect(() => {
    if (!state.ready || state.status === 'saved') return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    const onVisibilityChange = () => {
      if (document.hidden) lifecycle.flushLatest();
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [lifecycle, state.ready, state.status]);

  return {
    ...state,
    resumeSucceeded: () => lifecycle.dismissCandidate(),
    startFresh: () => {
      if (state.candidate) lifecycle.startFresh(state.candidate.id, resetSession);
    }
  };
}
