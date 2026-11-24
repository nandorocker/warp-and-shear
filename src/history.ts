/**
 * Snapshot-based undo/redo for the whole design state.
 *
 * Edits arrive continuously (slider drags, typing), so `commitSoon()` coalesces them into one step.
 * Discrete actions (randomize, reset, load…) call `commit()` directly before and after they run.
 */
const MAX = 100;
const SETTLE_MS = 400;

export function createHistory(read: () => unknown, onChange: () => void) {
  const stack: string[] = [];
  let idx = -1;
  let timer = 0;

  const snap = () => JSON.stringify(read());

  /** Returns true when the state differed from the current step and a new one was added. */
  function commit(): boolean {
    clearTimeout(timer);
    const s = snap();
    if (s === stack[idx]) return false;
    stack.splice(idx + 1); // a new edit drops the redo branch
    stack.push(s);
    if (stack.length > MAX) stack.shift();
    idx = stack.length - 1;
    onChange();
    return true;
  }

  return {
    commit,
    commitSoon() {
      clearTimeout(timer);
      timer = window.setTimeout(commit, SETTLE_MS);
    },
    /** Move back one step; returns the snapshot to restore, or null at the start. */
    undo(): unknown | null {
      commit(); // flush any pending edit so it becomes its own step
      if (idx <= 0) return null;
      idx--;
      onChange();
      return JSON.parse(stack[idx]);
    },
    redo(): unknown | null {
      commit();
      if (idx >= stack.length - 1) return null;
      idx++;
      onChange();
      return JSON.parse(stack[idx]);
    },
    /** After restoring a snapshot, re-read the (sanitized) state so it isn't mistaken for a new edit. */
    rebase() {
      clearTimeout(timer);
      stack[idx] = snap();
    },
    get position() {
      return idx;
    },
    get canUndo() {
      return idx > 0;
    },
    get canRedo() {
      return idx < stack.length - 1;
    },
  };
}
