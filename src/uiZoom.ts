// The whole UI can be magnified with a CSS `zoom` on <html> (the uiScale setting, App.tsx). A popover that
// portals into <body> is INSIDE that zoomed root, so a `position: fixed` left/top we set is multiplied by the
// zoom when painted. But getBoundingClientRect() and window.innerWidth report VISUAL (already-zoomed) pixels.
// Positioning code that mixes the two lands the popover at left*zoom, which flies off-screen once zoom > 1 and
// gets worse the larger the screen. These helpers map the anchor rect + viewport into the SAME local space the
// fixed popover is positioned in (divide the visual pixels by the zoom), so the clamp math and the applied
// left/top agree. Everything is a no-op at zoom 1.
export function uiZoom(): number {
  const z = parseFloat(document.documentElement.style.zoom || '1');
  return z && isFinite(z) && z > 0 ? z : 1;
}

export type LogicalRect = { left: number; top: number; right: number; bottom: number; width: number; height: number };

export function logicalRect(r: DOMRect): LogicalRect {
  const z = uiZoom();
  return { left: r.left / z, top: r.top / z, right: r.right / z, bottom: r.bottom / z, width: r.width / z, height: r.height / z };
}

export function logicalViewport(): { w: number; h: number } {
  const z = uiZoom();
  return { w: window.innerWidth / z, h: window.innerHeight / z };
}
