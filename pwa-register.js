(function registerStudyFlowPwa() {
  if (!("serviceWorker" in navigator)) return;

  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./service-worker.js", { scope: "./" }).catch((error) => {
      console.warn("StudyFlow service worker registration failed.", error);
    });
  });
})();

(function setupAndroidBackButton() {
  const appPlugin = window.Capacitor?.Plugins?.App;
  if (!appPlugin?.addListener) return;

  function shouldExitOnBack() {
    const path = window.location.pathname.toLowerCase();
    if (path.endsWith("/login.html")) return true;

    const activePage = document.querySelector(".page-view.active");
    return activePage?.dataset.page === "weekly";
  }

  appPlugin.addListener("backButton", ({ canGoBack }) => {
    if (shouldExitOnBack()) {
      appPlugin.exitApp?.();
      return;
    }

    const openDialog = document.querySelector("dialog[open]");
    if (openDialog) {
      openDialog.close();
      return;
    }

    if (canGoBack || window.history.length > 1) {
      window.history.back();
      return;
    }

    appPlugin.exitApp?.();
  });
})();
