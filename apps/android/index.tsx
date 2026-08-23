import { registerRootComponent } from "expo";
import { ExpoRoot } from "expo-router";

/* eslint-disable @typescript-eslint/no-explicit-any */
export default function App() {
  const ctx = (require as any).context("./app");
  return <ExpoRoot context={ctx} />;
}

registerRootComponent(App);
