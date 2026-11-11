import { useEffect } from 'react';
import { ArrowUpRight, BookOpen } from 'lucide-react';

export function NotFoundView() {
  useEffect(() => { document.title = 'Page not found · OrderLedger'; }, []);

  return <main className="not-found" aria-labelledby="not-found-title">
    <header className="not-found-header">
      <a className="brand" href="/" aria-label="OrderLedger home"><span className="brand-symbol"><BookOpen size={24} strokeWidth={1.8} aria-hidden="true" /></span><span>OrderLedger</span></a>
      <span className="not-found-status">PAGE NOT FOUND</span>
    </header>
    <section className="not-found-content">
      <div className="not-found-art" aria-hidden="true"><span>4</span><span className="not-found-book"><BookOpen strokeWidth={1.2} /></span><span>4</span></div>
      <p className="eyebrow">A SMALL DETOUR</p>
      <h1 id="not-found-title">This page wandered off.</h1>
      <p className="not-found-description">We couldn’t find the page you’re looking for.<br />Let’s get you back to your business.</p>
      <a className="btn btn-primary btn-lg" href="/">Back to workspace<ArrowUpRight size={18} aria-hidden="true" /></a>
    </section>
    <footer className="not-found-footer"><span>A little more order, every day.</span><span>404 · OrderLedger</span></footer>
  </main>;
}
