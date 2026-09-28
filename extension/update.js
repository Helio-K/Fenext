(() => {
  function parts(version) {
    if (
      typeof version !== "string" ||
      !/^(0|[1-9]\d*)(\.(0|[1-9]\d*)){0,3}$/.test(version)
    )
      return null;
    const result = version.split(".").map(Number);
    return result.every((n) => n <= 65535) ? result : null;
  }
  globalThis.FenextUpdate = {
    isNewerVersion(latest, installed) {
      const a = parts(latest),
        b = parts(installed);
      if (!a || !b) return false;
      for (let i = 0; i < 4; i++) {
        if ((a[i] || 0) !== (b[i] || 0)) return (a[i] || 0) > (b[i] || 0);
      }
      return false;
    },
  };
})();
