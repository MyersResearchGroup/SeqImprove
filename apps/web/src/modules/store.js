import _, { remove } from "lodash"
import create from "zustand"
import produce from "immer"
import { getSearchParams, showErrorNotification } from "./util"
import { addSequenceAnnotation, addTextAnnotation, createSBOLDocument, getExistingSequenceAnnotations, hasSequenceAnnotation, hasTextAnnotation, parseTextAnnotations, removeAnnotationWithDefinition, removeDuplicateComponentAnnotation, removeSequenceAnnotation, removeTextAnnotation, isfromSynBioHub } from "./sbol"
import { fetchAnnotateSequence, fetchAnnotateText, fetchSBOL, cleanSBOL, deleteLibrary } from "./api"
import { Graph, SBOL2GraphView } from "sbolgraph"
import fileDownload from "js-file-download"
import { FILE_TYPES } from "./fileTypes"


// create store
export const useStore = create((set, get) => ({

    /** 
     * SBOL URI
     * @type {string | undefined} */
    uri: undefined,


    /** 
     * Raw SBOL content
     * @Type {string} */
    sbolContent: null,

    /**
     * roles used in SBOL document for curation form
     * @type {string[]} */
    roles: [],
    types: [],

    /** 
     * Parsed SBOL document
     * @type {SBOL2GraphView} */
    document: null,
    loadingSBOL: false,
    libraryImported: false,
    loadSBOL: async(sbol, fileType = FILE_TYPES.SBOL2) => {
        set({ loadingSBOL: true });

        try {
            // const result = await loader?.(...args);
            try {
                var sbolUrl = new URL(sbol);
            }
            catch (err) {}

            // if it's a URL, fetch it; otherwise, just use it as the content
            var sbolContent = sbolUrl ? await fetchSBOL(sbolUrl.href) : sbol;
            // Replace https://identifiers.org with https://ontobee.org
            // sbolContent = sbolContent.replace('https://identifiers.org', 'https://ontobee.org');
            
            var document = await createSBOLDocument(sbolContent);
            
            // parse out existing text annotations
            const { buffer: richDescriptionBuffer, annotations: textAnnotations } = parseTextAnnotations(document.root.richDescription);

            // get existing sequence annotations
            const sequenceAnnotations = getExistingSequenceAnnotations(document.root);            
            // if (!document.root.sequence) {                
            //     throw("Failed to process sbol content");
            // }            
                
            // set description as rich description text
            document.root.description = richDescriptionBuffer.originalText;

            // set roles to be the same as from document
            if(document.root.roles.length < 1) document.root.roles = ["http://identifiers.org/so/SO:0000804"] //default to engineered region
            const roles = document.root.roles;
            const types = document.root.types;   
            
            
            const fromSynBioHub = isfromSynBioHub(document.root); 
            let isFileEdited = false
            let isUriCleaned = false
            let nameChanged = false

            if (document.root.uriChain.includes("https://seqimprove.synbiohub.org")) isUriCleaned = true

            set({
                // ...result,
                isFileEdited,
                isUriCleaned,
                nameChanged,
                sbolContent,
                document,
                roles,
                types,
                uri: sbolUrl?.href,
                richDescriptionBuffer,
                textAnnotations,
                sequenceAnnotations,
                isfromSynBioHub,
                loadingSBOL: false
            });
        } catch (err) {
            console.log(`${fileType} loading error:`, err)
            
            // print detailed error messages with instructions & things to verify - specified for each file type.
            switch(fileType){
                case FILE_TYPES.GENBANK:
                    showErrorNotification("GenBank Processing Error",
                        "The converted SBOL document is invalid. This may be due to:\n" +
                        "• Complex GenBank features that don't convert properly\n" +
                        "• Missing required sequence information\n" +
                        "• Unsupported annotation types\n\n" +
                        "Try simplifying your GenBank file or use the format help guide.");
                    break;

                case FILE_TYPES.FASTA:
                    showErrorNotification("FASTA Processing Error", 
                        "Could not create a valid SBOL document from the FASTA file. Please check:\n" +
                        "• Sequence contains only valid DNA characters (A, T, G, C)\n" +
                        "• FASTA header format is correct\n" +
                        "• File is not corrupted");
                    break;

                case FILE_TYPES.FROM_SCRATCH:
                    showErrorNotification("Template Loading Error", 
                        "Could not load the blank template. This is likely a server issue. Please try refreshing the page.");
                    break;

                case FILE_TYPES.TEST_FILE:
                    showErrorNotification("Test File Error", 
                        "Could not load the test file. This is likely a server issue. Please try uploading your own file instead.");
                    break; 

                case FILE_TYPES.SBOL2:
                default:
                    showErrorNotification("SBOL Format Error", 
                        "Could not interpret the file as a valid SBOL document. Please ensure:\n" +
                        "• File is properly formatted SBOL2 XML\n" +
                        "• File is not corrupted or truncated\n" +
                        "• XML structure is valid");
                    break;
            }
        } finally {
            set({ loadingSBOL: false });
        }
    },

    replaceDocumentForIDChange: async (newSBOLcontent) => {
      const newDoc = await createSBOLDocument(newSBOLcontent);

      set ({ document: newDoc,  sbolContent: newSBOLcontent, nameChanged: true });
    },
    
    exportDocument: (download = true) => {
        const annotations = get().sequenceAnnotations

        //remove duplicate annotation and component instance
        for (const rootAnno of get().document.root.sequenceAnnotations) {
            for (const anno of annotations) {
                if (rootAnno.persistentIdentity && (anno.id.slice(0, -2) === rootAnno.persistentIdentity.slice(0, -2) && rootAnno.persistentIdentity.slice(-1) >= 2)) { //potential bug: persistentIdentities may match but locations are different. The second instance will be removed if the part appears multiple times in the sequence
                    removeDuplicateComponentAnnotation(get().document.root, rootAnno.persistentIdentity)
                }
            }
        }


        //if disabled(in annos array but enabled=false), REMOVE: component & sequence annotation (children of root component definition), component definition, associated sequence
        for (const anno of annotations) {
            if (!anno.enabled) removeAnnotationWithDefinition(get().document.root, anno.id)
        }


        const xml = get().document.serializeXML();
        
        if (download) {
            fileDownload(xml, `${get().document.root.displayId}.xml`);
        }
        
        return xml;
    },

    serializeXML: () => {
        // get().document.changeURIPrefix('https://seqimprove.org/');
        // console.log(get().document.uriPrefixes);
        return get().document.serializeXML();
    },

    // SynbioHubLogin, SessionToken
    isLoggedInToSomeSynBioHub: !!sessionStorage.getItem("SynBioHubSessionToken"),
    synBioHubUrlPrefix: sessionStorage.getItem("synBioHubUrlPrefix"),
    logout: () => {
        sessionStorage.removeItem("SynBioHubSessionToken");
        sessionStorage.removeItem("synBioHubSessionUrlPrefix");
        set({ isLoggedInToSomeSynBioHub: false });
        set({ synBioHubUrlPrefix: '' });        
    },
    login: (token, urlPrefix) => {
        sessionStorage.setItem("SynBioHubSessionToken", token);
        sessionStorage.setItem("synBioHubUrlPrefix", urlPrefix);
        set({
            isLoggedInToSomeSynBioHub: true,
            synBioHubUrlPrefix: urlPrefix,
        });        
    },       


    // Sequence Annotations
    sequenceAnnotations: [],
    importedLibraries: [],

    loadingSequenceAnnotations: false,
       
    loadSequenceAnnotations: async (...args) => {
        set({ loadingSequenceAnnotations: true });
        let allLibraries = []
        if (get().sequencePartLibrariesSelected) allLibraries = get().sequencePartLibrariesSelected.concat(args[0])
            else allLibraries = allLibraries.concat(args[0])

        try {
            const result = await fetchAnnotateSequence({
                sbolContent: get().document.serializeXML(),
                selectedLibraryFileNames: allLibraries.map(lib => lib.value),
                isUriCleaned: get().isUriCleaned,
            }) ?? [];

            let { fetchedAnnotations, synbictDoc } = result;

            set({             
                sequenceAnnotations: produce(get().sequenceAnnotations, draft => {
                    fetchedAnnotations.forEach(anno => {
                        // skip duplicates
                        if (!draft.find(a => a.id == anno.id)) {
                            draft.push(anno)
                        }
                    });
                }),
                loadingSequenceAnnotations: false, 
                document: synbictDoc,
                isUriCleaned: true,
            });
        } catch (err) {
            showErrorNotification("Load Error", "Could not load sequence annotations");
            set({ loadingSequenceAnnotations: false });
        } finally {
            set({ loadingSequenceAnnotions: false });
        }
    },

    // ...createAsyncAdapter(set, "SequenceAnnotations", async () => {
    //     // fetch sequence annotations from API
    //     const fetchedAnnotations = await fetchAnnotateSequence(get().document.serializeXML()) ?? [] // get().sbolContent

    //     return {
    //         sequenceAnnotations: produce(get().sequenceAnnotations, draft => {
    //             fetchedAnnotations.forEach(anno => {
    //                 // skip duplicates
    //                 if (!draft.find(a => a.id == anno.id)) {
    //                     draft.push(anno)
    //                 }
    //             })
    //         })
    //     };
    // }),

    sequenceAnnotationActions: createSequenceAnnotationActions(set, get, state => state.sequenceAnnotations, {
        test: hasSequenceAnnotation,
        add: (...args) => {
            const index = addSequenceAnnotation(...args);

            set({
                sequenceAnnotations: produce(get().sequenceAnnotations, draft => {
                    args[0].forEach(anno => {
                        if (!draft.find(a => a.id == anno.id)) {
                            draft.push(anno)
                        }
                    });
                    draft[index].enabled = true
                }),
            });
        },
        remove: (...args) => {
            const index = removeSequenceAnnotation(...args);
            
                set({
                    sequenceAnnotations: produce(get().sequenceAnnotations, draft => {
                        args[0].forEach(anno => {
                            if (!draft.find(a => a.id == anno.id)) {
                                draft.push(anno)
                            }
                        });
                        draft[index].enabled = false
                    }),
                });
        },
    }),


    // Text Annotations
    textAnnotations: [],
    richDescriptionBuffer: null,
    ...createAsyncAdapter(set, "TextAnnotations", async () => {

        // fetch text annotations from API
        console.debug("Annotating this:\n" + get().document.root.description)
        try {
            var fetchedAnnos = await fetchAnnotateText(get().document.root.description)
        } catch(err) {
            console.error(err);
            return;
        }
        const newAnnotations = produce(get().textAnnotations, draft => {
            // loop through fetched annotations
            fetchedAnnos.forEach(anno => {
                const existingAnno = draft.find(a => a.id == anno.id)

                // new annnotation; add and move on
                if (!existingAnno) {
                    draft.push(anno)
                    return
                }

                // existing anotation; merge mentions
                anno.mentions.forEach(mention => {
                    // avoid intersecting mentions
                    if (!existingAnno.mentions.some(m => !((mention.end < m.start) || (m.end < mention.start))))
                        existingAnno.mentions.push(mention)
                })
            })
 
            // make sure each mention has a buffer patch
            draft.forEach(anno => {
                anno.mentions.forEach(mention => {
                    if (!mention.bufferPatch)
                        mention.bufferPatch = get().richDescriptionBuffer.createAlias(mention.start, mention.end, `[${mention.text}](${anno.id})`)
                })
            })           
        })

        return { textAnnotations: newAnnotations }
    }),

    textAnnotationActions: createTextAnnotationActions(set, get, state => state.textAnnotations, {
        test: hasTextAnnotation,
        add: addTextAnnotation,
        remove: removeTextAnnotation,
    }),

    toggleImportedLibraries: index => {
        // set(state.importedLibraries[index].enabled = !state.importedLibraries[index].enabled);  
        set(produce(state => {
            state.importedLibraries[index].enabled = !state.importedLibraries[index].enabled;
        }));
    },

    addImportedLibrary: library => {
        set(produce(state => {
            state.importedLibraries.push(library)
        }));
    },

    removeImportedLibrary: library => {
        set(produce(state => {
            state.importedLibraries = state.importedLibraries.filter(lib => lib.value !== library.value);
        }));
        deleteLibrary(library.value)
    },

    // Target Organisms
    addTargetOrganism: uri => {
        mutateDocument(set, state => {
            state.document.root.addTargetOrganism(uri)
        })
    },
    removeTargetOrganism: uri => {
        mutateDocument(set, state => {
            state.document.root.removeTargetOrganism(uri)
        })
    },

    // Proteins
    addProtein: uri => {
        mutateDocument(set, state => {
            state.document.root.addProtein(uri)
        })
    },
    removeProtein: uri => {
        mutateDocument(set, state => {
            state.document.root.removeProtein(uri)
        })
    },

    // References
    addReference: uri => {
        mutateDocument(set, state => {
            state.document.root.addReference(uri)
        })
    },
    removeReference: uri => {
        mutateDocument(set, state => {
            state.document.root.removeReference(uri)
        })
    },

    cleanSBOLDocument: async () => {
        //call clean doc
        const cleanedSBOL = await cleanSBOL(get().document.serializeXML())
        set ({ sbolContent: cleanedSBOL });
        
        var cleanedDoc = await createSBOLDocument(cleanedSBOL);

        set ({ document: cleanedDoc });
        set ({ isUriCleaned: true })
    }
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
        //upon mutation, clean doc of old uris and set edited to true
        mutator?.(state);
        if (!state.isFileEdited) state.isFileEdited = true;
        return { document: state.document };
    });
}

export function mutateDocumentForDisplayID(set, mutator) {
    set(state => {
        mutator?.(state);
        return { document: state.document };
    });
}

export function mutateSequencePartLibrariesSelected(set, mutator) {
    set(state => {
        mutator(state);
        return { sequencePartLibrariesSelected: state.sequencePartLibrariesSelected };
    });
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
            try {
                const result = await loader?.(...args);
                set({
                    ...result,
                    [loadingPropKey]: false
                });
            } catch (err) {
                showErrorNotification("Upload Error", "Could not interpret file as SBOL document");
            } finally {
                set({ [loadingPropKey]: false });
            }             
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
function createSequenceAnnotationActions(set, get, selector, { test, add, remove } = {}) {

    const getAnnotation = id => selector(get()).find(anno => anno.id == id)

    const isActive = id => test(get().sequenceAnnotations, id)
    const setActive = (id, value) => {
        mutateDocument(set, state => {
            // (value ? add : remove)(state.document.root, getAnnotation(id))
            (value ? add : remove)(get().sequenceAnnotations, id)
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

function createTextAnnotationActions(set, get, selector, { test, add, remove } = {}) {

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