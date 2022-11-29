import { TextBuffer } from "./index.js"


const buf = new TextBuffer("This part produces GFP. It was tested in E. coli  and is thought to work in B. subtilis. The circuit functions better when background levels of lactose are low. There is also lactse. E. coli  is the same as Escherichia coli.  Escichia coi.")

const alias1 = buf.createAlias(5, 9, "cool part")
const alias2 = buf.createAlias(19, 22, old => `[${old}](code)`)
const alias3 = buf.createAlias(93, 100, "[circuit](...SO562...)")

console.log("Original\n----\n", buf.getText(), "\n")

alias1.enable()
alias2.enable()
alias3.enable()

console.log("After Alias 1, 2, & 3\n----\n", buf.getText(), "\n")

buf.changeText("This part makes PR. There is a new sentence. It was tested in E. coli and works in B. subtilis. The circuit functions better when background levels of lactose are low. There is also lactse. E. coli  is the same as Escherichia coli.  Escichia coi.")


console.log("After text change\n----\n", buf.getText(), "\n")