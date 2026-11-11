// Account pictures: shown round wherever a person appears (or their initials), and the editor that makes one: any photo
// from the phone or the computer, moved and zoomed inside a circle, always saved as a small square (256 px WebP, JPEG
// where the browser cannot write WebP, at most ~110 KB; the app makes it round). Only the account, the people it shares
// a space with and the owner see it.
import { api } from "../api/client.js";
import { escapeHtml } from "../../vendor/mytko-kit/js/core.js";
import { initials } from "./logic.js";
import { dialog } from "./dialogs.js";
import { toast } from "../../vendor/mytko-kit/js/ui.js";

const SIDE = 256; // the saved square
const VIEW = 280; // the editor's circle, in CSS pixels
const MAX_BYTES = 110 * 1024;
const QUALITIES = [0.86, 0.75, 0.6, 0.45];
const WORKING = 1024; // the photo is worked on at most this size: smooth on phones, nothing kept at full resolution
const MAX_FILE = 30 * 1024 * 1024; // larger files are not even opened

// A picture shown but gone meanwhile (removed on another device, or no longer shared): back to the initials.
globalThis.document?.addEventListener("error", event => {
  const image = event.target;
  if (!(image instanceof HTMLImageElement) || !image.parentElement?.classList.contains("avatar--photo")) return;
  const box = image.parentElement;
  box.classList.remove("avatar--photo");
  box.textContent = box.dataset.initials || "";
}, true);

// The person's picture (round), or their initials. person: { id (null = the owner), name, avatarAt }.
export function avatarHtml(person, className = "") {
  const classes = `avatar${className ? ` ${className}` : ""}`;
  const letters = escapeHtml(initials(person?.name || ""));
  if (person?.avatarAt) {
    return `<span class="${classes} avatar--photo" data-initials="${letters}"><img src="${escapeHtml(api.avatarUrl(person.id, person.avatarAt))}" alt="" loading="lazy" decoding="async"></span>`;
  }
  return `<span class="${classes}">${letters}</span>`;
}

