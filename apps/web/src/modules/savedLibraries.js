// SynBioHub libraries the user has imported, kept in localStorage so that
// reloading the page doesn't mean importing them again. Only each collection's
// URL and label are stored -- never content or credentials -- and the server
// still decides whether the current user may use a library.
//
// localStorage can be unavailable (private windows, blocked site data), so every
// access is guarded and failure just means nothing is remembered.

const KEY = "seqimprove.importedLibraries";
// Most recent first. An entry the server has since evicted is not dropped (it
// may just need a login to be found), so the list is bounded here instead.
const MAX_SAVED = 10;

export function loadSavedLibraries() {
    try {
        const saved = JSON.parse(localStorage.getItem(KEY));
        return Array.isArray(saved) ? saved.filter(lib => lib?.value && lib?.label) : [];
    } catch {
        return [];
    }
}

function store(libraries) {
    try {
        localStorage.setItem(KEY, JSON.stringify(libraries));
    } catch {}
}

export function saveLibrary({ value, label }) {
    const others = loadSavedLibraries().filter(lib => lib.value !== value);
    store([{ value, label }, ...others].slice(0, MAX_SAVED));
}

export function forgetLibrary(value) {
    store(loadSavedLibraries().filter(lib => lib.value !== value));
}
