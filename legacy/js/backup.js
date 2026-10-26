/* Exports every smartExpenseManager_* key as one JSON file for import into SpendIQ AI. */
(function () {
  var btn = document.getElementById("legacy-backup-btn");
  if (!btn) return;
  btn.addEventListener("click", function () {
    var data = { app: "SpendIQ-legacy", version: 1, exportedAt: new Date().toISOString(), keys: {} };
    for (var i = 0; i < localStorage.length; i++) {
      var k = localStorage.key(i);
      if (k && k.indexOf("smartExpenseManager_") === 0) data.keys[k] = localStorage.getItem(k);
    }
    var blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url; a.download = "spendiq-legacy-backup.json";
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
  });
})();
