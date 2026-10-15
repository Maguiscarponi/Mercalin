declare const __APP_VERSION__: string;
export async function getVersion(): Promise<string> {
  return __APP_VERSION__;
}
