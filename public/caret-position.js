// Computes the on-screen pixel position of a <textarea>'s caret, so
// slash-menu.js can anchor its floating menu there. Browsers don't expose
// caret coordinates for a textarea directly - the standard workaround is a
// hidden "mirror" div styled identically to the textarea, with the text up
// to the caret placed inside it and a marker span at that point; the
// marker's rendered position is the caret's position.
(function (global) {
  const MIRROR_PROPS = [
    'boxSizing', 'width', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
    'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth',
    'fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'letterSpacing', 'lineHeight',
    'textTransform', 'wordSpacing', 'textIndent',
  ];

  function getCaretCoords(textarea) {
    const style = window.getComputedStyle(textarea);
    const div = document.createElement('div');
    MIRROR_PROPS.forEach((prop) => { div.style[prop] = style[prop]; });
    div.style.position = 'absolute';
    div.style.visibility = 'hidden';
    div.style.whiteSpace = 'pre-wrap';
    div.style.wordWrap = 'break-word';
    div.style.top = '0';
    div.style.left = '-9999px';

    const caretIndex = textarea.selectionStart;
    div.textContent = textarea.value.slice(0, caretIndex);

    const marker = document.createElement('span');
    marker.textContent = textarea.value.slice(caretIndex) || '.';
    div.appendChild(marker);
    document.body.appendChild(div);

    const rect = textarea.getBoundingClientRect();
    const divRect = div.getBoundingClientRect();
    const markerRect = marker.getBoundingClientRect();

    const top = rect.top + (markerRect.top - divRect.top) - textarea.scrollTop;
    const left = rect.left + (markerRect.left - divRect.left) - textarea.scrollLeft;

    document.body.removeChild(div);

    const lineHeight = parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.2;

    return {
      top: top + window.scrollY,
      left: left + window.scrollX,
      lineHeight,
    };
  }

  const api = { getCaretCoords };
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    global.CodexCaretPosition = api;
  }
})(typeof window !== 'undefined' ? window : globalThis);
