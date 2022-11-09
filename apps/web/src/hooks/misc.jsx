import { useMantineTheme } from "@mantine/core";
import { useMemo } from "react";
import { generateCyclicalColors, getSearchParams } from "../modules/util";

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
    return useMemo(() => generateCyclicalColors(theme.colors, amount, level), [amount, level])
}