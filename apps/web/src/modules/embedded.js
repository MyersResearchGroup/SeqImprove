// Embedded-mode detection for SeqImprove running inside SynBioSuite.
//
// the parent is captured from the first postMessage whose source is not our own
// window. window.parent !== window is not reliable — it's also true when a page
// is opened in a new tab via window.open, where there's an opener but no real
// embedder. the handshake message is the ground truth.

let parentWindow = null
let initialPayload = null
const listeners = new Set()
const pendingReplies = new Map()

export function initEmbedListener() {
    window.addEventListener("message", ({ data, source }) => {
        if (source === window) return
        // once captured, the parent is fixed; anything from another window is ignored
        if (parentWindow) {
            if (source === parentWindow && data?.requestId && pendingReplies.has(data.requestId))
                pendingReplies.get(data.requestId)(data)
            return
        }
        parentWindow = source
        initialPayload = data
        listeners.forEach(fn => fn(data))
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
        parentWindow.postMessage({ ...message, requestId }, "*")
    })
}
