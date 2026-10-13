/** Date/time variable in both languages, India time. */
export function whenVar(d: Date) {
  const opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' };
  return { en: d.toLocaleString('en-IN', opts), hi: d.toLocaleString('hi-IN', opts) };
}
