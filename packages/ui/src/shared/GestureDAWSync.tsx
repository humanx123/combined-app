/**
 * Gesture-DAW synchronization bridge.
 *
 * Keeps the gesture synthesizer's state in sync with the DAW's project state.
 * When a gesture is detected, it updates the DAW's arrangement. When the DAW
 * changes, it updates the gesture synthesizer's bindings.
 */

import { useEffect } from 'react';
import { useCombinedStore } from '@combined-app/engine';
import type { GestureEvent } from '@combined-app/engine';

/** Props for the sync bridge. */
interface GestureDAWSyncProps {
  onGesture?: (event: GestureEvent) => void;
}

/**
 * Synchronizes gesture events with the DAW project state.
 *
 * This component does not render anything. It subscribes to gesture events
 * and pushes them into the global store, and subscribes to project changes
 * to update gesture bindings.
 */
export function GestureDAWSync({ onGesture }: GestureDAWSyncProps) {
  const pushGestureEvent = useCombinedStore((state) => state.pushGestureEvent);
  const setGestureMode = useCombinedStore((state) => state.setGestureMode);
  const setInputMode = useCombinedStore((state) => state.setInputMode);

  // Listen for gesture events from the gesture synthesizer
  useEffect(() => {
    const handleGesture = (event: GestureEvent) => {
      pushGestureEvent(event);
      onGesture?.(event);
    };

    // Gesture synth dispatches events on window
    if (typeof window !== 'undefined') {
      window.addEventListener('gesture', handleGesture as EventListener);
    }

    return () => {
      if (typeof window !== 'undefined') {
        window.removeEventListener('gesture', handleGesture as EventListener);
      }
    };
  }, [pushGestureEvent, onGesture]);

  // Listen for mode changes
  useEffect(() => {
    const handleModeChange = (event: CustomEvent) => {
      const { mode } = event.detail;
      if (mode === 'recording' || mode === 'playing' || mode === 'disabled') {
        setGestureMode(mode);
      }
    };

    if (typeof window !== 'undefined') {
      window.addEventListener('gesture-mode-change', handleModeChange as EventListener);
    }

    return () => {
      if (typeof window !== 'undefined') {
        window.removeEventListener('gesture-mode-change', handleModeChange as EventListener);
      }
    };
  }, [setGestureMode]);

  // Listen for input mode changes
  useEffect(() => {
    const handleInputMode = (event: CustomEvent) => {
      const { mode } = event.detail;
      if (mode === 'gesture' || mode === 'keyboard' || mode === 'midi') {
        setInputMode(mode);
      }
    };

    if (typeof window !== 'undefined') {
      window.addEventListener('input-mode-change', handleInputMode as EventListener);
    }

    return () => {
      if (typeof window !== 'undefined') {
        window.removeEventListener('input-mode-change', handleInputMode as EventListener);
      }
    };
  }, [setInputMode]);

  return null;
}