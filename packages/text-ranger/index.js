import { diffWordsWithSpace } from "diff"

export class TextBuffer {

    /**
     * @type {string}
     * @memberof TextBuffer
     */
    originalText

    /**
     * @type {Alias[]}
     * @memberof TextBuffer
     */
    aliases

    /**
     * Creates an instance of TextBuffer.
     * @param {string} text
     * @memberof TextBuffer
     */
    constructor(text) {
        this.originalText = text

        this.aliases = []
    }

    /**
     * Registers an Alias to this TextBuffer.
     *
     * @param {Alias} alias
     * @memberof TextBuffer
     */
    register(alias) {
        if (!this.isAliasRegistered(alias))
            this.aliases.push(alias)
        alias.registerTo(this)
    }

    /**
     * Checks if an Alias is registered.
     *
     * @param {Alias} alias
     * @return {boolean} 
     * @memberof TextBuffer
     */
    isAliasRegistered(alias) {
        return this.aliases.includes(alias)
    }

    /**
     * Creates and registers an Alias.
     *
     * @param {number} start
     * @param {number} end
     * @param {string | function} text
     * @return {Alias} 
     * @memberof TextBuffer
     */
    createAlias(start, end, text) {
        const alias = new Alias(start, end, text)
        this.register(alias)
        return alias
    }

    /**
     * Creates and returns the text with all enabled aliases in effect.
     *
     * @return {*} 
     * @memberof TextBuffer
     */
    getText(includeData = false) {
        const transforms = []
        const enabledAliases = this.aliases.filter(a => a.enabled)

        const text = enabledAliases.reduce(
            (accum, currentAlias) => {

                // Project start and end indices
                const start = projectIndex(currentAlias.start, transforms)
                const end = projectIndex(currentAlias.end, transforms)

                // Grab original text slice
                const originalText = accum.slice(start, end)

                // If new text is a function, pass the original text to it
                const newText = typeof currentAlias.text === "function" ?
                    currentAlias.text(originalText) :
                    currentAlias.text

                // Any replacements that result in less characters than the original text
                //  will result in a range where the result has been removed.
                if (newText.length < originalText.length)
                    transforms.push(createErrorRange(start + newText.length, end))

                // Everything after the end index needs to be adjusted by the difference
                //  between the new length and the original length.
                const adjustment = newText.length - originalText.length
                transforms.push(createTransform(end, adjustment))

                // Make the replacement and return
                return accum.slice(0, start) + newText + accum.slice(end)
            },

            // Start reduction with original text
            this.originalText
        )

        // Optionally include projected indeces as well
        return includeData ? {
            text,
            patches: enabledAliases.map(alias => ({
                alias,
                projectedStart: projectIndex(alias.start, transforms),
                projectedEnd: projectIndex(alias.end, transforms),
            }))
        } : text
    }

    changeText(newText) {

        // diff the old text with the new text
        const diffs = diffWordsWithSpace(this.originalText, newText)

        // loop through diffs
        diffs.forEach((diff, i) => {
            // calculate start & end
            const start = diffs.slice(0, i).reduce(
                (accum, current) => current.removed ? accum : accum + current.value.length,
                0
            )
            const end = start + diff.value.length

            // if there was an addition...
            if (diff.added) {
                // adjust aliases starting after the insertion point
                this.aliases.forEach(alias => {
                    if (alias.start > start) {
                        alias.start += diff.value.length
                        alias.end += diff.value.length
                    }
                    else if (alias.start == start)
                        alias.end = end
                })
            }

            // if there was a removal...
            if (diff.removed) {
                // adjust aliases starting after the removal
                this.aliases.forEach(alias => {
                    if (alias.start >= end) {
                        alias.start -= diff.value.length
                        alias.end -= diff.value.length
                    }
                    else if (alias.start >= start) {
                        alias.start = start
                        alias.end = start
                    }
                })
            }
        })

        this.originalText = newText
    }
}

class Alias {

    /**
     * @type {number}
     * @memberof Alias
     */
    start

    /**
     * @type {number}
     * @memberof Alias
     */
    end

    /**
     * @type {string | function}
     * @memberof Alias
     */
    text

    /**
     * @type {boolean}
     * @memberof Alias
     */
    enabled

    /**
     * Creates an instance of Alias.
     * @param {number} start
     * @param {number} end
     * @param {string | function} text
     * @memberof Alias
     */
    constructor(start, end, text) {

        if (start > end)
            throw Error("Start index must be less than or equal to end index.")

        this.start = start
        this.end = end
        this.text = text

        this.enabled = false
    }

    /**
     * Registers an alias to a TextBuffer.
     *
     * @param {TextBuffer} buffer
     * @memberof Alias
     */
    registerTo(buffer) {
        this.buffer = buffer
        if (!buffer.isAliasRegistered(this))
            buffer.register(this)
    }

    enable() {
        this.enabled = true
    }

    disable() {
        this.enabled = false
    }
}



function projectIndex(index, transforms) {
    return transforms.reduce((accum, transform) => transform(accum), index)
}

function createTransform(threshold, adjustment) {
    return index => index + (index >= threshold ? adjustment : 0)
}

function createErrorRange(start, end) {
    return index => {
        if (index >= start && index < end)
            throw new Error(`Index ${index} has been removed.`)
        return index
    }
}