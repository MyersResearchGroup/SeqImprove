import { Container, Title, Tabs, Text, Space, LoadingOverlay, Button } from '@mantine/core'
import useSequenceAnnotations from '../hooks/useSequenceAnnotations'
import useTextAnnotations from '../hooks/useTextAnnotations'
import SimilarParts from './SimilarParts'
import RoleSelection from "./RoleSelection"
import ProteinSelection from './ProteinSelection'
import SplitPanel from "./SplitPanel"
import { useStore } from '../modules/store'
import TargetOrganismsSelection from './TargetOrganismsSelection'
import SuggestedProteins from './SuggestedProteins'
import { useTimeout } from '@mantine/hooks'
import { useEffect } from 'react'


export default function CurationForm({ }) {

    const docLoading = useStore(s => s.loadingSBOL)

    const displayId = useStore(s => s.model.displayId)
    const description = useStore(s => s.model.description)

    const [sequenceComponent, sequenceAnnotationsComponent] = useSequenceAnnotations()
    // const [textComponent, textAnnotationsComponent] = useTextAnnotations()

    return (
        <>
            <Container mb={100}>

                <Tabs defaultValue="overview">
                    <Tabs.List>
                        <Tabs.Tab value="overview">Overview</Tabs.Tab>
                        <Tabs.Tab value="sequence">Sequence</Tabs.Tab>
                        <Tabs.Tab value="text">Text</Tabs.Tab>
                        <Tabs.Tab value="proteins">Proteins</Tabs.Tab>
                    </Tabs.List>

                    <Tabs.Panel value="overview" pt={20}>
                        <SplitPanel
                            left={<>
                                <Title order={2} mb={10}>{displayId}</Title>
                                <Text color="dimmed">{description}</Text>
                                <Space h={20} />
                                {/* <RoleSelection /> */}
                                <Space h={40} />
                                {/* <TargetOrganismsSelection /> */}
                            </>}
                            // right={<SimilarParts />}
                            right={<></>}
                        />
                    </Tabs.Panel>

                    <Tabs.Panel value="sequence" pt={20}>
                        <SplitPanel
                            left={sequenceComponent}
                            right={sequenceAnnotationsComponent}
                        />
                    </Tabs.Panel>

                    <Tabs.Panel value="text" pt={20}>
                        {/* <SplitPanel
                        left={textComponent}
                        right={textAnnotationsComponent}
                    /> */}
                    </Tabs.Panel>

                    <Tabs.Panel value="proteins" pt={20}>
                        {/* <SplitPanel
                        left={<ProteinSelection />}
                        right={<SuggestedProteins />}
                    /> */}
                    </Tabs.Panel>
                </Tabs>
            </Container>
            <LoadingOverlay visible={docLoading} />
        </>
    )
}


const exampleSequence = "ACTTTTCATACTCCCGCCAcaggtggcacttttcggggaaatgtgcgcggaacccctatttgtttatttttctaaatacattcaaatatgtatccgctcatgagacaataaccctgataaatgcttcaataatattgaaaaaggaagagtTTCAGAGAAGAAACCAATTGTCCATATTGCATCAGACATTGCCGTCACTGCGTCTTTTACTGGCTCTTCTCGCTAACCAAACCGGTAACCCCGCTTATTAAAAGCATTCTGTAACAAAGCGGGACCAAAGCCATGACAAAAACGCGTAACAAAAGTGTCTATAATCACGGCAGAAAAGTCCACATTGATTATTTGCACGGCGTCACACTTTGCTATGCCATAGCATTTTTATCCATAAGATTAGCGGATCCTACCTGACGCTTTTTATCGCAACTCTCTACTGTTTCTCCATACCCGTTTTTTTGGGCTAGCatgaaaccagtaacgttatacgatgtcgcagagtatgccggtgtctcttatcagaccgtttcccgcgtggtgaaccaggccagccacgtttctgcgaaaacgcgggaaaaagtggaagcggcgatggcggagctgaattacattcccaaccgcgtggcacaacaactggcgggcaaacagtcgttgctgattggcgttgccacctccagtctggccctgcacgcgccgtcgcaaattgtcgcggcgattaaatctcgcgccgatcaactgggtgccagcgtggtggtgtcgatggtagaacgaagcggcgtcgaagcctgtaaagcggcggtgcacaatcttctcgcgcaacgcgtcagtgggctgatcattaactatccgctggatgaccaggatgccattgctgtggaagctgcctgcactaatgttccggcgttatttcttgatgtctctgaccagacacccatcaacagtattattttctcccatgaggacggtacgcgactgggcgtggagcatctggtcgcattgggtcaccagcaaatcgcgctgttagcgggcccattaagttctgtctcggcgcgtctgcgtctggctggctggcataaatatctcactcgcaatcaaattcagccgatagcggaacgggaaggcgactggagtgccatgtccggttttcaacaaaccatgcaaatgctgaatgagggcatcgttcccactgcgatgctggttgccaacgatcagatggcgctgggcgcaatgcgcgccattaccgagtccgggctgcgcgttggtgcggatatctcggtagtgggatacgacgataccgaagatagctcatgttatatcccgccgttaaccaccatcaaacaggattttcgcctgctggggcaaaccagcgtggaccgcttgctgcaactctctcagggccaggcggtgaagggcaatcagctgttgccagtctcactggtgaaaagaaaaaccaccctggcgcccaatacgcaaaccgcctctccccgcgcgttggccgattcattaatgcagctggcacgacaggtttcccgactggaaagcgggcagtgataaCCAATTATTGAACACCCTTCGGGGTGTTTaagaggatgtccaatattttttttaaggaataaggatacttcaagactagattcccccctgcattcccatcagaaccgtaaaccttggcgctttccttgggaagtattcaagaagtgccttgtccggtttctgtggctcacaaaccagcgcgcccgatatggctttcttttcacttatgaatgtaccagtacgggacaattagaacgctcctgtaacaatctctttgcaaatgtggggttacattctaaccatgtcacactgctgacgaaattcaaagtaaaaaaaaatgggaccacgtcttgagaacgatagattttctttattttacattgaacagtcgttgtctcagcgcgctttatgttttcattcatacttcatattataaaataacaaaagaagaatttcatattcacgcccaagaaatcaggctgctttccaaatgcaattgacacttcattagccatcacacaaaactctttcttgctggagcttcttttaaaaaagacctcagtacaccaaacacgttacccgacctcgttattttacgacaactatgataaaattctgaagaaaaaataaaaaaattttcatacttcttgcttttatttaaaccattgaatgatttcttttgaacaaaactacctgtttcaccaaaggaaatagaaagaaaaaatcaattagaagaaaacaaaaaacaaaagatctTTTTGTTTCTGGTCTACC"
const exampleAnnotations = [
    {
        "name": "AmpR terminator",
        "id": "https://synbiohub.org/user/zachsents/curationtest/Test_Part/AmpR_u32_terminator_anno_1",
        "location": [
            20,
            150
        ]
    },
    {
        "name": "pRPL18B",
        "id": "https://synbiohub.org/user/zachsents/curationtest/Test_Part/pRPL18B_anno_1",
        "location": [
            1578,
            2283
        ]
    },
]