// ---- the crop (pure, tested) ----------------------------------------------------------------------------------------
// The scale at which an image just covers a square of `side`, and the pan limits at `zoom` (1 = just covering).
export function coverScale(width, height, side) {
  return Math.max(side / width, side / height);
}
export function clampPan({ x, y }, { width, height, zoom, side }) {
  const scale = coverScale(width, height, side) * zoom;
  const maxX = Math.max(0, (width * scale - side) / 2);
  const maxY = Math.max(0, (height * scale - side) / 2);
  return { x: Math.min(maxX, Math.max(-maxX, x)), y: Math.min(maxY, Math.max(-maxY, y)) };
}
// Where the image goes on a square of `side`: { left, top, width, height } (pan given for a square of `panSide`).
export function placement({ width, height, zoom, x, y }, side, panSide = side) {
  const scale = coverScale(width, height, side) * zoom;
  const ratio = side / panSide;
  const drawnWidth = width * scale;
  const drawnHeight = height * scale;
  return { left: (side - drawnWidth) / 2 + x * ratio, top: (side - drawnHeight) / 2 + y * ratio, width: drawnWidth, height: drawnHeight };
}
// { width, height } of at most `max` px on the longer side.
export function fitSize(width, height, max) {
  const scale = Math.min(1, max / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

// ---- the profile picture menu -----------------------------------------------------------------------------------
// The account's own picture: choose a photo, or remove the one there is. onChange(avatarAt) after either.
export function openAvatarMenu({ person, onChange }) {
  const element = dialog("dialog--confirm dialog--avatar-menu", `<div class="dialog__body">
    <header class="dialog__head"><h2>Zdjęcie profilowe</h2></header>
    <div class="avatar-menu__preview">${avatarHtml(person, "avatar--xl avatar--lime")}</div>
    <p class="muted">Każde zdjęcie zmniejszamy i zapisujemy jako małe, okrągłe zdjęcie. Widzisz je Ty, osoby ze wspólnych przestrzeni i administrator.</p>
    <div class="dialog__actions">
      ${person.avatarAt ? '<button type="button" class="btn btn--ghost" data-avatar-remove>Usuń zdjęcie</button>' : ""}
      <button type="button" class="btn btn--primary" data-avatar-pick>${person.avatarAt ? "Zmień zdjęcie" : "Wybierz zdjęcie"}</button>
    </div>
  </div>`);
  element.addEventListener("click", async event => {
    if (event.target.closest("[data-avatar-pick]")) {
      element.close();
      return pickPhoto(avatarAt => { toast("Zdjęcie zapisane."); onChange?.(avatarAt); });
    }
    if (event.target.closest("[data-avatar-remove]")) {
      try {
        const { avatarAt } = await api.deleteAvatar();
        element.close();
        toast("Zdjęcie usunięte.");
        onChange?.(avatarAt);
      } catch (error) { toast(error.message, { tone: "error" }); }
    }
  });
}

// ---- the editor -----------------------------------------------------------------------------------------------------
// Picks a photo, then the editor; onSaved(avatarAt) once it is the account's picture.
function pickPhoto(onSaved) {
  // in the page while the picker is open: iOS Safari may drop a detached file input and never report the choice
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "image/*";
  input.className = "visually-hidden";
  document.body.append(input);
  const done = () => input.remove();
  input.addEventListener("cancel", done);
  input.addEventListener("change", async () => {
    const file = input.files?.[0];
    done();
    if (!file) return;
    try {
      if (file.size > MAX_FILE) throw new Error("too big");
      editor(await working(file), onSaved);
    } catch {
      toast("Nie udało się odczytać tego zdjęcia. Wybierz inne (JPG, PNG, WebP, HEIC z iPhone'a).", { tone: "error" });
    }
  });
  input.click();
}

// The photo once, at most WORKING px, on a canvas of its own: what the editor moves and what is saved. Decoded with
// createImageBitmap (turned the way the camera held it), so no blob: address is ever needed.
async function working(file) {
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" }).catch(() => createImageBitmap(file));
  try {
    if (!bitmap.width || !bitmap.height) throw new Error("no size");
    const { width, height } = fitSize(bitmap.width, bitmap.height, WORKING);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("canvas");
    context.imageSmoothingQuality = "high";
    context.drawImage(bitmap, 0, 0, width, height);
    return canvas;
  } finally {
    bitmap.close?.();
  }
}

function editor(image, onSaved) {
  const { width, height } = image; // the working canvas
  const state = { zoom: 1, x: 0, y: 0 };
  const element = dialog("dialog--avatar", `<form class="dialog__body" novalidate>
    <header class="dialog__head"><h2>Zdjęcie profilowe</h2></header>
    <p class="muted">Przesuń zdjęcie palcem lub myszką i przybliż je: zapisze się to, co jest w kółku.</p>
    <canvas class="avatar-crop" width="${VIEW * 2}" height="${VIEW * 2}" aria-label="Kadrowanie zdjęcia" tabindex="0"></canvas>
    <label class="field avatar-zoom"><span>Przybliżenie</span>
      <input type="range" name="zoom" min="1" max="4" step="0.01" value="1"></label>
    <p class="field-error" data-error role="alert" hidden></p>
    <div class="dialog__actions">
      <button type="button" class="btn btn--ghost" data-close>Anuluj</button>
      <button type="submit" class="btn btn--primary">Zapisz zdjęcie</button>
    </div>
  </form>`);
  const form = element.querySelector("form");
  const canvas = element.querySelector("canvas");
  const context = canvas.getContext("2d");
  const ratio = canvas.width / VIEW; // the canvas is drawn at twice its CSS size: sharp on phones

  function draw() {
    const side = canvas.width;
    const at = placement({ width, height, ...state }, side, VIEW);
    context.clearRect(0, 0, side, side);
    context.imageSmoothingQuality = "high";
    context.drawImage(image, at.left, at.top, at.width, at.height);
    // everything outside the circle dimmed: what is kept is what is round
    context.save();
    context.fillStyle = "rgba(6, 10, 7, 0.62)";
    context.beginPath();
    context.rect(0, 0, side, side);
    context.arc(side / 2, side / 2, side / 2 - 2 * ratio, 0, Math.PI * 2, true);
    context.fill("evenodd");
    context.strokeStyle = "rgba(183, 227, 77, 0.9)";
    context.lineWidth = 2 * ratio;
    context.beginPath();
    context.arc(side / 2, side / 2, side / 2 - 2 * ratio, 0, Math.PI * 2);
    context.stroke();
    context.restore();
  }
  const pan = (dx, dy) => {
    Object.assign(state, clampPan({ x: state.x + dx, y: state.y + dy }, { width, height, zoom: state.zoom, side: VIEW }));
    draw();
  };
  const zoomTo = zoom => {
    state.zoom = Math.min(4, Math.max(1, zoom));
    form.elements.zoom.value = String(state.zoom);
    pan(0, 0);
  };

  // moved with a finger or the mouse (the CSS size may differ from VIEW on small screens)
  let drag = null;
  canvas.addEventListener("pointerdown", event => {
    drag = { x: event.clientX, y: event.clientY };
    canvas.setPointerCapture(event.pointerId);
  });
  canvas.addEventListener("pointermove", event => {
    if (!drag) return;
    const scale = VIEW / canvas.getBoundingClientRect().width;
    pan((event.clientX - drag.x) * scale, (event.clientY - drag.y) * scale);
    drag = { x: event.clientX, y: event.clientY };
  });
  const stop = () => { drag = null; };
  canvas.addEventListener("pointerup", stop);
  canvas.addEventListener("pointercancel", stop);
  canvas.addEventListener("wheel", event => { event.preventDefault(); zoomTo(state.zoom * (event.deltaY < 0 ? 1.08 : 1 / 1.08)); }, { passive: false });
  canvas.addEventListener("keydown", event => {
    const step = { ArrowLeft: [8, 0], ArrowRight: [-8, 0], ArrowUp: [0, 8], ArrowDown: [0, -8] }[event.key];
    if (step) { event.preventDefault(); pan(...step); }
    if (event.key === "+" || event.key === "=") zoomTo(state.zoom * 1.1);
    if (event.key === "-") zoomTo(state.zoom / 1.1);
  });
  form.elements.zoom.addEventListener("input", () => zoomTo(Number(form.elements.zoom.value)));
  element.addEventListener("click", event => { if (event.target.closest("[data-close]")) element.close(); });

  form.addEventListener("submit", async event => {
    event.preventDefault();
    const submit = form.querySelector("[type=submit]");
    const box = form.querySelector("[data-error]");
    if (submit.disabled) return;
    submit.disabled = true;
    box.hidden = true;
    try {
      const blob = await square(image, { width, height, ...state });
      const { avatarAt } = await api.setAvatar(await toBase64(blob));
      element.close();
      onSaved?.(avatarAt);
    } catch (error) {
      box.textContent = error.message === "too large" || error.message === "encode" ? "Nie udało się zapisać tego zdjęcia. Wybierz inne." : error.message;
      box.hidden = false;
    } finally {
      submit.disabled = false;
    }
  });
  element.addEventListener("close", () => { image.width = image.height = 0; }); // the working copy given back (iOS caps canvas memory)
  draw();
  canvas.focus();
}

const toBlob = (canvas, type, quality) => new Promise(resolve => canvas.toBlob(resolve, type, quality));

// Whether this browser writes WebP, asked once: Safari answers a request for WebP with a PNG instead.
let webpType = null;
async function photoType() {
  if (!webpType) {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 1;
    webpType = (await toBlob(canvas, "image/webp", 0.8))?.type === "image/webp" ? "image/webp" : "image/jpeg";
  }
  return webpType;
}

// The circle's square at SIDE px, as WebP (or JPEG), small enough to send.
async function square(image, crop) {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = SIDE;
  try {
    const context = canvas.getContext("2d");
    context.fillStyle = "#fff";
    context.fillRect(0, 0, SIDE, SIDE);
    context.imageSmoothingQuality = "high";
    const at = placement(crop, SIDE, VIEW);
    context.drawImage(image, at.left, at.top, at.width, at.height);
    const type = await photoType();
    for (const quality of QUALITIES) {
      const blob = await toBlob(canvas, type, quality);
      if (!blob || blob.type !== type) throw new Error("encode");
      if (blob.size <= MAX_BYTES) return blob;
    }
    throw new Error("too large");
  } finally {
    canvas.width = canvas.height = 0;
  }
}

// A Blob as base64, in chunks (one String.fromCharCode(...bytes) of a whole photo would overflow the stack).
async function toBase64(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}
