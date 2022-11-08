import create from "zustand"
import produce from "immer"
import { getSearchParams } from "./util"
import { Graph, SBOL2GraphView } from "sbolgraph"
import _ from "lodash"
import { addSequenceAnnotation, removeSequenceAnnotation } from "./sbol"


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
export default async function createStore() {

    // grab URL search params to see if we have any initial data
    const params = getSearchParams()

    // create the store
    useStore = create((set, get) => ({

        uri: params.complete_sbol,
        sbolContent: null,
        document: null,

        // load SBOL into document model
        loadSBOL: async sbol => {
            set({ loadingSBOL: true })
            const document = new SBOL2GraphView(new Graph())
            await document.loadString(sbol)
            set({
                document,
                sbolContent: sbol,
                loadingSBOL: false,
            })
        },
        loadingSBOL: false,

        // need to use nested object for getters to work properly
        model: {

            // get root object -- either ComponentDefinition or ModuleDefinition
            get root() {
                const doc = get().document
                // return doc?.rootModuleDefinitions[0] ?? doc?.rootComponentDefinitions[0]
                return doc?.rootComponentDefinitions[0]
            },

            // name
            get displayId() { return get().model.root?.displayId },
            setDisplayId: createRootSetter(set, "displayId"),

            // description
            get description() { return get().model.root?.description },
            setDescription: createRootSetter(set, "description"),

            // sequence
            get sequence() { return get().model.root?.sequences[0]?.elements },
        },

        sequenceAnnotations: [],
        loadSequenceAnnotations: async () => {
            set({ sequenceAnnotationsLoading: true })

            // fetch sequence annotations from API
            const response = await fetch(`${import.meta.env.VITE_API_LOCATION}/api/annotateSequence`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    completeSbolContent: get().sbolContent,
                }),
            })

            // parse body and setup store objects
            try {
                const result = await response.json()
                const sequenceAnnotations = result?.annotations.map(anno => ({
                    ...anno,

                    // getter to read model for SequenceAnnotations
                    get active() {
                        return !!get().model.root.sequenceAnnotations
                            .find(sa => sa.persistentIdentity == anno.id)
                    },

                    // setter to mutate model for adding/removing SequenceAnnotations
                    set active(value) {
                        mutateDocument(set, state => {
                            value ?
                                addSequenceAnnotation(state.model.root, anno) :
                                removeSequenceAnnotation(state.model.root, anno.id)
                        })
                    }
                }))

                // set state
                set({
                    sequenceAnnotations,
                    sequenceAnnotationsLoading: false,
                })
            }
            catch (err) {
                console.error("Couldn't parse JSON.")
            }
        },
        sequenceAnnotationsLoading: false,

        // textAnnotations: [],
        // textAnnotationActions: annotationActions(set, get, state => state.textAnnotations),

        // sequenceAnnotations: [],
        // sequenceAnnotationActions: annotationActions(set, get, state => state.sequenceAnnotations),

        // // role
        // ...createRootValueAdapter(set, get, "role", "setRole", "role"),

        // proteins: createListAdapter(set, state => state.proteins),
        // targetOrganisms: createListAdapter(set, state => state.targetOrganisms),
    }))

    // fetch document from URI if we have it
    if (params.complete_sbol) {
        try {
            const sbol = await (await fetch(params.complete_sbol)).text()
            useStore.getState().loadSBOL(sbol)
        }
        catch (err) {
            console.error(`Failed to fetch SBOL content from ${params.complete_sbol}. Running in standalone mode.`)
        }
    }
}

function createRootSetter(set, path) {
    return newValue => mutateDocument(set, state => {
        _.set(state.model.root, path, newValue)
    })
}

function mutateDocument(set, mutator) {
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