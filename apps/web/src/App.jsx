import { useEffect } from 'react'
import { NotificationsProvider } from '@mantine/notifications'
import { useStore } from './modules/store'
import CurationForm from './components/CurationForm'
import UploadForm from './components/UploadForm'
import { MantineProvider, Center, Box, Text, Space } from '@mantine/core'
import { getSearchParams } from './modules/util'


export default function App() {

    const loadSBOL = useStore(s => s.loadSBOL)
    const documentLoaded = useStore(s => !!s.document)

    // load SBOL into store if we have a complete_sbol parameter
    useEffect(() => {
        const paramsUri = getSearchParams().complete_sbol
        paramsUri && loadSBOL(paramsUri)
    }, [])

    return (
        <MantineProvider theme={theme} withNormalizeCSS withGlobalStyles>
            <NotificationsProvider>
                {documentLoaded ?
                    <CurationForm />
                    :
                    <UploadForm />}
                    <Center>
                        <Box sx={_ => { padding: "0 0 10px 0" }}>
                            <Text fz="xs" align="center">&copy; 2023 Genetic Logic Lab at the University of Colorado, Boulder</Text>
                            <Text fz="xs" align="center"><a target="_blank" href="https://github.com/MyersResearchGroup/SeqImprove">View Source on Github</a> | <a target="_blank" href="https://github.com/MyersResearchGroup/SeqImprove/issues/new">Report an Issue</a> | v0.2.0</Text>
                            <Space h="lg" />
                        </Box>                        
                    </Center>
                </NotificationsProvider>
        </MantineProvider>
    )
}


const theme = {
    primaryColor: "teal",
}
