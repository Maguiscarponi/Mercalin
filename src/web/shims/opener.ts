export async function openUrl(url: string): Promise<void> {
  window.open(url, "_blank", "noopener,noreferrer");
}
export async function openPath(_path: string): Promise<void> {}
