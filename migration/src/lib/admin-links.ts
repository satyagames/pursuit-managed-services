import * as dataService from '../../../public/js/dataService.js';

// Links the facilitator hands out, and the QR image of one. Shared by Today, Clients and Guests and QR.

const localHosts = ['localhost', '127.0.0.1', '[::1]'];

/**
 * Where participant devices open the app. On a laptop running the local server, `localhost` means
 * nothing to an iPad, so the first LAN address the server reports stands in for it.
 */
export async function participantPageUrl(): Promise<string> {
  const participantUrl = new URL('index.html', window.location.href);
  if (!localHosts.includes(window.location.hostname)) return participantUrl.href;
  try {
    const lanUrls = await dataService.getLanUrls() as string[];
    return new URL(participantUrl.pathname, lanUrls[0] ?? window.location.origin).href;
  } catch {
    return participantUrl.href;
  }
}

/** A QR code for `text` as an image address. The library is loaded only when a code is shown. */
export async function qrImage(text: string): Promise<string> {
  const [{ generate, correction }, { toSvgDataURL }] = await Promise.all([import('lean-qr'), import('lean-qr/extras/svg')]);
  return toSvgDataURL(generate(text, { minCorrectionLevel: correction.M }), { pad: 4 });
}

/** Copies text, falling back to the field's own selection where the clipboard API is unavailable. */
export async function copyText(text: string, field?: HTMLInputElement | null): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    field?.select();
    document.execCommand('copy');
  }
}
