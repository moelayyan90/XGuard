/* global chrome, document */
const keyInput = document.querySelector("#key");
const saveButton = document.querySelector("#save");
const status = document.querySelector("#status");

chrome.storage.local.get("xguardAccessKey").then(({ xguardAccessKey }) => {
  if (typeof xguardAccessKey === "string" && xguardAccessKey.length >= 8) {
    keyInput.placeholder = "XGuard access key is already stored";
    status.textContent =
      "XGuard is connected on this browser. Paste a new key only if you want to replace it.";
  }
});

saveButton.addEventListener("click", async () => {
  const value = keyInput.value.trim();
  if (value.length < 8) {
    status.textContent = "Enter a valid XGuard access key.";
    return;
  }
  await chrome.storage.local.set({ xguardAccessKey: value });
  keyInput.value = "";
  keyInput.placeholder = "XGuard access key stored";
  status.textContent = "Saved locally. XGuard Payment Decision is ready.";
});
