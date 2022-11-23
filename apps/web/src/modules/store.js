import _, { remove } from "lodash"
import create from "zustand"
import produce from "immer"
import { getSearchParams } from "./util"
import { addSequenceAnnotation, addTextAnnotation, createSBOLDocument, hasSequenceAnnotation, hasTextAnnotation, removeSequenceAnnotation, removeTextAnnotation } from "./sbol"
import { fetchAnnotateSequence, fetchAnnotateText, fetchSBOL } from "./api"
import { S2ComponentDefinition, SBOL2GraphView } from "sbolgraph"
import fileDownload from "js-file-download"
import { TextBuffer } from "text-ranger"


// create store
export const useStore = create((set, get) => ({
    
    /** 
     * SBOL URI
     * @type {string | undefined} */
    uri: getSearchParams().complete_sbol,
    
    /** 
     * Raw SBOL content
     * @type {string} */
    sbolContent: null,
    
    /** 
     * Parsed SBOL document
     * @type {SBOL2GraphView} */
    document: null,
    ...createAsyncAdapter(set, "SBOL", async sbol => {
        // try to form a URL out of the input argument
        try {
            var sbolUrl = new URL(sbol)
            set({ uri: sbolUrl.href })
        }
        catch (err) { }

        // if it's a URL, fetch it; otherwise, just use it as the content
        const sbolContent = sbolUrl ? await fetchSBOL(sbolUrl.href) : sbol
        const document = await createSBOLDocument(sbolContent)

        return {
            sbolContent,
            document,
            richDescriptionBuffer: new TextBuffer(document.root.richDescription),
        }
    }),
    exportDocument: () => {
        const xml = get().document.serializeXML()
        fileDownload(xml, `${get().document.root.displayId}.xml`)
    },


    // Sequence Annotations
    sequenceAnnotations: [],

    ...createAsyncAdapter(set, "SequenceAnnotations", async () => ({
        // fetch sequence annotations from API
        sequenceAnnotations: await fetchAnnotateSequence(get().sbolContent) ?? [],
    })),

    sequenceAnnotationActions: createAnnotationActions(set, get, state => state.sequenceAnnotations, {
        test: hasSequenceAnnotation,
        add: addSequenceAnnotation,
        remove: removeSequenceAnnotation,
    }),


    // Text Annotations
    textAnnotations: [],
    richDescriptionBuffer: null,
    ...createAsyncAdapter(set, "TextAnnotations", async () => ({
        // fetch sequence annotations from API
        textAnnotations: await fetchAnnotateText(get().sbolContent) ?? [],
    })),

    textAnnotationActions: createAnnotationActions(set, get, state => state.textAnnotations, {
        test: hasTextAnnotation,
        add: (compDef, annoInfo) => addTextAnnotation(compDef, annoInfo, get().richDescriptionBuffer),
        remove: (compDef, annoInfo) => removeTextAnnotation(compDef, annoInfo, get().richDescriptionBuffer),
    }),

    // // role
    // ...createRootValueAdapter(set, get, "role", "setRole", "role"),

    // proteins: createListAdapter(set, state => state.proteins),
    // targetOrganisms: createListAdapter(set, state => state.targetOrganisms),
}))




/**
 * Sets the value of a deep property in the root object (usually a 
 * S2ComponentDefinition).
 *
 * @param {Function} set  Zustand setState
 * @param {string | string[]} path  Path to desired property within the root object
 */
function setRootProperty(set, path, value) {
    mutateDocument(set, state => {
        _.set(state.document.root, path, value)
    })
}


/**
 * Mutates the SBOL document while still triggering a state update in in
 * the store.
 *
 * @export
 * @param {Function} set  Zustand setState
 * @param {(state) => void} mutator  Function that mutates the document
 */
export function mutateDocument(set, mutator) {
    set(state => {
        mutator?.(state)
        return { document: state.document }
    })
}


function createListAdapter(set, selector) {
    return {
        items: [],
        add: item => set(produce(draft => {
            selector(draft).items.push(item)
        })),
        remove: id => set(produce(draft => {
            selector(draft).items.splice(selector(draft).items.findIndex(item => item.id == id), 1)
        })),
    }
}


/**
 * Creates a load function which sets a boolean loading property when performing
 * asynchronous logic. Intended to be spread into the store.
 *
 * @param {Function} set  Zustand setState
 * @param {string} propertySuffix  e.g. Sbol => [loadSbol, loadingSbol]
 * @param {(...args) => Promise} loader  Asyncronous loader function. Can take any arguments and produces an
 * object that gets spread into the store once loaded.
 * @return {{ loading: boolean, load: (...args) => void }} 
 */
function createAsyncAdapter(set, propertySuffix, loader) {

    const loadingPropKey = "loading" + propertySuffix

    return {
        [loadingPropKey]: false,
        ["load" + propertySuffix]: async (...args) => {
            set({ [loadingPropKey]: true })
            const result = await loader?.(...args)
            set({
                ...result,
                [loadingPropKey]: false
            })
        }
    }
}


/**
 * Hook that returns the load function and loading variable produced by
 * an async adapter.
 *
 * @export
 * @param {string} propertySuffix  e.g. Sbol => [loadSbol, loadingSbol]
 * @return {[Function, boolean]}  An array containing the load function and loading boolean, in that order.
 */
export function useAsyncLoader(propertySuffix) {
    const load = useStore(s => s["load" + propertySuffix])
    const loading = useStore(s => s["loading" + propertySuffix])
    return [load, loading]
}


/**
 * Creates a standard set of actions useful for manipulating annotations
 * in the store.
 *
 * @param {Function} set  Zustand setState
 * @param {Function} get  Zustand getState
 * @param {(state) => *} selector  Function that selects the annotation array from the store
 * @param {Object} documentActions  Set of actions that are needed for new annotations to interact
 * with the document model
 * @return {{ 
 *      getAnnotation: (id: string) => *,
 *      editAnnotation: (id: string, changes) => void,
 *      addAnnotation: (newAnnotation) => void,
 *      removeAnnotation: (id: string) => void,
 *      isActive: (id: string) => boolean,
 *      setActive: (id: string, value, boolean) => void,
 * }}  An object containing annotation actions intended to be kept in the store
 */
function createAnnotationActions(set, get, selector, { test, add, remove } = {}) {

    const getAnnotation = id => selector(get()).find(anno => anno.id == id)

    const isActive = id => test(get().document.root, id)
    const setActive = (id, value) => {
        mutateDocument(set, state => {
            (value ? add : remove)(state.document.root, getAnnotation(id))
        })
    }

    return {
        getAnnotation,
        editAnnotation: (id, changes) => {
            // if it's active, we'll temporarily disable it
            const active = isActive(id)
            active && setActive(id, false)

            set(produce(draft => {
                const item = selector(draft).find(anno => anno.id == id)
    
                Object.keys(changes).forEach(key => {
                    item[key] = changes[key]
                })
            }))
            
            // then set it back as active after
            active && setActive(changes.id ?? id, true)
        },
        addAnnotation: newAnno => set(produce(draft => {
            selector(draft).push(newAnno)
        })),
        removeAnnotation: id => set(produce(draft => {
            const annoArr = selector(draft)
            annoArr.splice(annoArr.findIndex(anno => anno.id == id), 1)
        })),
        isActive,
        setActive,
    }
}
