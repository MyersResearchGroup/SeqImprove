import { Highlight } from '@mantine/core'
import React from 'react'
import { useCallback } from 'react'
import { getColor } from '../util'

export default function FreeText({ children, terms, onChange }) {

    const highlightContainerStyle = useCallback(theme => Object.fromEntries(
        terms.map((term, i) => [
            `& mark:nth-of-type(${i + 1})`,
            {
                backgroundColor: term.active ? getColor(theme, term.color, 3) : "transparent",
                border: "3px solid " + getColor(theme, term.color, term.active ? 3 : 2),
                borderRadius: 5,
                "&:hover": {
                    backgroundColor: getColor(theme, term.color, term.active ? 3 : 2),
                },
            }
        ])
    ), [JSON.stringify(terms)])

    const clickHandler = event => {
        if(event.target.tagName != "MARK")
            return 

        const term = terms.find(t => t.text == event.target.innerHTML)
        term && onChange(term.id, !term.active)
    }

    console.log(terms)

    return (
        <Highlight
            highlight={[]}
            highlightStyles={highlightStyles}
            sx={highlightContainerStyle}
            onClick={clickHandler}
        >
            {children}
        </Highlight>
    )
}

const highlightStyles = theme => ({
    cursor: "pointer",
})