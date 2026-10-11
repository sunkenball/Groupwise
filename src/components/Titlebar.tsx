import { useEffect, useState, type ReactNode } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Gamepad2, Minus, Square, X } from "lucide-react";

/** Two overlapping squares: the "restore down" glyph. */
function RestoreIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 11 11" fill="none" stroke="currentColor" strokeWidth="1.1" aria-hidden="true">
      <rect x="0.5" y="2.5" width="8" height="8" rx="1" />
      <path d="M2.5 2.5V1.5a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1h-1" />
    </svg>
  );
}

/** Frameless window's title bar, Discord-style: app name left, context in the middle, window controls right. Drag anywhere empty. */
export function Titlebar({ center, right }: { center?: ReactNode; right?: ReactNode }) {
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    const win = getCurrentWindow();
    let unlisten: (() => void) | undefined;
    win.isMaximized().then(setMaximized).catch(() => {});
    win
      .onResized(() => win.isMaximized().then(setMaximized).catch(() => {}))
      .then(u => (unlisten = u))
      .catch(() => {});
    return () => unlisten?.();
  }, []);

  const win = () => getCurrentWindow();

  return (
    <header className="titlebar" data-tauri-drag-region>
      <div className="titlebar-brand" data-tauri-drag-region>
        <Gamepad2 size={14} />
        <span data-tauri-drag-region>Groupwise</span>
      </div>
      <div className="titlebar-center" data-tauri-drag-region>
        {center}
      </div>
      <div className="titlebar-right">
        {right}
        <div className="window-controls">
          <button type="button" aria-label="Minimise" onClick={() => win().minimize()}>
            <Minus size={14} />
          </button>
          <button type="button" aria-label={maximized ? "Restore" : "Maximise"} onClick={() => win().toggleMaximize()}>
            {maximized ? <RestoreIcon /> : <Square size={11} />}
          </button>
          <button type="button" className="close" aria-label="Close" onClick={() => win().close()}>
            <X size={15} />
          </button>
        </div>
      </div>
    </header>
  );
}
