/** Minimal popover menu: opens from a trigger, closes on outside click, Esc, or choosing an item. */
export function attachMenu(wrap: HTMLElement, trigger: HTMLButtonElement, menu: HTMLElement) {
  const items = () =>
    [...menu.querySelectorAll<HTMLElement>('[role^=menuitem]')].filter(
      (el) => !el.hasAttribute('disabled') && !el.closest('[hidden]'),
    );

  function setOpen(open: boolean, focusTrigger = false) {
    menu.hidden = !open;
    trigger.setAttribute('aria-expanded', String(open));
    if (open) items()[0]?.focus();
    else if (focusTrigger) trigger.focus();
  }

  trigger.addEventListener('click', () => setOpen(menu.hidden === true));

  menu.addEventListener('click', (e) => {
    // Choosing an action closes the menu; toggles, chips and items marked data-stay keep it open.
    const item = (e.target as HTMLElement).closest('[role=menuitem]');
    if (item && !item.hasAttribute('data-stay')) setOpen(false, true);
  });

  // Document-level, so Esc still works after clicking a non-focusable part of the menu.
  // Fields inside the menu stop Esc themselves when it means "cancel this edit".
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !menu.hidden) setOpen(false, true);
  });

  // Tabbing away closes the menu, so two can't be open at once.
  wrap.addEventListener('focusout', (e) => {
    const to = e.relatedTarget as Node | null;
    if (!menu.hidden && to && !wrap.contains(to)) setOpen(false);
  });

  wrap.addEventListener('keydown', (e) => {
    if ((e.target as HTMLElement).closest('input')) return; // arrows move the caret in a text field
    if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && !menu.hidden) {
      e.preventDefault();
      const list = items();
      const at = list.indexOf(document.activeElement as HTMLElement);
      const next = e.key === 'ArrowDown' ? (at + 1) % list.length : (at - 1 + list.length) % list.length;
      list[next]?.focus();
    } else if (e.key === 'ArrowDown' && document.activeElement === trigger) {
      e.preventDefault();
      setOpen(true);
    }
  });

  document.addEventListener('pointerdown', (e) => {
    if (!menu.hidden && !wrap.contains(e.target as Node)) setOpen(false);
  });
  return { open: () => setOpen(true), close: () => setOpen(false), get isOpen() { return !menu.hidden; } };
}
