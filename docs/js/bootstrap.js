function initializeDesktopExperience() {
  wireThemeToggle();
  wireTour();
  wireWindowControls();
  wireActivityBar();
  wireNavigation();
  wireTabClose();
  wireSearch();
  wireQueryRunAnimation();
  wireQueryToolbarActions();
  wireFeatureCards();
  wireConnectionSimulation();
  wireAssistant();
  hydrateMarketplaceStats();
  showStartupToast();
  preloadAssistantConversation();
  openFile("query");

  window.setTimeout(renderRevenueChart, 500);

  document.addEventListener("click", (e) => {
    const tab = e.target.closest("[data-open='query']");
    if (tab) window.setTimeout(animateSqlTyping, 200);
    // On first workbench interaction: schedule context node fade and suppress command palette
    if (e.target.closest(".shell")) {
      if (!document.body.classList.contains("nodes-faded")) {
        window.setTimeout(() => document.body.classList.add("nodes-faded"), 6000);
      }
      if (!document.body.classList.contains("shell-engaged")) {
        document.body.classList.add("shell-engaged");
      }
    }
  });
}

function wireMobileUiToggles() {
  const btnTop = document.getElementById("btn-toggle-topbar");
  const topLinks = document.querySelector(".desktop-topbar-links");
  if (btnTop && topLinks) {
    btnTop.addEventListener("click", () => {
      topLinks.classList.toggle("show");
    });
  }

  const btnLeft = document.getElementById("btn-toggle-left");
  const btnRight = document.getElementById("btn-toggle-right");
  const btnCloseEditor = document.getElementById("btn-close-editor");
  const workbench = document.querySelector(".workbench");
  const body = document.body;

  if (btnLeft && workbench) {
    btnLeft.addEventListener("click", () => {
      workbench.classList.toggle("show-left");
      workbench.classList.remove("show-right");
    });
  }

  if (btnRight && workbench) {
    btnRight.addEventListener("click", () => {
      workbench.classList.toggle("show-right");
      workbench.classList.remove("show-left");

      const rp = document.querySelector(".right-panel");
      if (rp && !rp.classList.contains("expanded")) {
        rp.classList.add("expanded");
      }
    });
  }

  if (btnCloseEditor && body) {
    btnCloseEditor.addEventListener("click", () => {
      body.classList.toggle("editor-minimized");
    });
  }

  if (workbench) {
    workbench.addEventListener("click", (e) => {
      if (e.target.closest(".editor-region") && (workbench.classList.contains("show-left") || workbench.classList.contains("show-right"))) {
        workbench.classList.remove("show-left");
        workbench.classList.remove("show-right");
      }
    });
  }
}

document.addEventListener("DOMContentLoaded", async () => {
  if (typeof loadHtmlPartials === "function") {
    await loadHtmlPartials();
  }

  initializeDesktopExperience();
  wireMobileUiToggles();
});
