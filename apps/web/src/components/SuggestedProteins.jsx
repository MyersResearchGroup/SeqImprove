import { ActionIcon, Badge, Box, Group, Text } from '@mantine/core'
import { useListState } from '@mantine/hooks'
import { useEffect, useState } from 'react'
import shallow from 'zustand/shallow'
import { useUniprot } from '../ontologies/uniprot'
import { useStore } from '../modules/store'
import FormSection from './FormSection'
import TextLink from './TextLink'
import { FaPlus } from "react-icons/fa"
import { HiRefresh } from "react-icons/hi"

export default function SuggestedProteins() {

    const proteinIds = useStore(s => s.proteins.items.map(item => item.id), shallow)
    const addProtein = useStore(s => s.proteins.add)

    const searchUniprot = useUniprot("uniprotkb", result => ({
        id: result.primaryAccession,
        name: result.proteinDescription?.recommendedName?.fullName?.value,
        organism: result.organism?.scientificName,
        identifier: `UniProt:${result.primaryAccession}`,
        uri: `https://identifiers.org/UniProt:${result.primaryAccession}`,
    }), {
        size: 2
    })

    // refresh state
    const [refreshState, setRefreshState] = useState(false)
    const refresh = () => setRefreshState(!refreshState)

    // suggested results state
    const [suggested, suggestedHandlers] = useListState()

    // grab flat list of text annotation terms from store
    const textTerms = useStore(s => s.textAnnotations.map(anno => anno.terms).flat(), shallow)

    // when terms change, look em up on unitprot
    useEffect(() => {
        suggestedHandlers.setState([])
        textTerms.forEach(term => searchUniprot(term).then(results => {
            if (!results.length)
                return

            // make sure we don't suggest proteins we already have 
            !proteinIds.includes(results[0].id) && suggestedHandlers.append({
                ...results[0],
                fromTerm: term,
            })
        }))
    }, [textTerms, refreshState])

    // handle add
    const handleAdd = (protein, index) => {
        addProtein(protein)
        suggestedHandlers.remove(index)
    }

    return (
        <FormSection title="Suggested Proteins" rightSection={
            <ActionIcon onClick={refresh}><HiRefresh /></ActionIcon>
        }>
            {suggested.map((protein, i) =>
                <Group noWrap position="apart" px={10} py={5} sx={suggestedItemStyle} onClick={() => handleAdd(protein, i)} key={protein.id + i}>
                    <Group noWrap>
                        <Text color="dimmed"><FaPlus /></Text>
                        <Box>
                            {/* <TextLink size="sm" href={protein.uri}>{protein.name}</TextLink> */}
                            <Text size="sm">{protein.name}</Text>
                            <Text size="xs" color="dimmed">{protein.organism}</Text>
                        </Box>
                    </Group>
                    <Badge size="xs">Keyword</Badge>
                </Group>
            )}
        </FormSection>
    )
}

const suggestedItemStyle = theme => ({
    borderRadius: 6,
    cursor: "pointer",
    "&:hover": {
        backgroundColor: theme.colors.gray[1]
    }
})