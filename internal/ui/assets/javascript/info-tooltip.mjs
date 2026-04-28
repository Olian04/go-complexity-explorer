// Hover tooltip popup attached to `.inspect-info-icon` elements (the small
// circle-info icons next to the score labels). Self-contained: relies only
// on `infoTooltipEl` and `state.activeInfoIcon` from globals.

import { infoTooltipEl, state } from "./globals.mjs";

export function showInfoTooltip(iconEl, clientX, clientY) {
  if (!infoTooltipEl || !iconEl) {
    return;
  }
  const text = iconEl.getAttribute("data-tooltip") || "";
  if (!text) {
    return;
  }
  state.activeInfoIcon = iconEl;
  infoTooltipEl.textContent = text;
  infoTooltipEl.classList.remove("hidden");
  positionInfoTooltip(clientX, clientY);
}

export function hideInfoTooltip() {
  if (!infoTooltipEl) {
    return;
  }
  state.activeInfoIcon = null;
  infoTooltipEl.classList.add("hidden");
}

export function positionInfoTooltip(clientX, clientY) {
  if (!infoTooltipEl || infoTooltipEl.classList.contains("hidden")) {
    return;
  }
  const margin = 12;
  const offset = 14;
  const width = infoTooltipEl.offsetWidth;
  const height = infoTooltipEl.offsetHeight;

  let x = clientX + offset;
  let y = clientY + offset;
  if (x + width > window.innerWidth - margin) {
    x = Math.max(margin, clientX - width - offset);
  }
  if (y + height > window.innerHeight - margin) {
    y = Math.max(margin, clientY - height - offset);
  }
  infoTooltipEl.style.left = `${x}px`;
  infoTooltipEl.style.top = `${y}px`;
}

export function setupInfoTooltips() {
  for (const iconEl of document.querySelectorAll(".inspect-info-icon")) {
    if (iconEl.dataset.tooltipBound === "1") {
      continue;
    }
    iconEl.dataset.tooltipBound = "1";
    iconEl.addEventListener("mouseenter", (event) => {
      showInfoTooltip(iconEl, event.clientX, event.clientY);
    });
    iconEl.addEventListener("mousemove", (event) => {
      if (state.activeInfoIcon !== iconEl) {
        return;
      }
      positionInfoTooltip(event.clientX, event.clientY);
    });
    iconEl.addEventListener("mouseleave", () => {
      if (state.activeInfoIcon === iconEl) {
        hideInfoTooltip();
      }
    });
  }
}
