import { Box, ScrollArea } from '@mantine/core'
import React from 'react'
import { useRequest } from '../modules/requestContext'
import FormSection from './FormSection'
import TextLink from './TextLink'

export default function SimilarParts() {

    const { similarParts } = useRequest()

    return (
        <FormSection title="Similar Parts">
            <ScrollArea styles={scrollAreaStyles}>
                <Box sx={{ display: "flex", flexWrap: "wrap", }}>
                    {similarParts?.map(part =>
                        <Box sx={{ flexGrow: 1, flexBasis: "45%", }} key={part.uri}>
                            <TextLink href={part.uri} color="gray">{part.name}</TextLink>
                        </Box>
                    )}
                </Box>
            </ScrollArea>
        </FormSection>
    )
}

const scrollAreaStyles = theme => ({
    root: {
        height: 150,
    },
})