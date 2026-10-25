import { useEffect, useRef, useState, type RefObject } from 'react';
import { Keyboard, LayoutAnimation, Platform, type KeyboardEvent, type ViewInstance } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

/**
 * Pixels of `viewBottom` hidden by a keyboard whose top edge is `keyboardTop`
 * (window coordinates). The home-indicator inset is subtracted: the keyboard
 * already covers it, so a pinned footer only needs to rise by the rest.
 */
export function keyboardOverlap(viewBottom: number, keyboardTop: number, safeBottom: number): number {
  return Math.max(0, Math.round(viewBottom - keyboardTop - Math.max(0, safeBottom)));
}

/** Moves the padding in step with the keyboard animation (as KeyboardAvoidingView does). */
function animateWithKeyboard(event: KeyboardEvent): void {
  const duration = Math.max(10, event.duration ?? 0);
  LayoutAnimation.configureNext({ duration, update: { duration, type: LayoutAnimation.Types.keyboard } });
}

/**
 * iOS keyboard avoidance for a full-height view. Attach `ref` to the view and
 * apply `inset` as its bottom padding. The view is measured in window
 * coordinates, so it also works inside modal sheets, where the sheet's own
 * offset makes `KeyboardAvoidingView` (parent-relative frame) under-shoot.
 * Android resizes the window itself (adjustResize) and web has no soft
 * keyboard overlay, so the inset stays 0 there.
 */
export function useKeyboardInset(): { ref: RefObject<ViewInstance | null>; inset: number } {
  const ref = useRef<ViewInstance>(null);
  const [inset, setInset] = useState(0);
  const current = useRef(0);
  const { bottom } = useSafeAreaInsets();

  useEffect(() => {
    if (Platform.OS !== 'ios') return undefined;
    const apply = (next: number, event: KeyboardEvent) => {
      if (next === current.current) return;
      current.current = next;
      animateWithKeyboard(event);
      setInset(next);
    };
    const change = Keyboard.addListener('keyboardWillChangeFrame', (event) => {
      const keyboardTop = event.endCoordinates.screenY;
      ref.current?.measureInWindow((_x, y, _width, height) => apply(keyboardOverlap(y + height, keyboardTop, bottom), event));
    });
    const hide = Keyboard.addListener('keyboardWillHide', (event) => apply(0, event));
    return () => {
      change.remove();
      hide.remove();
    };
  }, [bottom]);

  return { ref, inset };
}
