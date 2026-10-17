import * as dataService from '../data/dataService.js';
import { masterColours } from '../brand/legacy-colours.js';
import { withoutRetiredLogo } from '../brand/retired-logos.js';

/**
 * The brand the Master screen and its exports use, with the colours from the client's stored theme when it has one
 * (Brand Studio writes it) and the older PrimaryColor / SecondaryColor fields otherwise, which loadBrand has already
 * put there. One extra read of the client, on the facilitator's results screen only. Never throws: a client that cannot
 * be read keeps the colours it came with.
 */
export async function withStoredColours<B extends { clientId: string | null; primaryColor: string; secondaryColor: string; logoUrl?: string | null }>(brand: B): Promise<B> {
  // (A drawn stand-in logo that older sample seeds wrote counts as no logo here too, so the PDF and PowerPoint exports do not carry it: lib/brand/retired-logos.js.)
  const clean = 'logoUrl' in brand ? { ...brand, logoUrl: withoutRetiredLogo(brand.logoUrl) } : brand;
  if (!clean.clientId) return clean;
  try {
    const colours = masterColours(await dataService.getClient(clean.clientId));
    if (colours.source !== 'theme') return clean;
    return { ...clean, primaryColor: colours.primaryColor ?? clean.primaryColor, secondaryColor: colours.secondaryColor ?? clean.secondaryColor };
  } catch {
    return clean;
  }
}
