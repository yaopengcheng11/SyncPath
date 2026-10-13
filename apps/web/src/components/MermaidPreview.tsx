import React, { useEffect, useRef, useState } from 'react';
import { useI18n } from '../i18n';

// Mermaid has shared configuration. Serialize renders so an older preview cannot
// replace another preview's theme while its diagram is being laid out.
let renderQueue: Promise<void> = Promise.resolve();
let renderId = 0;
// A fresh scope also prevents a hot reload from reusing an existing SVG ID.
const renderScope = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

function renderTimeline(code: string, dark: boolean, cancelled: () => boolean): Promise<string | undefined> {
  const pending = renderQueue.then(async () => {
    if (cancelled()) return;
    const { default: mermaid } = await import('mermaid');
    if (cancelled()) return;
    const palette = getComputedStyle(document.documentElement);
    const token = (name: string, fallback: string) => palette.getPropertyValue(name).trim() || fallback;
    const surface = token('--sp-accent-soft', dark ? '#29263b' : '#f0edff');
    const text = token('--sp-text', dark ? '#eff1f5' : '#202635');
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: 'strict',
      suppressErrorRendering: true,
      theme: 'base',
      fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      timeline: { disableMulticolor: true },
      themeVariables: {
        darkMode: dark,
        background: token('--sp-surface', dark ? '#191b1f' : '#ffffff'),
        primaryColor: surface,
        primaryTextColor: text,
        primaryBorderColor: token('--sp-control-border', dark ? '#707b8d' : '#808b9e'),
        lineColor: token('--sp-muted', dark ? '#a0a8b6' : '#5d697e'),
        textColor: text,
        cScale0: surface,
        cScaleLabel0: text,
        cScaleInv0: text
      }
    });
    const scratch = document.createElement('div');
    scratch.style.cssText = 'position:fixed;left:-100000px;top:0;visibility:hidden;width:1200px;';
    document.body.appendChild(scratch);
    try {
      const result = await mermaid.render(`syncpath-mermaid-${renderScope}-${++renderId}`, code, scratch);
      return result.svg;
    } finally {
      scratch.remove();
    }
  });
  renderQueue = pending.then(() => undefined, () => undefined);
  return pending;
}

export default function MermaidPreview({ code, empty }: { code: string; empty: boolean }) {
  const { t } = useI18n();
  const [dark, setDark] = useState(() => document.documentElement.dataset.theme === 'dark');
  const [result, setResult] = useState<{ code: string; dark: boolean; svg?: string; failed?: boolean } | null>(null);
  const preview = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const observer = new MutationObserver(() => setDark(document.documentElement.dataset.theme === 'dark'));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (empty) return;
    let cancelled = false;
    void renderTimeline(code, dark, () => cancelled).then(
      svg => { if (!cancelled && svg) setResult({ code, dark, svg }); },
      () => { if (!cancelled) setResult({ code, dark, failed: true }); }
    );
    return () => { cancelled = true; };
  }, [code, dark, empty]);

  const current = result?.code === code && result.dark === dark ? result : null;
  useEffect(() => {
    const svg = preview.current?.querySelector('svg');
    if (!svg) return;
    // Preserve readable labels for dense timelines; the panel scrolls rather
    // than shrinking hundreds of events into an unreadable thumbnail.
    const width = Math.max(400, svg.viewBox.baseVal.width * 0.65);
    svg.style.maxWidth = 'none';
    svg.style.width = '100%';
    svg.style.minWidth = `${width}px`;
    svg.style.height = 'auto';
    svg.setAttribute('focusable', 'false');
  }, [current?.svg]);

  if (empty) return <div className="flex min-h-40 items-center justify-center px-6 text-center text-sm text-slate-500">{t('No visible cards to export. Adjust the timeline filters or add a card.')}</div>;
  if (!current) return <div className="flex min-h-40 items-center justify-center gap-2 text-sm text-slate-500" role="status"><i className="fas fa-circle-notch fa-spin" aria-hidden="true" />{t('Preparing preview…')}</div>;
  if (current.failed) return <div className="flex min-h-40 items-center justify-center px-6 text-center text-sm text-slate-500" role="status">{t('Preview is unavailable. You can still copy or download the Mermaid code.')}</div>;
  return <div ref={preview} className="max-h-80 overflow-auto p-4" role="img" aria-label={t('Mermaid timeline preview')} dangerouslySetInnerHTML={{ __html: current.svg ?? '' }} />;
}
