const nativeFetch = globalThis.fetch;
module.exports = async function authenticatedFetch(input, options = {}) {
  const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
  if (url.hostname === "127.0.0.1" && url.pathname.startsWith("/api/") && url.pathname !== "/api/session") {
    const session = await nativeFetch(new URL("/api/session", url));
    const { token } = await session.json();
    const headers = new Headers(options.headers || {});
    if (!headers.has("X-Mahiro-Session-Token")) headers.set("X-Mahiro-Session-Token", token);
    options = { ...options, headers };
  }
  return nativeFetch(input, options);
};
