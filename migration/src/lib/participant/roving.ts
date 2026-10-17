/**
 * Arrow-key movement inside a group of answer buttons. Tab still reaches every button (nothing
 * is hidden from the tab order); the arrows are a shortcut within the group, as in a radio group.
 * Enter and Space are the buttons' own.
 *
 *   <div use:arrowKeys>...buttons...</div>
 */
export function arrowKeys(node: HTMLElement) {
  const buttons = () => [...node.querySelectorAll<HTMLButtonElement>('button:not([disabled])')];

  function onKeydown(event: KeyboardEvent) {
    const step = event.key === 'ArrowDown' || event.key === 'ArrowRight' ? 1
      : event.key === 'ArrowUp' || event.key === 'ArrowLeft' ? -1 : 0;
    const edge = event.key === 'Home' ? 0 : event.key === 'End' ? -1 : null;
    if (!step && edge === null) return;
    const list = buttons();
    const from = list.indexOf((event.target as Element).closest('button') as HTMLButtonElement);
    if (!list.length || from < 0) return;
    const to = edge !== null ? (edge === 0 ? 0 : list.length - 1) : (from + step + list.length) % list.length;
    event.preventDefault();
    list[to].focus();
  }

  node.addEventListener('keydown', onKeydown);
  return { destroy: () => node.removeEventListener('keydown', onKeydown) };
}
