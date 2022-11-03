import { createContext, useContext } from "react"


const requestContext = createContext({})

export const RequestProvider = requestContext.Provider
export const useRequest = () => useContext(requestContext)