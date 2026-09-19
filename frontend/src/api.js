const API = import.meta.env.VITE_API_URL;

function getToken(key) {
  return localStorage.getItem(key);
}

export async function api(path, { method = "GET", body, auth } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (auth) {
    const token = getToken(auth);
    if (token) headers.Authorization = `Bearer ${token}`;
  }
  const res = await fetch(`${API}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Request failed");
  return data;
}

export const session = {
  save(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
  },
  read(key) {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  },
  clear(keys) {
    keys.forEach((k) => localStorage.removeItem(k));
  },
};
