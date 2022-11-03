import ReactDOM from 'react-dom/client'
import App from './App'
import { RequestProvider } from "./modules/requestContext"
import createStore from "./modules/store"

// create store
createStore()

ReactDOM.createRoot(document.getElementById('root')).render(
    <RequestProvider value={window.__CONTEXT__}>
        <App />
    </RequestProvider>
)