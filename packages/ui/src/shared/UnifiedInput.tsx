/**
 * Unified input handler that bridges gesture, keyboard, and MIDI inputs
 * into a single stream of audio events.
 *
 * This is the key integration point between Gesture Synth Weld and Vibe DAW:
 * it lets the user play with their hands, their keyboard, or a MIDI controller
 * — and all three feed the same audio engine.
 */

import { useEffect, useRef, useCallback } from 'react';
import { audioEngine } from '@combined-app/engine';
import type { GestureEvent, MidiNote, Velocity } from '@combined-app/engine';

/** Props for the unified input provider. */
interface UnifiedInputProps {
  onGesture?: (event: GestureEvent) => void;
  onMidi?: (note: MidiNote, velocity: Velocity) => void;
  onKeyboard?: (note: MidiNote, velocity: Velocity) => void;
  enabled?: boolean;
  children: React.ReactNode;
}

/**
 * Provides a unified input context to its children.
 *
 * This component does not do the actual gesture recognition — that happens
 * in the gesture-synth-app. Instead, it provides a stable interface for
 * child components to register input handlers and receive events.
 */
export function UnifiedInput({ onGesture, onMidi, onKeyboard, enabled = true, children }: UnifiedInputProps) {
  const handlersRef = useRef({
    gesture: onGesture,
    midi: onMidi,
    keyboard: onKeyboard,
  });

  // Keep refs updated without re-rendering
  useEffect(() => {
    handlersRef.current = { gesture: onGesture, midi: onMidi, keyboard: onKeyboard };
  });

  /** Dispatch a gesture event to the audio engine and callbacks. */
  const dispatchGesture = useCallback(
    (event: GestureEvent) => {
      if (!enabled) return;
      handlersRef.current.gesture?.(event);
    },
    [enabled],
  );

  /** Dispatch a MIDI note to the audio engine and callbacks. */
  const dispatchMidi = useCallback(
    (note: MidiNote, velocity: Velocity) => {
      if (!enabled) return;
      handlersRef.current.midi?.(note, velocity);
    },
    [enabled],
  );

  /** Dispatch a keyboard note to the audio engine and callbacks. */
  const dispatchKeyboard = useCallback(
    (note: MidiNote, velocity: Velocity) => {
      if (!enabled) return;
      handlersRef.current.keyboard?.(note, velocity);
    },
    [enabled],
  );

  // Expose dispatch functions on window for gesture-synth-app to use
  useEffect(() => {
    if (typeof window !== 'undefined') {
      (window as any).__combinedInput = {
        dispatchGesture,
        dispatchMidi,
        dispatchKeyboard,
      };
    }
    return () => {
      if (typeof window !== 'undefined') {
        delete (window as any).__combinedInput;
      }
    };
  }, [dispatchGesture, dispatchMidi, dispatchKeyboard]);

  return <>{children}</>;
}

/** Hook to access the unified input dispatchers. */
export function useUnifiedInput() {
  const dispatch = (window as any).__combinedInput;
  if (!dispatch) {
    throw new Error('useUnifiedInput must be used within a UnifiedInput provider');
  }
  return dispatch;
}