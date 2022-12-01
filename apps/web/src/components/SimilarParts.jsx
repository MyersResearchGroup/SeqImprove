import { Box, Center, ScrollArea, Text } from '@mantine/core'
import { useEffect, useState } from 'react'
import { useMemo } from 'react'
import { fetchSimilarParts } from '../modules/api'
import { useStore } from '../modules/store'
import FormSection from './FormSection'
import TextLink from './TextLink'

export default function SimilarParts() {

    const uriPrefix = useStore(s => s.document.root.uriPrefix)
    const topLevelUri = useStore(s => s.document.root.uriChain)
    const isSynbiohub = uriPrefix.includes("synbiohub")

    const [similarParts, setSimilarParts] = useState([])
    useEffect(() => {
        if(isSynbiohub)
            fetchSimilarParts(topLevelUri)
            .then(result => {
                console.log(result)
                // setSimilarParts(result)
            })
    }, [uriPrefix])

    return isSynbiohub ?
        <FormSection title="Similar Parts">
            <ScrollArea styles={scrollAreaStyles}>
                <Box sx={{ display: "flex", flexWrap: "wrap", }}>
                    {similarParts.map(part =>
                        <Box sx={{ flexGrow: 1, flexBasis: "45%", }} key={part.uri}>
                            <TextLink href={part.uri} color="gray">{part.name}</TextLink>
                        </Box>
                    )}
                </Box>
            </ScrollArea>
        </FormSection>
        :
        <></>
}

const scrollAreaStyles = theme => ({
    root: {
        height: 150,
    },
})