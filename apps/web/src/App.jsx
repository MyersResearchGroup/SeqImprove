import { useEffect } from 'react'
import { NotificationsProvider } from '@mantine/notifications'
import { useStore } from './modules/store'
import CurationForm from './components/CurationForm'
import UploadForm from './components/UploadForm'
import { MantineProvider } from '@mantine/core'
import { getSearchParams } from './modules/util'

// test comment for commit workflow demonstration
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
            </NotificationsProvider>
        </MantineProvider>
    )
}


const theme = {
    primaryColor: "teal",
}