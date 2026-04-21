import { StrictMode, Component } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

class ErrorBoundary extends Component {
  constructor(props) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(e) { return { error: e }; }
  render() {
    if (this.state.error) {
      return (
        <div style={{background:'#0f172a',color:'#ef4444',padding:24,fontFamily:'monospace',minHeight:'100vh'}}>
          <h2 style={{color:'#f59e0b',marginBottom:12}}>Runtime Error</h2>
          <pre style={{whiteSpace:'pre-wrap',fontSize:13,color:'#fca5a5'}}>
            {this.state.error.message}{'\n\n'}{this.state.error.stack}
          </pre>
        </div>
      );
    }
    return this.props.children;
  }
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
)
