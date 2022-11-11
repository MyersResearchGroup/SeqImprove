import { Container, Title, Tabs, Text, Space, LoadingOverlay, Button } from '@mantine/core'
import { useStore } from '../modules/store'
import { useCyclicalColors } from "../hooks/misc"
import SimilarParts from './SimilarParts'
import RoleSelection from "./RoleSelection"
import ProteinSelection from './ProteinSelection'
import SplitPanel from "./SplitPanel"
import TargetOrganismsSelection from './TargetOrganismsSelection'
import SuggestedProteins from './SuggestedProteins'
import SequenceSection from './SequenceSection'
import TextSection from './TextSection'


export default function CurationForm({ }) {

    const docLoading = useStore(s => s.loadingSBOL)

    const displayId = useStore(s => s.document?.root.displayId)
    const description = useStore(s => s.document?.root.description)

    // colors for annotations
    const sequenceColors = useCyclicalColors(useStore(s => s.sequenceAnnotations.length))
    const textColors = useCyclicalColors(useStore(s => s.textAnnotations.length))

    return (
        <>
            <Container mb={100}>

                <Tabs defaultValue="overview" variant="pills" styles={tabStyles}>
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
                            left={<SequenceSection.Sequence colors={sequenceColors} />}
                            right={<SequenceSection.Annotations colors={sequenceColors} />}
                        />
                    </Tabs.Panel>

                    <Tabs.Panel value="text" pt={20}>
                        <SplitPanel
                            left={<TextSection.Description colors={textColors} />}
                            right={<TextSection.Annotations colors={textColors} />}
                        />
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

const tabStyles = theme => ({
    tab: {
        "&[data-active=true] *": {
            color: "white"
        }
    },
    tabLabel: {
        textTransform: "uppercase",
        fontWeight: 700,
        fontSize: "0.9rem",
        fontFamily: "monospace",
        // color: theme.colors.dark[3],
    },
    tabsList: {
        paddingBottom: 8,
        borderBottom: "1px solid " + theme.colors.gray[4]
    },
})