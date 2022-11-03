import create from "zustand"
import produce from "immer"

export let useStore = () => ({})

/*
    Standard set of actions for annotations
*/
const annotationActions = (set, get, selector) => {

    const getAnnotation = id => selector(get()).find(anno => anno.id == id)
    const setAnnotationProp = (id, propKey, value) => set(produce(draft => {
        selector(draft).find(anno => anno.id == id)[propKey] = value
    }))

    return {
        editAnnotation: (id, changes) => set(produce(draft => {
            const annoArr = selector(draft)
            const item = annoArr.find(anno => anno.id == id)
            const itemIndex = annoArr.indexOf(item)
            annoArr[itemIndex] = { ...item, ...changes }
        })),
        addAnnotation: newAnno => set(produce(draft => {
            selector(draft).push(newAnno)
        })),
        removeAnnotation: id => set(produce(draft => {
            const annoArr = selector(draft)
            annoArr.splice(annoArr.findIndex(anno => anno.id == id), 1)
        })),
        selectAnnotation: id => setAnnotationProp(id, "active", true),
        deselectAnnotation: id => setAnnotationProp(id, "active", false),
        getAnnotation,
        isAnnotationActive: id => getAnnotation(id)?.active,
    }
}


/*
    Create store. Need an initialization function for this so context
    gets passed correctly both on server and client.
*/
export default function createStore() {

    useStore = create((set, get) => ({
        name: null,

        // description
        ...createValueAdapter(set, "description", "setDescription"),

        textAnnotations: [],
        textAnnotationActions: annotationActions(set, get, state => state.textAnnotations),

        sequence: null,
        sequenceAnnotations: [],
        sequenceAnnotationActions: annotationActions(set, get, state => state.sequenceAnnotations),

        // role
        ...createValueAdapter(set, "role", "setRole"),

        proteins: createListAdapter(set, state => state.proteins),
        targetOrganisms: createListAdapter(set, state => state.targetOrganisms),
    }))
}

function createValueAdapter(set, key, setterKey, initial = null) {
    return {
        [key]: initial,
        [setterKey]: newValue => set(() => ({ [key]: newValue })),
    }
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