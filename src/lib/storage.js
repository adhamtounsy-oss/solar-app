export function saveProject(name, state) {
  return window.storage.set("proj:" + name, JSON.stringify(state))
    .then(() => true).catch(() => false);
}
export function loadProject(name) {
  return window.storage.get("proj:" + name)
    .then(r => r ? JSON.parse(r.value) : null).catch(() => null);
}
export function listProjects() {
  return window.storage.list("proj:")
    .then(r => (r && r.keys ? r.keys.map(k => k.replace("proj:", "")) : []))
    .catch(() => []);
}
export function deleteProject(name) {
  return window.storage.delete("proj:" + name).then(() => true).catch(() => false);
}
