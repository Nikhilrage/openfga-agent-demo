export async function api(path, options = {}) {
  const response = await fetch("/api" + path, {
    ...options, credentials: "include",
    headers: { "content-type": "application/json", ...options.headers },
  });
  const body = await response.json();
  if (!response.ok) throw Object.assign(new Error(body.message ?? "Request failed"), { status: response.status, body });
  return body;
}
