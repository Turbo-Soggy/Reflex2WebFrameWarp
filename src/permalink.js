/* ---------------------------------------------------------------------------
   permalink.js — Shareable experiment configuration in the URL hash (Phase 6)
   ---------------------------------------------------------------------------
   Encodes the live slider state into location.hash, e.g.

       index.html#lag=120&hz=20&guard=18

   so a specific configuration can be linked in the report or handed to an
   examiner and reproduced exactly. On load we read the hash and apply it; on a
   user-committed slider change we rewrite it.

   We listen to 'change' (fires when the user releases the slider), NOT 'input',
   so the programmatic slider writes from the warp toggle / feel-the-lag ramp
   don't churn the URL.
--------------------------------------------------------------------------- */

export function installPermalink(map) {
  const entries = Object.entries(map)
    .map(([key, id]) => [key, document.getElementById(id)])
    .filter(([, el]) => el);

  // Hash → sliders (apply via 'input' so the existing wiring runs).
  const params = new URLSearchParams(location.hash.slice(1));
  for (const [key, el] of entries) {
    const v = params.get(key);
    if (v !== null && v !== '') {
      el.value = v;
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }
  }

  // Sliders → hash (only on user commit; replaceState keeps history clean).
  function writeHash() {
    const p = new URLSearchParams();
    for (const [key, el] of entries) p.set(key, el.value);
    history.replaceState(null, '', '#' + p.toString());
  }
  for (const [, el] of entries) el.addEventListener('change', writeHash);
}
