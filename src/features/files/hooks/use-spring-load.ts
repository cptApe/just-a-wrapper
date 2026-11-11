'use client';

import * as React from 'react';

// Spring-loaded navigation: while a drag is in flight,
// dwelling over a navigation target — a breadcrumb or a folder tile/row — for
// the dwell time opens it WITHOUT dropping. The payload lives in dataTransfer,
// so the drag survives the view change and the drop lands in whichever view is
// open when the user releases.

const SPRING_LOAD_DWELL_MS = 700;

export function useSpringLoad(open: () => void): {
  /** The dwell timer is running — the target is about to spring open. */
  armed: boolean;
  arm: () => void;
  disarm: () => void;
} {
  const timer = React.useRef<number | null>(null);
  const [armed, setArmed] = React.useState(false);
  const openLatest = React.useEffectEvent(open);

  const disarm = React.useCallback(() => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
    setArmed(false);
  }, []);

  const arm = () => {
    if (timer.current !== null) return; // already dwelling on this target
    setArmed(true);
    timer.current = window.setTimeout(() => {
      timer.current = null;
      setArmed(false);
      openLatest();
    }, SPRING_LOAD_DWELL_MS);
  };

  // The drag can end anywhere — a drop elsewhere, Esc — without this element
  // ever seeing dragleave, so a pending open must also clear on the
  // window-level end of the drag.
  React.useEffect(() => {
    if (!armed) return undefined;
    window.addEventListener('dragend', disarm);
    window.addEventListener('drop', disarm);
    return () => {
      window.removeEventListener('dragend', disarm);
      window.removeEventListener('drop', disarm);
    };
  }, [armed, disarm]);

  React.useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    },
    [],
  );

  return { armed, arm, disarm };
}
