
export function getSearchParams() {
    return new Proxy(
        new URLSearchParams(window.location.search),
        {
            get: (searchParams, prop) => searchParams.get(prop),
        }
    )
}


/*
    Colors
*/

export function getColor(theme, color, level = 3) {
    return theme.colors[color]?.[level] ?? color
}

export function generateCyclicalColors(themeColors, amount, level) {
    const result = []

    let index = 0
    while (result.length < amount) {
        const colorName = colorCycle[index++]
        result.push(
            level == null ?
                colorName :
                themeColors[colorName][level]
        )
        index >= colorCycle.length && (index = 0)
    }

    return result
}

const colorCycle = ["pink", "yellow", "teal", "indigo", "red", "lime", "cyan", "violet", "orange", "green", "blue", "grape"]