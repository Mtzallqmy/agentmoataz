import { NativeModule, requireNativeModule } from "expo";

export declare class AgentNativeModule extends NativeModule {
  start(runId: string): Promise<void>;
  updateState(state: string): Promise<void>;
  stop(): Promise<void>;
  isIgnoringBatteryOptimizations(): boolean;
}

export default requireNativeModule<AgentNativeModule>("AgentNative");
