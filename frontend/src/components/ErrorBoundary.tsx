import { Component, type ReactNode } from 'react';
import { BookOpen, RotateCcw } from 'lucide-react';

export class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    if (!this.state.failed) return this.props.children;
    return <main className="recovery-screen">
      <div className="recovery-card" role="alert">
        <span className="recovery-icon"><BookOpen size={30} aria-hidden="true" /></span>
        <p className="eyebrow">ORDERLEDGER</p>
        <h1>Let’s get you back.</h1>
        <p>This screen couldn’t load. Your saved business records are still on the server. Unsaved changes may need to be entered again.</p>
        <button className="btn btn-primary btn-lg" onClick={() => window.location.reload()}><RotateCcw size={18} aria-hidden="true" />Reload workspace</button>
        <p className="small muted">If this continues, share which page you were opening with your administrator.</p>
      </div>
    </main>;
  }
}
