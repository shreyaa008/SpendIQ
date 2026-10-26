// Applies the saved theme before first paint (no light/dark flash). Kept as a separate file so the server's strict CSP (script-src 'self') can stay.
try {
  var t = localStorage.getItem('spendiq_theme');
  if (t === 'dark' || (t !== 'light' && matchMedia('(prefers-color-scheme: dark)').matches)) document.documentElement.dataset.theme = 'dark';
} catch (e) { /* storage unavailable */ }
