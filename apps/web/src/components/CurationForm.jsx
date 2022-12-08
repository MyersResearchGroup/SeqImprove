import { Container, Title, Tabs, Text, Space, LoadingOverlay, Button, Group, Header, List } from '@mantine/core'
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
import { ModalsProvider } from '@mantine/modals'
import TextAnnotationModal from './TextAnnotationModal'
import { TbDownload } from "react-icons/tb"
import ReactMarkdown from 'react-markdown'
import { useEffect } from 'react'
import { showNotification } from '@mantine/notifications'


export default function CurationForm({ }) {

    const docLoading = useStore(s => s.loadingSBOL)

    const displayId = useStore(s => s.document?.root.displayId)
    const description = useStore(s => s.document?.root.description)
    const richDescription = useStore(s => s.document?.root.richDescription)

    // colors for annotations
    const sequenceColors = useCyclicalColors(useStore(s => s.sequenceAnnotations.length))
    const textColors = useCyclicalColors(useStore(s => s.textAnnotations.length))

    // exporting
    const exportDocument = useStore(s => s.exportDocument)


    // show notification with known bugs
    useEffect(() => {
        showNotification({
            title: "Known problems & bugs",
            message: <>
                <Text>Here's a list of known problems & bugs that will be fixed. Please take note of any others.</Text>
                <List size="sm" ml="xs"  >
                    <List.Item><Text color="dimmed">Sequence annotation highlights don't display properly</Text></List.Item>
                    <List.Item><Text color="dimmed">Missing proteins section</Text></List.Item>
                    <List.Item><Text color="dimmed">Missing references section</Text></List.Item>
                </List>
            </>,
            autoClose: false,
        })
    }, [])

    return (
        <>

            <Tabs defaultValue="overview" variant="pills" styles={tabStyles}>
                <Header p="lg">
                    <Container>
                        <Group position="apart" align="flex-end">
                            <Group spacing={40}>
                                <Title order={3}>{displayId}</Title>
                                <Tabs.List>
                                    <Tabs.Tab value="overview">Overview</Tabs.Tab>
                                    <Tabs.Tab value="sequence">Sequence</Tabs.Tab>
                                    <Tabs.Tab value="text">Text</Tabs.Tab>
                                    <Tabs.Tab value="proteins">Proteins</Tabs.Tab>
                                </Tabs.List>
                            </Group>
                            <Button
                                onClick={exportDocument}
                                variant="light"
                                rightIcon={<TbDownload />}
                            >
                                Save SBOL
                            </Button>
                        </Group>
                    </Container>
                </Header>

                <Container>
                    <Tabs.Panel value="overview" pt={20}>
                        <SplitPanel
                            left={<>
                                <Title order={5} mb={10}>Description</Title>
                                <Text color="dimmed">
                                    <ReactMarkdown linkTarget="_blank">
                                        {richDescription}
                                    </ReactMarkdown>
                                </Text>
                                <Space h={20} />
                                <RoleSelection />
                                <Space h={40} />
                                <TargetOrganismsSelection />
                            </>}
                            right={<SimilarParts />}
                        />
                    </Tabs.Panel>

                    <Tabs.Panel value="sequence" pt={20}>
                        <SplitPanel
                            left={<SequenceSection.Sequence colors={sequenceColors} />}
                            right={<SequenceSection.Annotations colors={sequenceColors} />}
                        />
                    </Tabs.Panel>

                    <Tabs.Panel value="text" pt={20}>
                        <ModalsProvider modals={{ addAndEdit: TextAnnotationModal }}>
                            <SplitPanel
                                left={<TextSection.Description colors={textColors} />}
                                right={<TextSection.Annotations colors={textColors} />}
                            />
                        </ModalsProvider>
                    </Tabs.Panel>

                    <Tabs.Panel value="proteins" pt={20}>
                        <SplitPanel
                        left={<ProteinSelection />}
                        right={<SuggestedProteins />}
                    />
                    </Tabs.Panel>
                </Container>
            </Tabs>
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
        // paddingBottom: 8,
        // borderBottom: "1px solid " + theme.colors.gray[4]
    },
})