import { useState, useCallback, useRef } from "react";
import { Grid } from "./components/Grid";
import { createSheet } from "./engine/evaluate";
import type { Sheet } from "./engine/types";
import "./App.css";

export default function App() {
  const sheetRef = useRef<Sheet>(createSheet(10_000));
  const [, setVersion] = useState(0);

  const handleSheetChange = useCallback(() => {
    setVersion((v) => v + 1);
  }, []);

  return (
    <div className="app">
      <header className="app-header">
        <h1>rvcells</h1>
      </header>
      <Grid sheet={sheetRef.current} onSheetChange={handleSheetChange} />
    </div>
  );
}
