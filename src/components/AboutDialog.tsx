import faviconUrl from "/favicon.svg";

interface AboutDialogProps {
  onClose: () => void;
}

export function AboutDialog({ onClose }: AboutDialogProps) {
  return (
    <div className="dialog-overlay" onClick={onClose}>
      <div className="dialog about-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="splash-hero">
          <img src={faviconUrl} className="splash-logo" alt="" />
          <h2 className="splash-title"><span className="splash-brand">rvcells</span></h2>
        </div>
        <p className="about-line">
          Copyright &copy; 2025 Sam Hardwick<br />
          <a href="mailto:sam.hardwick@iki.fi">sam.hardwick@iki.fi</a>
        </p>
        <p className="about-line">
          <a href="https://github.com/traubert/rvcells" target="_blank" rel="noopener noreferrer">Source on GitHub</a>
        </p>
        <p className="about-line about-license">
          This program is free software: you can redistribute it and/or modify
          it under the terms of the GPL. See LICENSE in the source distribution.
        </p>
        <div className="dialog-actions">
          <button className="dialog-button" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
