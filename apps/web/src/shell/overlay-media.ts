/** Viewport where the inspector overlays the canvas instead of taking a column. */
export const OVERLAY_MEDIA_QUERY = "(max-width: 759px)";

export const subscribeOverlay = (onStoreChange: () => void): (() => void) => {
  if (typeof window.matchMedia !== "function") {
    return () => undefined;
  }
  const media = window.matchMedia(OVERLAY_MEDIA_QUERY);
  media.addEventListener("change", onStoreChange);
  return () => {
    media.removeEventListener("change", onStoreChange);
  };
};

export const readOverlay = (): boolean => {
  if (typeof window.matchMedia !== "function") {
    return false;
  }
  return window.matchMedia(OVERLAY_MEDIA_QUERY).matches;
};

export const readOverlayOnServer = (): boolean => false;
