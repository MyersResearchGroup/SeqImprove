import { Box, Group } from '@mantine/core'

export default function SplitPanel({ left, right }) {
    return (
        <Group sx={{ alignItems: "flex-start" }}>
            <Box sx={{ flexGrow: 1, flexBasis: 0, }}>
                {left}
            </Box>
            <Box sx={{ width: 350 }}>
                {right}
            </Box>
        </Group>
    )
}
