'use client';

import { useLayoutEffect, useRef, useState } from 'react';

interface FitTextProps {
  children: string;
  minFontSizePx: number;
  className?: string;
  style?: React.CSSProperties;
}

/**
 * Erzwingt eine einzeilige Darstellung (kein Zeilenumbruch) für kurze, nicht sinnvoll umbrechbare
 * Texte wie die App-URL auf der Dashboard-QR-Karte - durch Schrumpfen der Schriftgröße statt
 * Abschneiden oder Umbrechen. Die "bevorzugte" Größe kommt weiterhin aus der übergebenen
 * className (z. B. .dash-secondary's clamp()) - diese Komponente greift nur ein, wenn der Text
 * bei dieser Größe nicht in die verfügbare Breite passt, und schrumpft dann bis minFontSizePx.
 * Gleiches ResizeObserver/useLayoutEffect-Muster wie HeightFittedList.
 */
export function FitText({ children, minFontSizePx, className, style }: FitTextProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLSpanElement>(null);
  const [overrideFontSize, setOverrideFontSize] = useState<number | null>(null);

  useLayoutEffect(() => {
    const container = containerRef.current;
    const text = textRef.current;
    if (!container || !text) return;

    function measure() {
      if (!container || !text) return;
      // Erst die CSS-eigene (clamp-basierte) Größe messen - dafür einen eventuell zuvor gesetzten
      // Inline-Override kurz entfernen, sonst würde die vorherige Schrumpf-Größe fälschlich als
      // "bevorzugte" Größe gelesen und der Text könnte nie wieder wachsen.
      text.style.fontSize = '';
      const preferredSize = parseFloat(getComputedStyle(text).fontSize);
      const available = container.clientWidth;
      const natural = text.scrollWidth;

      if (natural <= available) {
        setOverrideFontSize(null);
        return;
      }
      const scaled = Math.max(minFontSizePx, (available / natural) * preferredSize);
      setOverrideFontSize(scaled);
    }

    measure();
    const resizeObserver = new ResizeObserver(measure);
    resizeObserver.observe(container);
    return () => resizeObserver.disconnect();
  }, [children, minFontSizePx]);

  return (
    <div ref={containerRef} className="w-full min-w-0 overflow-hidden">
      <span
        ref={textRef}
        className={`inline-block whitespace-nowrap ${className ?? ''}`}
        style={overrideFontSize ? { ...style, fontSize: `${overrideFontSize}px` } : style}
      >
        {children}
      </span>
    </div>
  );
}
