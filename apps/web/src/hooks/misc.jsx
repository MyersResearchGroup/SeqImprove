import { useMantineTheme } from "@mantine/core";
import { useMemo } from "react";
import { getSearchParams } from "../modules/util";

export function useSearchParams() {
    return useMemo(() => getSearchParams(), [window.location.search])
}

export function useRandomColor(level) {
    const theme = useMantineTheme()
    const colors = Object.keys(theme.colors).slice(2)

    return useMemo(() => {
        const colorName = colors[Math.floor(Math.random() * colors.length)]
        return level == null ?
            colorName : theme.colors[colorName][level]
    }, [])
}

export function useCyclicalColors(amount, level) {
    const theme = useMantineTheme()
    const result = []

    let index = 0
    while (result.length < amount) {
        const colorName = colorCycle[index++]
        result.push(
            level == null ?
                colorName :
                theme.colors[colorName][level]
        )
        index >= colorCycle.length && (index = 0)
    }

    return result
}

const colorCycle = ["pink", "yellow", "teal", "indigo", "red", "lime", "cyan", "violet", "orange", "green", "blue", "grape"]