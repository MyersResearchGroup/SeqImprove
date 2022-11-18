import { Box, Group } from '@mantine/core'

export default function SplitPanel({ left, right }) {
    return (
        <Group sx={{ alignItems: "flex-start" }}>
            <Box sx={{ flexGrow: 1, flexBasis: 565, }}>
                {left}
            </Box>
            <Box sx={{flexGrow: 1, flexBasis: 325, maxWidth: 400 }}>
                {right}
            </Box>
        </Group>
    )
}
