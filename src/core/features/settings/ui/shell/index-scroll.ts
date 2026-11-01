/** The phone index remembers where it was scrolled when a row is opened, and gives that back to "‹ Settings". */
let remembered = 0;
let wanted = false;
export const rememberIndexScroll = () => { remembered = window.scrollY; };
export const wantIndexScroll = () => { wanted = true; };
export function restoreIndexScroll() {
  if (!wanted) return;
  wanted = false;
  requestAnimationFrame(() => window.scrollTo(0, remembered));
}
