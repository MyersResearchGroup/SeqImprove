// Embedded-mode detection for SeqImprove running inside SynBioSuite.
//
// the parent is captured from the first postMessage whose source is not our own
// window. window.parent !== window is not reliable — it's also true when a page
// is opened in a new tab via window.open, where there's an opener but no real
// embedder. the handshake message is the ground truth.

let parentWindow = null
let initialPayload = null
const listeners = new Set()

export function initEmbedListener() {
    window.addEventListener("message", ({ data, source }) => {
        if (source === window) return
        const wasEmbedded = !!parentWindow
        parentWindow = source
        if (!wasEmbedded) {
            initialPayload = data
            listeners.forEach(fn => fn(data))
        }
    })
}

export function isEmbedded() {
    return !!parentWindow
}

export function getInitialPayload() {
    return initialPayload
}

export function onEmbedChange(fn) {
    listeners.add(fn)
    return () => listeners.delete(fn)
}

export function postToParent(message) {
    parentWindow?.postMessage(message, "*")
}
