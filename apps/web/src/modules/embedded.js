// Embedded-mode detection for SeqImprove running inside SynBioSuite.
//
// the parent is captured from the first postMessage whose source is not our own
// window. window.parent !== window is not reliable — it's also true when a page
// is opened in a new tab via window.open, where there's an opener but no real
// embedder. the handshake message is the ground truth.
//
// any page can embed SeqImprove and load a design into it, and every message back goes to
// that page's origin only, never "*". only a SynBioSuite origin takes part in the SynBioHub
// login exchange, since that hands over a session token. VITE_SYNBIOSUITE_ORIGINS (comma
// separated) adds origins for other deployments.

const synBioSuiteOrigins = [
    "https://synbiosuite.org",
    "https://www.synbiosuite.org",
    // SynBioSuite's Azure Static Web Apps production build and its numbered PR previews
    /^https:\/\/witty-hill-08172a210(-\d+)?\.centralus\.5\.azurestaticapps\.net$/,
    // a SynBioSuite dev server, trusted by a dev build only
    ...(import.meta.env.DEV ? [/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/] : []),
    ...(import.meta.env.VITE_SYNBIOSUITE_ORIGINS ?? "").split(",").map(o => o.trim().replace(/\/+$/, "")).filter(Boolean),
]

let parentWindow = null
let parentOrigin = null
let initialPayload = null
const listeners = new Set()
const panelTypeListeners = new Set()
const sessionListeners = new Set()
const pendingReplies = new Map()

export function initEmbedListener() {
    window.addEventListener("message", ({ data, source, origin }) => {
        if (source === window) return
        // once captured, the parent is fixed; anything from another window or origin is ignored
        if (parentWindow) {
            if (source !== parentWindow || origin !== parentOrigin) return
            if (data?.requestId && pendingReplies.has(data.requestId))
                pendingReplies.get(data.requestId)(data)
            // SynBioSuite reuses one SeqImprove tab across its Plasmid and Device panels,
            // so it re-sends the panel type when the user switches between them
            else if (data?.type === "panelType")
                panelTypeListeners.forEach(fn => fn(data.panelType ?? null))
            // SynBioSuite pushes its SynBioHub session whenever its login changes (null once logged
            // out). a reply that arrives after its request timed out lands here too
            else if (data?.type === "synBioHubSession")
                sessionListeners.forEach(fn => fn(data.session ?? null))
            return
        }
        // an opaque ("null") origin can't be replied to without "*", so it can't embed us
        if (origin === "null") return
        parentWindow = source
        parentOrigin = origin
        initialPayload = data
        listeners.forEach(fn => fn(data))
    })
}

export function isEmbedded() {
    return !!parentWindow
}

// embedded by SynBioSuite itself, so its SynBioHub login is the one to use
export function sharesSynBioHubLogin() {
    return !!parentWindow && synBioSuiteOrigins.some(allowed =>
        allowed instanceof RegExp ? allowed.test(parentOrigin) : allowed === parentOrigin)
}

export function getInitialPayload() {
    return initialPayload
}

export function onEmbedChange(fn) {
    listeners.add(fn)
    return () => listeners.delete(fn)
}

export function onHostPanelTypeChange(fn) {
    panelTypeListeners.add(fn)
    return () => panelTypeListeners.delete(fn)
}

export function onHostSynBioHubSession(fn) {
    sessionListeners.add(fn)
    return () => sessionListeners.delete(fn)
}

export function postToParent(message) {
    parentWindow?.postMessage(message, parentOrigin)
}

// posts a message tagged with a fresh requestId and resolves with the parent's
// reply of replyType that echoes that id, so a late reply to an earlier request
// can't resolve a newer one. rejects with an EmbedTimeout error if the parent never answers, which is what
// an older SynBioSuite build that doesn't know the message will do.
export function requestFromParent(message, replyType, timeoutMs = 5000) {
    return new Promise((resolve, reject) => {
        if (!parentWindow) {
            reject(new Error("Not embedded"))
            return
        }
        const requestId = `${Date.now()}-${Math.random().toString(36).slice(2)}`
        const timer = setTimeout(() => {
            pendingReplies.delete(requestId)
            const err = new Error("SynBioSuite did not respond")
            err.name = "EmbedTimeout"
            reject(err)
        }, timeoutMs)
        pendingReplies.set(requestId, data => {
            if (data.type !== replyType) return
            clearTimeout(timer)
            pendingReplies.delete(requestId)
            resolve(data)
        })
        parentWindow.postMessage({ ...message, requestId }, parentOrigin)
    })
}
