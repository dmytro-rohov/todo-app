import { modalOverlay } from "../state/state.js";

let scrollY = 0;

export function lockScroll() {
  scrollY = window.scrollY;

  const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;
  document.body.style.paddingRight = `${scrollbarWidth}px`;

  document.body.style.position = "fixed";
  document.body.style.top = `-${scrollY}px`;
  document.body.style.left = "0";
  document.body.style.right = "0";
}

export function unlockScroll() {
  document.body.style.position = "";
  document.body.style.top = ``;
  document.body.style.left = "";
  document.body.style.right = "";
  window.scrollTo(0, scrollY);
}

export function initModalListeners() {

// close popups
document.querySelectorAll(".cancel-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    modalOverlay.classList.add("hidden");
    unlockScroll();
  })
})

// close popup clicking at bg
modalOverlay.addEventListener("click", (e) => {
  if (e.target.classList.contains("modal-overlay")) {
    e.target.classList.add("hidden");
    unlockScroll();
  }
});

}


