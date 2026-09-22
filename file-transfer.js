/**
 * ConvertKit Lite — cross-page file transfer
 * ---------------------------------------------
 * Static-site friendly (no backend): stores the File object the user picked
 * on the homepage in IndexedDB, then lets the destination tool page pick it
 * back up after redirect. Falls back gracefully if IndexedDB is unavailable
 * (e.g. some private-browsing modes) — callers should handle a null/rejected
 * result by just letting the user pick the file again on the tool page.
 *
 * Include this file on every page that needs it:
 *   <script src="/assets/file-transfer.js"></script>
 *
 * API (window.CKLTransfer):
 *   isSupported()                         -> boolean
 *   saveFileForTransfer(file, meta)       -> Promise<boolean>
 *   getTransferredFile({consume: true})   -> Promise<{file, meta} | null>
 *   clearTransferredFile()                -> Promise<boolean>
 *   applyTransferredFileToInput(inputEl)  -> Promise<{file, meta} | null>
 */
(function (global) {
  const DB_NAME = "ckl-transfer";
  const DB_VERSION = 1;
  const STORE = "files";
  const KEY = "pending";
  const TTL_MS = 5 * 60 * 1000; // 5 minutes — stale transfers are ignored

  function isSupported() {
    return typeof indexedDB !== "undefined";
  }

  function openDB() {
    return new Promise((resolve, reject) => {
      if (!isSupported()) {
        reject(new Error("IndexedDB not supported in this browser"));
        return;
      }
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(STORE)) {
          req.result.createObjectStore(STORE);
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function saveFileForTransfer(file, meta) {
    if (!file) throw new Error("saveFileForTransfer: no file given");
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(
        { file: file, meta: meta || {}, savedAt: Date.now() },
        KEY
      );
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error);
    });
  }

  async function clearTransferredFile() {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).delete(KEY);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error);
    });
  }

  async function getTransferredFile(opts) {
    opts = opts || {};
    const consume = opts.consume !== false; // default: remove after reading
    const db = await openDB();
    const record = await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly");
      const req = tx.objectStore(STORE).get(KEY);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });

    if (!record) return null;
    if (Date.now() - record.savedAt > TTL_MS) {
      await clearTransferredFile().catch(() => {});
      return null;
    }
    if (consume) await clearTransferredFile().catch(() => {});
    return { file: record.file, meta: record.meta };
  }

  async function applyTransferredFileToInput(inputEl, opts) {
    if (!inputEl) throw new Error("applyTransferredFileToInput: no input element given");
    const result = await getTransferredFile(opts);
    if (!result) return null;

    const dt = new DataTransfer();
    dt.items.add(result.file);
    inputEl.files = dt.files;
    inputEl.dispatchEvent(new Event("change", { bubbles: true }));
    return result;
  }

  global.CKLTransfer = {
    isSupported,
    saveFileForTransfer,
    getTransferredFile,
    clearTransferredFile,
    applyTransferredFileToInput,
  };
})(window);
