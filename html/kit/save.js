// save.js — lưu/tải tiến trình game vào bộ nhớ trình duyệt (localStorage), có phiên bản và tự lưu.
//   const save = createSave('nong-trai-3d', { version: 2, defaults: { coins: 0, day: 1 } });
//   save.data.coins += 5; save.write();          // hoặc save.auto(10) → tự lưu mỗi 10 giây
//   save.migrate = (old, fromVersion) => ({ ...old, newField: 0 });  // nâng cấp dữ liệu cũ
//   save.export() / save.import(text)  → sao lưu thủ công (chuyển máy)
export function createSave(key, { version = 1, defaults = {} } = {}) {
  const K = 'tdk-save:' + key;
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const api = {
    data: clone(defaults),
    migrate: null,
    available: true,
    load() {
      try {
        const raw = localStorage.getItem(K);
        if (!raw) return false;
        const { v, d } = JSON.parse(raw);
        let data = d;
        if (v !== version && api.migrate) data = api.migrate(data, v);
        api.data = { ...clone(defaults), ...data };
        return true;
      } catch (e) {
        api.available = false;
        console.warn('[save] không đọc được:', e.message);
        return false;
      }
    },
    write() {
      try {
        localStorage.setItem(K, JSON.stringify({ v: version, t: Date.now(), d: api.data }));
        return true;
      } catch (e) {
        api.available = false;
        return false;
      }
    },
    reset() { api.data = clone(defaults); try { localStorage.removeItem(K); } catch (e) {} },
    auto(seconds = 15) {
      setInterval(() => api.write(), seconds * 1000);
      addEventListener('visibilitychange', () => document.hidden && api.write());
      addEventListener('pagehide', () => api.write());
    },
    export() { return btoa(unescape(encodeURIComponent(JSON.stringify({ v: version, d: api.data })))); },
    import(text) {
      const { v, d } = JSON.parse(decodeURIComponent(escape(atob(text.trim()))));
      api.data = { ...clone(defaults), ...(v !== version && api.migrate ? api.migrate(d, v) : d) };
      api.write();
    },
  };
  api.load();
  return api;
}
