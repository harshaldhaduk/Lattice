// Measure the actual syntax-highlighted text. Canvas estimates miss host styles,
// tab stops, fallback fonts, ligatures, and VS Code font/zoom changes.
export function cursorGeometry(
  code: HTMLElement,
  column: number,
  sheet: HTMLElement,
) {
  const line = code.parentElement!;
  const bounds = sheet.getBoundingClientRect();
  const row = line.getBoundingClientRect();
  // Client rects include ancestor CSS zoom; transforms below use layout pixels.
  const scaleX = bounds.width / sheet.offsetWidth || 1;
  const scaleY = bounds.height / sheet.offsetHeight || 1;
  const walker = document.createTreeWalker(code, NodeFilter.SHOW_TEXT);
  let remaining = Math.max(0, column),
    node: Node | null;
  let x = code.getBoundingClientRect().left;
  while ((node = walker.nextNode())) {
    const length = node.textContent?.length || 0;
    if (remaining <= length) {
      const range = document.createRange();
      range.setStart(node, remaining);
      range.collapse(true);
      const caret = range.getClientRects()[0];
      if (caret) x = caret.left;
      break;
    }
    remaining -= length;
  }
  return {
    x: (x - bounds.left) / scaleX,
    y: (row.top - bounds.top) / scaleY,
    height: row.height / scaleY,
  };
}
