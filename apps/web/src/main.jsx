import ReactDOM from 'react-dom/client'
import App from './App'
import createStore from "./modules/store"

window.global = window 

// create store
createStore()

ReactDOM.createRoot(document.getElementById('root')).render(
    <App />
)