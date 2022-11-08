import { Button, Center, Loader } from "@mantine/core"
import AnnotationCheckbox from "../components/AnnotationCheckbox"
import FormSection from "../components/FormSection"
import TextHighlighter from "../components/TextHighlighter"
import { useStore } from "../modules/store"
import { useCyclicalColors } from "./misc"

export default function useSequenceAnnotations() {

    // pull out what we need from the store
    const sequence = useStore(s => s.model.sequence)
    const annotations = useStore(s => s.sequenceAnnotations)
    const load = useStore(s => s.loadSequenceAnnotations)
    const loading = useStore(s => s.sequenceAnnotationsLoading)
    useStore(s => s.model.root?.sequenceAnnotations)    // force rerender from document change

    // create a set of contrasty colors
    const colors = useCyclicalColors(annotations.length)

    return [
        <FormSection title="Sequence">
            {sequence && <TextHighlighter
                terms={annotations.map((anno, i) => ({
                    id: anno.id,
                    start: anno.location[0],
                    end: anno.location[1],
                    color: colors[i],
                    active: anno.active ?? false,
                }))}
                onChange={(id, val) => annotations.find(anno => anno.id == id).active = val}
                h={400}
                offsetStart={-1}
                wordMode={8}
                textStyle={{
                    fontFamily: "monospace",
                    fontSize: 14,
                    letterSpacing: 0.2,
                }}
            >
                {sequence?.toLowerCase()}
            </TextHighlighter>}
        </FormSection>,

        <FormSection title="Sequence Annotations" w={350}>
            {annotations?.length ?
                annotations.map((anno, i) =>
                    <AnnotationCheckbox
                        title={anno.name}
                        color={colors[i]}
                        active={anno.active ?? false}
                        onChange={val => anno.active = val}
                        key={anno.name}
                    />
                )
                :
                <Center>
                    {loading ?
                        <Loader my={30} size="sm" variant="dots" /> :
                        <Button my={10} onClick={load}>Load Sequence Annotations</Button>}
                </Center>}
        </FormSection>
    ]
}