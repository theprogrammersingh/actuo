/**
 * Hand a fetched file to the browser's downloader.
 *
 * The roundabout route — object URL, synthetic anchor, click — is the only one
 * available: the bytes were fetched with a bearer header (`ApiClient.download`),
 * so there is no URL a user could click that would produce them. A plain link
 * to the API route sends no `Authorization` and answers 401.
 *
 * A plain function rather than a service, so its spec needs no TestBed.
 */
export function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  // Firefox only dispatches the click for an anchor that is in the document.
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  // Revoking in the same task can cancel the download that click just started.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
